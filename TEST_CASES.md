# Ручные тест-кейсы: Swagger и SQL

## Подготовка

Запустите полигон по README. Перед **каждым кейсом**, кроме явно связанных шагов внутри кейса, выполняйте:

```sh
docker compose --profile simulation stop user-simulator
docker compose exec api python -m tools.reset --yes
```

Не запускайте эмулятор во время ручных проверок. Исходное состояние: пользователи 1–3; товары 1–5 с остатками 10,20,3,1,0; заказов и позиций нет. Проверяйте значения через GET и SQL. В Swagger для запроса нажмите Try it out → заполните параметры/JSON → Execute. Денежные значения в ответах — строки. ID новых записей берите из ответа; после reset первый заказ имеет ID 1.

### Снимок до и после отказа

Для кейсов 2, 5, 6, 9, 10 сохраните результаты **до** запроса и сравните с **после**:

```sql
SELECT * FROM users ORDER BY id;
SELECT * FROM products ORDER BY id;
SELECT * FROM orders ORDER BY id;
SELECT * FROM order_items ORDER BY id;
```

Все строки и значения должны совпасть. Полный снимок одним запросом есть в Q7 файла `queries.sql`. Сравнение всех таблиц проверяет отсутствие лишних изменений, а не только код ответа. Значения sequence сравнивать не нужно — пропуски ID допустимы.

## 1. Создание пользователя

**Цель:** проверить сохранение данных. **Предусловие:** reset; email qa@example.com отсутствует, 3 пользователя.

**Действие в Swagger:** `POST /users`:

```json
{"name":"Тестировщик","email":"qa@example.com"}
```

**Ожидание:** 201; ответ содержит новый `id` (4 после reset), переданные name/email и непустой created_at.

```sql
SELECT id, name, email, created_at FROM users WHERE email='qa@example.com';
SELECT count(*) AS users_count FROM users;
SELECT count(*) AS orders_count FROM orders;
SELECT count(*) AS items_count FROM order_items;
SELECT id, stock FROM products ORDER BY id;
```

**Состояние БД:** одна новая запись с корректными значениями, всего 4 пользователя; заказов и позиций по 0; остатки 10,20,3,1,0.

## 2. Дублирующийся email

**Цель:** проверить уникальность email. **Предусловие:** reset; alex@example.com уже существует. Сохраните снимок таблиц.

**Действие:** `POST /users`:

```json
{"name":"Другой пользователь","email":"alex@example.com"}
```

**Ожидание:** 409; `error.code = email_exists`, `details = []`.

```sql
SELECT count(*) FROM users WHERE email='alex@example.com';
SELECT count(*) FROM users;
```

**Состояние:** одна запись с этим email, всего 3 пользователя. Полный снимок не изменился. Дополнительно повторите с `ALEX@example.com` — тот же результат, поскольку API нормализует регистр.

## 3. Заказ с одним товаром

**Цель:** проверить создание связанных записей и списание. **Предусловие:** reset; товар 1 стоит 100.00, остаток 10.

**Действие:** `POST /orders`:

```json
{"user_id":1,"items":[{"product_id":1,"quantity":2}]}
```

**Ожидание:** 201; `status=created`, `total_amount="200.00"`, `cancelled_at=null`, одна позиция на 2 единицы по 100.00. Сохраните ID заказа.

```sql
SELECT * FROM orders WHERE id=1;
SELECT order_id, product_id, quantity, unit_price FROM order_items WHERE order_id=1;
SELECT id, stock FROM products ORDER BY id;
SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
```

**Состояние:** один заказ и одна позиция, user_id=1. Остатки 8,20,3,1,0. Пользователей по-прежнему 3. `GET /orders/1` и `GET /users/1/orders` возвращают сохранённый заказ.

## 4. Заказ с несколькими товарами

**Цель:** проверить JOIN, цены позиций и сумму. **Предусловие:** reset.

**Действие:** `POST /orders`:

```json
{"user_id":1,"items":[{"product_id":1,"quantity":2},{"product_id":2,"quantity":3}]}
```

