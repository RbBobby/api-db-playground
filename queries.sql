-- Выполняйте SELECT отдельно. Эти запросы не меняют данные.
-- Замените 1 на ID, полученный в Swagger.

-- Q1. Пользователи и уникальность email.
SELECT * FROM users ORDER BY id;
SELECT email, count(*) FROM users GROUP BY email HAVING count(*) > 1;
-- Последний запрос должен вернуть 0 строк.

-- Q2. Остатки и цены. На свежем полигоне: 10,20,3,1,0.
SELECT id, name, price, stock FROM products ORDER BY id;

-- Q3. Число записей: сравните до и после неуспешного запроса.
SELECT (SELECT count(*) FROM users) AS users_count,
       (SELECT count(*) FROM products) AS products_count,
       (SELECT count(*) FROM orders) AS orders_count,
       (SELECT count(*) FROM order_items) AS items_count;

-- Q4. Содержимое заказа и все связанные сущности.
SELECT o.id AS order_id, u.email, o.status, o.total_amount,
       o.created_at, o.cancelled_at, p.id AS product_id, p.name,
       i.quantity, i.unit_price, i.quantity * i.unit_price AS line_total,
       p.stock AS current_stock
FROM orders o
JOIN users u ON u.id = o.user_id
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.id = 1 ORDER BY i.id;

-- Q5. Заказы без позиций или с неправильной итоговой суммой: ожидается 0 строк.
SELECT o.id, o.total_amount, count(i.id) AS item_count,
       coalesce(sum(i.quantity * i.unit_price), 0) AS calculated_total
FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
GROUP BY o.id
HAVING count(i.id) = 0 OR o.total_amount <> coalesce(sum(i.quantity * i.unit_price), 0);

-- Q6. Нарушения остатка и состояния отмены: ожидается 0 строк.
SELECT * FROM products WHERE stock < 0;
SELECT * FROM orders WHERE
    (status = 'created' AND cancelled_at IS NOT NULL) OR
    (status = 'cancelled' AND cancelled_at IS NULL);

-- Q7. Снимок всех таблиц до/после. Сохраните результаты и сравните при отказе.
-- Выполняйте без работающего эмулятора. ID sequence может иметь пропуски после отката.
SELECT 'users' AS entity, coalesce(jsonb_agg(to_jsonb(u) ORDER BY id), '[]'::jsonb) AS data FROM users u
UNION ALL
SELECT 'products', coalesce(jsonb_agg(to_jsonb(p) ORDER BY id), '[]'::jsonb) FROM products p
UNION ALL
SELECT 'orders', coalesce(jsonb_agg(to_jsonb(o) ORDER BY id), '[]'::jsonb) FROM orders o
UNION ALL
SELECT 'order_items', coalesce(jsonb_agg(to_jsonb(i) ORDER BY id), '[]'::jsonb) FROM order_items i;

-- Q8. Число успешно созданных заказов на товар в конкурентном сценарии.
-- Замените product_id=1 на значение, выведенное tools.race.
SELECT p.id, p.stock, count(DISTINCT o.id) AS order_count,
       coalesce(sum(i.quantity), 0) AS sold_quantity
FROM products p
LEFT JOIN order_items i ON i.product_id = p.id
LEFT JOIN orders o ON o.id = i.order_id
WHERE p.id = 1 GROUP BY p.id;

-- Q9. Согласованность исходных остатков с активными заказами (только demo-товары).
-- Используйте после reset. Прямая ручная правка stock нарушит это ожидание.
WITH initial(name, stock) AS (
  VALUES ('Блокнот',10), ('Ручка',20), ('Рюкзак',3), ('Кружка',1), ('Календарь',0)
)
SELECT p.id, p.name, p.stock,
       initial.stock - coalesce(sum(i.quantity) FILTER (WHERE o.status='created'), 0) AS expected_stock
FROM initial JOIN products p ON p.name = initial.name
LEFT JOIN order_items i ON i.product_id=p.id
LEFT JOIN orders o ON o.id=i.order_id
GROUP BY p.id, initial.stock
HAVING p.stock <> initial.stock - coalesce(sum(i.quantity) FILTER (WHERE o.status='created'), 0);
-- Ожидается 0 строк.