**Ожидание:** 201; две позиции, сумма `"276.50"` (2×100.00 + 3×25.50).

```sql
SELECT o.id, u.email, o.status, o.total_amount, p.name,
       i.quantity, i.unit_price, i.quantity*i.unit_price AS line_total
FROM orders o
JOIN users u ON u.id=o.user_id
JOIN order_items i ON i.order_id=o.id
JOIN products p ON p.id=i.product_id
WHERE o.id=1 ORDER BY p.id;
SELECT id, stock FROM products ORDER BY id;
SELECT (SELECT count(*) FROM orders) AS orders_count,
       (SELECT count(*) FROM order_items) AS items_count;
```

**Состояние:** две строки JOIN, email alex@example.com, суммы строк 200.00 и 76.50; один заказ и две позиции; остатки 8,17,3,1,0. Пользователи не изменились. Q5 из queries.sql возвращает 0 строк.

## 5. Недостаточный остаток

**Цель:** проверить отказ без изменений. **Предусловие:** reset; у товара 1 остаток 10. Сохраните снимок.

**Действие:** `POST /orders`:

```json
{"user_id":1,"items":[{"product_id":1,"quantity":11}]}
```

**Ожидание:** 409; `error.code=insufficient_stock`.

```sql
SELECT stock FROM products WHERE id=1;
SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
```

**Состояние:** stock=10, заказов 0, позиций 0; полный снимок совпадает с исходным.

## 6. Атомарность при нехватке второго товара

**Цель:** проверить полный откат обработки нескольких позиций. **Предусловие:** reset; у товара 1 остаток 10, у товара 5 — 0. Сохраните снимок.

**Действие:** `POST /orders`:

```json
{"user_id":1,"items":[{"product_id":1,"quantity":2},{"product_id":5,"quantity":1}]}
```

**Ожидание:** 409; `error.code=insufficient_stock` для товара 5.

```sql
SELECT id, stock FROM products WHERE id IN (1,5) ORDER BY id;
SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
```

**Состояние:** остатки 10 и 0; заказов и позиций нет. Полный снимок совпадает, списания первой позиции не осталось.

## 7. Отмена заказа

**Цель:** проверить возврат остатков и состояние заказа. **Предусловие:** reset, затем создайте заказ как в кейсе 3. У товара 1 стало 8 единиц.

**Действие:** `POST /orders/1/cancel`; тела запроса нет.

**Ожидание:** 200; тот же ID, `status=cancelled`, `cancelled_at` заполнен; сумма и позиции сохранены.

```sql
SELECT id, user_id, status, total_amount, cancelled_at FROM orders WHERE id=1;
SELECT * FROM order_items WHERE order_id=1;
SELECT id, stock FROM products ORDER BY id;
SELECT (SELECT count(*) FROM orders) AS orders_count,
       (SELECT count(*) FROM order_items) AS items_count;
```

**Состояние:** один отменённый заказ с суммой 200.00, одна позиция с quantity=2 и unit_price=100.00. Остатки 10,20,3,1,0. Новых заказов/позиций нет.

## 8. Повторная отмена

**Цель:** проверить отсутствие двойного возврата. **Предусловие:** reset → создание заказа из кейса 3 → первая отмена из кейса 7. Сохраните ответ первой отмены и полный снимок.

**Действие:** повторите `POST /orders/1/cancel`; тела нет.

**Ожидание:** 200; ответ совпадает с первой отменой, включая время cancelled_at.

```sql
SELECT status, cancelled_at FROM orders WHERE id=1;
SELECT id, stock FROM products ORDER BY id;
SELECT * FROM order_items WHERE order_id=1;
```

**Состояние:** товар 1 имеет остаток 10, а не 12; статус cancelled; время отмены не изменилось. Полный снимок совпадает со снимком перед повторной отменой.

## 9. Несуществующий пользователь или товар

**Цель:** проверить ссылки и отсутствие частичных записей. **Предусловие:** reset; ID 999999 отсутствует. Сохраните снимок.

**Действия:** последовательно выполните два `POST /orders`:

```json
{"user_id":999999,"items":[{"product_id":1,"quantity":1}]}
```

```json
{"user_id":1,"items":[{"product_id":999999,"quantity":1}]}
```

**Ожидание:** каждый запрос возвращает 404; `error.code=not_found`.

```sql
SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
SELECT id, stock FROM products ORDER BY id;
SELECT count(*) FROM users;
```

**Состояние после каждого запроса:** заказов и позиций нет, пользователей 3, остатки исходные, полный снимок не изменился. Дополнительно GET /orders/999999 и POST /orders/999999/cancel тоже возвращают 404.

## 10. Некорректное количество и повтор товара

**Цель:** проверить валидацию до изменения БД. **Предусловие:** reset. Сохраните снимок.

**Действия:** `POST /orders` с каждым телом отдельно:

```json
{"user_id":1,"items":[{"product_id":1,"quantity":0}]}
```

```json
{"user_id":1,"items":[{"product_id":1,"quantity":-1}]}
```

```json
{"user_id":1,"items":[{"product_id":1,"quantity":1},{"product_id":1,"quantity":2}]}
```

**Ожидание:** каждый раз 422; `error.code=validation_error`, details содержит описание. Дополнительно проверьте пустой `items: []` и дробное quantity=1.5 — тоже 422.

```sql
SELECT count(*) FROM orders;
SELECT count(*) FROM order_items;
SELECT id, stock FROM products ORDER BY id;
```

**Состояние:** нет заказов и позиций, остатки исходные. Полный снимок не изменился после каждого запроса.

## 11. Конкурентная покупка последней единицы

**Цель:** проверить защиту от перепродажи. **Предусловие:** API запущен; эмулятор выключен. Reset для этого кейса не обязателен: скрипт создаёт свои данные.

Два последовательных нажатия в Swagger не гарантируют конкуренцию. Запустите готовый HTTP-сценарий:

```sh
docker compose exec -e API_URL=http://api:8000 api python -m tools.race
```

Скрипт создаст двух пользователей и новый товар с price=10.00 и stock=1. Затем отправит одновременно два запроса `POST /orders` с разными user_id:

```json
{"user_id":4,"items":[{"product_id":6,"quantity":1}]}
```

ID 4 и 6 — пример после reset; используйте фактические ID из вывода. Ответы затем можно прочитать через GET в Swagger.

**Ожидание:** один 201 с total_amount="10.00", другой 409 с insufficient_stock. Скрипт выводит PASS и код завершения 0. Победитель может быть любым.

```sql
-- Замените 6 на product_id из вывода скрипта.
SELECT id, price, stock FROM products WHERE id=6;
SELECT o.id, o.user_id, o.status, o.total_amount, i.quantity, i.unit_price
FROM orders o JOIN order_items i ON i.order_id=o.id WHERE i.product_id=6;
SELECT count(*) FROM order_items WHERE product_id=6;
```

**Состояние:** у нового товара stock=0; ровно один созданный заказ с одной позицией quantity=1 и unit_price=10.00. Для проверки остальных записей сохраните снимок до команды: добавятся только два пользователя, один товар, один заказ и одна позиция.

## 12. Данные после перезапуска

**Цель:** проверить постоянное хранение. **Предусловие:** reset, затем создайте заказ из кейса 3 через Swagger. Сохраните его ответ и полный снимок таблиц.

**Действие:** тела запроса нет. Остановите и заново создайте контейнеры, сохранив том:

```sh
docker compose down
docker compose up -d --wait
```

Не запускайте reset или seed между снимками. Не используйте флаг удаления тома.

**Ожидание API:** GET /health — 200; GET /orders/1 — 200, тот же заказ, включая id, created_at, сумму и позиции.

```sql
SELECT * FROM users ORDER BY id;
SELECT * FROM products ORDER BY id;
SELECT * FROM orders ORDER BY id;
SELECT * FROM order_items ORDER BY id;
```

**Состояние:** полный снимок совпадает с сохранённым; 3 пользователя, 5 товаров, один заказ и одна позиция; остаток товара 1 равен 8. Миграции не пересоздали и не очистили таблицы.
