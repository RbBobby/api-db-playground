import {escapeHtml as esc, money, cartTotal, readableError} from './utils.js';

const paths = {
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  box:'m12 3 9 5-9 5-9-5 9-5z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5',
  bag:'M5 7h14l1 14H4L5 7z M9 8V6a3 3 0 0 1 6 0v2',
  users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  db:'M3 5c0-4 18-4 18 0s-18 4-18 0z M3 5v7c0 4 18 4 18 0V5 M3 12v7c0 4 18 4 18 0v-7',
  flask:'M9 3h6 M10 3v6l-6 10a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3 M8 14h8',
  plus:'M12 5v14 M5 12h14', refresh:'M20 7a9 9 0 1 0 1 9 M20 3v5h-5',
  search:'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  arrow:'M4 12h16 M14 6l6 6-6 6', close:'M6 6l12 12 M6 18 18 6',
  info:'M12 11v6 M12 7h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  check:'M20 6 9 17l-5-5', copy:'M9 9h12v12H9z M15 9V3H3v12h6',
  notebook:'M5 3h14v18H5z M8 3v18 M11 8h5 M11 12h5',
  pen:'m4 16 12-12 4 4L8 20H4v-4z M14 6l4 4',
  mug:'M4 5h12v11a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V5z M16 6h2a3 3 0 0 1 0 6h-2',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
const $ = (selector) => document.querySelector(selector);
const nav = [['catalog','Каталог','grid'],['orders','Заказы','bag'],['users','Пользователи','users'],['database','Проверка БД','db'],['practice','Практика','flask']];
const state = {products:[], users:[], orders:[], cart:new Map(), user:null, journal:[], error:'', cartError:'', route:'catalog', search:'', orderFilter:'all', orderUser:'all', db:null, dbTable:'users', dbFilter:null, writing:false, loading:false, scenarios:{}};
let journalId = 0;
let toastTimer;
let loadGeneration = 0;
let initialized = false;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function connection(online) {
  const el = $('#connection');
  el.classList.toggle('offline', !online);
  el.innerHTML = `<span class="dot ${online ? '' : 'error'}"></span>${online ? 'API и PostgreSQL доступны' : 'Нет подключения · обновите данные'}`;
}

async function api(method, path, body) {
  const start = performance.now();
  const entry = {id:++journalId, time:new Date().toLocaleTimeString('ru-RU'), method, path, body, status:0, response:null};
  try {
    const response = await fetch(path, {method, headers:body === undefined ? {} : {'Content-Type':'application/json'}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(15000)});
    entry.status = response.status;
    entry.response = await response.json();
    if (!response.ok) throw new Error(readableError(entry.response, `Ошибка HTTP ${response.status}`));
    return entry.response;
  } catch (error) {
    if (!entry.status) {
      connection(false);
      entry.response = {error:{code:'network_error', message:'Сервис недоступен или время ожидания истекло. Проверьте подключение. Для запроса на изменение перед повтором проверьте записи: действие могло сохраниться.'}};
    }
    const requestError = new Error(entry.status ? error.message : entry.response.error.message);
    requestError.status = entry.status;
    throw requestError;
  } finally {
    entry.ms = Math.round(performance.now() - start);
    state.journal.unshift(entry);
    state.journal = state.journal.slice(0, 40);
    renderJournal();
  }
}

function renderJournal() {
  $('#journal-count').textContent = state.journal.length;
  $('#journal').innerHTML = state.journal.length ? `<div class="journal-list">${state.journal.slice(0, 6).map((entry) => `<button class="journal-entry" data-action="request" data-id="${entry.id}" aria-label="Детали ${entry.method} ${esc(entry.path)}, статус ${entry.status || 'сеть'}"><span class="journal-time">${entry.time}</span><span class="method ${entry.method.toLowerCase()}">${entry.method}</span><span class="journal-path">${esc(entry.path)}</span><span class="http-code ${entry.status >= 400 || !entry.status ? 'failed' : ''}">${entry.status || 'СЕТЬ'}</span><span class="journal-ms">${entry.ms} ms</span><span class="journal-chevron">↗</span></button>`).join('')}</div>` : '<div class="journal-empty">Пока нет запросов. Выполните действие или обновите данные.</div>';
}

async function loadAll() {
  const generation = ++loadGeneration;
  state.loading = true;
  state.error = '';
  render();
  try {
    const [products, users, orders] = await Promise.all([api('GET','/products'),api('GET','/users'),api('GET','/orders')]);
    if (generation !== loadGeneration) return;
    state.products = products;
    state.users = users;
    state.orders = orders;
    if (!users.some((user) => user.id === state.user)) state.user = users[0]?.id ?? null;
    for (const id of state.cart.keys()) if (!products.some((product) => product.id === id)) state.cart.delete(id);
    await api('GET','/health');
    connection(true);
  } catch (error) {
    if (generation === loadGeneration) state.error = error.message;
  } finally {
    if (generation === loadGeneration) {
      state.loading = false;
      render();
    }
  }
}

function heading(title, description, actions='') {
  return `<div class="page-heading"><div><div class="eyebrow">УЧЕБНЫЙ ПОЛИГОН</div><h1>${title}</h1><p class="page-description">${description}</p></div><div class="actions"><button class="button" data-action="refresh" ${state.loading ? 'disabled' : ''}>${icon('refresh')}Обновить</button>${actions}</div></div>${state.error ? `<div class="notice page-error" role="alert">${esc(state.error)}</div>` : ''}${state.loading ? '<div class="loading-bar" aria-label="Загрузка"></div>' : ''}`;
}

function empty(title, text, name='box') {
  return `<div class="empty-state">${icon(name)}<strong>${title}</strong><p>${text}</p></div>`;
}

function render() {
  $('#breadcrumb').textContent = nav.find((item) => item[0] === state.route)?.[1] || 'Каталог';
  $('#navigation').innerHTML = nav.map(([route,title,name]) => `<a href="#${route}" class="nav-item ${state.route === route ? 'active' : ''}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(name)}${title}</a>`).join('');
  const pages = {catalog:catalogPage, orders:ordersPage, users:usersPage, database:databasePage, practice:practicePage};
  $('#page').innerHTML = (pages[state.route] || catalogPage)();
  if (state.route === 'catalog') { renderProducts(); renderCart(); }
  if (state.route === 'database') renderDatabaseTable();
}

function catalogPage() {
  const inStock = state.products.filter((p) => p.stock > 0).length;
  return `${heading('Каталог товаров','Соберите заказ и проследите, как изменятся данные в базе.',`<button class="button primary" data-action="new-product">${icon('plus')}Добавить товар</button>`)}<div class="stats"><article class="stat"><div><p class="stat-label">Товаров в каталоге</p><div class="stat-value">${state.products.length}<span class="stat-note">позиций</span></div></div><span class="stat-icon">${icon('box')}</span></article><article class="stat"><div><p class="stat-label">Доступно для заказа</p><div class="stat-value">${inStock}<span class="stat-note">позиций</span></div></div><span class="stat-icon">${icon('check')}</span></article><article class="stat"><div><p class="stat-label">Создано заказов</p><div class="stat-value">${state.orders.length}<span class="stat-note">всего</span></div></div><span class="stat-icon">${icon('bag')}</span></article></div><div class="catalog-layout"><section class="panel" aria-labelledby="products-title"><div class="panel-heading"><div><h2 id="products-title">Все товары <span class="count">${state.products.length}</span></h2><p>Актуальные цены и остатки на складе</p></div><span class="mono muted" style="font-size:9px">/products</span></div><div class="search">${icon('search')}<input type="search" id="product-search" aria-label="Найти товар" placeholder="Поиск по названию или ID…" value="${esc(state.search)}"></div><div id="product-list"></div><div class="table-footer">${icon('db')}Данные загружены из PostgreSQL · обновляйте после действий эмулятора</div></section><div><section class="panel cart-panel" aria-labelledby="cart-title"><div class="panel-heading"><h2 class="cart-heading" id="cart-title">${icon('bag')}Новый заказ</h2><span class="count" id="cart-count">0</span></div><div id="cart" class="cart-content"></div></section><div class="tip">${icon('info')}<p><strong>От действия к проверке</strong>Создайте заказ, затем откройте «Проверка БД». Остатки изменятся в той же транзакции.</p></div></div></div>`;
}

function renderProducts() {
  const target = $('#product-list');
  if (!target) return;
  const term = state.search.toLocaleLowerCase('ru');
  const products = state.products.filter((p) => p.name.toLocaleLowerCase('ru').includes(term) || String(p.id).includes(term));
  if (!products.length) {
    target.innerHTML = state.loading ? '<div class="loading">Загружаем товары…</div>' : empty(state.search ? 'Ничего не найдено' : 'В каталоге пока пусто', state.search ? 'Попробуйте другое название или ID.' : 'Добавьте первый товар кнопкой выше.');
    return;
  }
  target.innerHTML = `<table class="product-table"><thead><tr><th scope="col">ТОВАР</th><th scope="col">ЦЕНА</th><th scope="col">НА СКЛАДЕ</th><th scope="col"><span class="muted">В ЗАКАЗ</span></th></tr></thead><tbody>${products.map((p) => `<tr><td><div class="product-name"><span class="product-glyph v${p.id % 5}">${icon(/блокнот/i.test(p.name) ? 'notebook' : /ручка/i.test(p.name) ? 'pen' : /кружка/i.test(p.name) ? 'mug' : 'box')}</span><span><strong>${esc(p.name)}</strong><small class="mono">ID ${String(p.id).padStart(3,'0')}</small></span></div></td><td class="price">${money(p.price)}</td><td><span class="stock ${p.stock === 0 ? 'empty' : p.stock <= 3 ? 'low' : ''}">${p.stock === 0 ? 'Нет в наличии' : `${p.stock} шт.`}</span></td><td><button class="product-add" data-action="add" data-id="${p.id}" aria-label="В корзину: ${esc(p.name)}" ${p.stock === 0 || state.writing ? 'disabled' : ''}>${icon('plus')}<span class="add-label">Добавить</span></button></td></tr>`).join('')}</tbody></table>`;
}

function renderCart() {
  const el = $('#cart');
  if (!el) return;
  const count = [...state.cart.values()].reduce((sum,value) => sum + value, 0);
  $('#cart-count').textContent = count;
  el.innerHTML = `<div class="field"><label for="cart-user">Покупатель</label><select id="cart-user" ${state.writing ? 'disabled' : ''}>${state.users.length ? state.users.map((u) => `<option value="${u.id}" ${u.id === state.user ? 'selected' : ''}>${esc(u.name)} · ID ${u.id}</option>`).join('') : '<option value="">Сначала создайте пользователя</option>'}</select></div>${state.cartError ? `<div class="notice" role="alert">${esc(state.cartError)}</div>` : ''}${state.cart.size ? [...state.cart].map(([id,quantity]) => {
    const p = state.products.find((p) => p.id === id);
    if (!p) return '';
    return `<div class="cart-item"><div class="cart-item-top"><strong>${esc(p.name)}</strong><button class="remove" data-action="remove" data-id="${id}" aria-label="Удалить из корзины: ${esc(p.name)}" ${state.writing ? 'disabled' : ''}>${icon('close')}</button></div><div class="cart-item-bottom"><div class="quantity"><button data-action="less" data-id="${id}" aria-label="Уменьшить количество: ${esc(p.name)}" ${state.writing ? 'disabled' : ''}>−</button><input type="number" min="1" max="1000000" step="1" value="${quantity}" data-quantity="${id}" aria-label="Количество: ${esc(p.name)}" ${state.writing ? 'disabled' : ''}><button data-action="more" data-id="${id}" aria-label="Увеличить количество: ${esc(p.name)}" ${state.writing ? 'disabled' : ''}>+</button></div><span class="cart-item-price">${money(cartTotal(new Map([[id,quantity]]),state.products))}</span></div></div>`;
  }).join('') : `<div class="cart-empty">${icon('bag')}<strong>Здесь будет ваш заказ</strong><p>Добавьте товары из каталога,<br>чтобы начать проверку</p></div>`}<div class="total"><span>Итого</span><strong>${money(cartTotal(state.cart,state.products))}</strong></div><button class="button primary full" data-action="checkout" ${!state.cart.size || !state.user || state.writing || state.loading ? 'disabled' : ''}>${state.writing ? 'Создаём заказ…' : 'Создать заказ'}${icon('arrow')}</button><p class="cart-help">Стоимость рассчитывается сервером.<br>После заказа остатки обновятся автоматически.</p>`;
}

function ordersPage() {
  const orders = state.orders.filter((o) => (state.orderFilter === 'all' || o.status === state.orderFilter) && (state.orderUser === 'all' || String(o.user_id) === state.orderUser));
  return `${heading('Заказы','Проверяйте состав, сумму и возврат остатков при отмене.')}<div class="order-filters"><select id="order-status" aria-label="Статус заказа"><option value="all" ${state.orderFilter === 'all' ? 'selected' : ''}>Все статусы</option><option value="created" ${state.orderFilter === 'created' ? 'selected' : ''}>Созданные</option><option value="cancelled" ${state.orderFilter === 'cancelled' ? 'selected' : ''}>Отменённые</option></select><select id="order-user" aria-label="Покупатель заказа"><option value="all">Все покупатели</option>${state.users.map((u) => `<option value="${u.id}" ${state.orderUser === String(u.id) ? 'selected' : ''}>${esc(u.name)} · ID ${u.id}</option>`).join('')}</select></div><div class="orders-list">${orders.length ? orders.map((o) => `<article class="panel order-card"><div class="order-top"><div><div class="order-identity"><strong>Заказ #${String(o.id).padStart(3,'0')}</strong><span class="status-badge ${o.status}">${o.status === 'created' ? 'Создан' : 'Отменён'}</span></div><p class="order-meta">${esc(state.users.find((u) => u.id === o.user_id)?.name || `Пользователь ${o.user_id}`)} · ${new Date(o.created_at).toLocaleString('ru-RU')}${o.cancelled_at ? ` · отменён ${new Date(o.cancelled_at).toLocaleString('ru-RU')}` : ''}</p></div>${icon('bag')}</div><div class="order-lines">${o.items.map((i) => `<span class="order-line">${esc(state.products.find((p) => p.id === i.product_id)?.name || `Товар ${i.product_id}`)} × ${i.quantity} · ${money(i.unit_price)}</span>`).join('')}</div><div class="order-bottom"><strong>${money(o.total_amount)}</strong><div class="actions"><button class="button small" data-action="inspect-order" data-id="${o.id}">${icon('db')}Проверить в БД</button><button class="button small ${o.status === 'created' ? 'danger' : ''}" data-action="cancel" data-id="${o.id}" ${state.writing ? 'disabled' : ''}>${o.status === 'created' ? 'Отменить заказ' : 'Повторить отмену'}</button></div></div></article>`).join('') : `<div class="panel">${empty('Заказов пока нет','Соберите заказ в каталоге или измените фильтр.','bag')}</div>`}</div>`;
}

function usersPage() {
  return `${heading('Пользователи','Создавайте покупателей и проверяйте уникальность email.',`<button class="button primary" data-action="new-user">${icon('plus')}Новый пользователь</button>`)}<div class="users-grid">${state.users.length ? state.users.map((u) => `<article class="panel user-card"><div class="avatar">${esc(u.name.slice(0,1).toLocaleUpperCase('ru'))}</div><h2>${esc(u.name)}</h2><p>${esc(u.email)}</p><div class="user-card-bottom"><small class="mono">USER ${String(u.id).padStart(3,'0')}</small><button class="text-button" data-action="user-orders" data-id="${u.id}">Заказы покупателя ↗</button></div></article>`).join('') : `<div class="panel">${empty('Нет пользователей','Создайте первого покупателя.','users')}</div>`}</div>`;
}

function databasePage() {
  return `${heading('Проверка базы данных','Читайте реальные записи PostgreSQL и сравнивайте их с результатами действий.')}<div class="notice info">${icon('info')} Только чтение. Снимок всех таблиц получен одним SQL-запросом; он обновляется кнопкой «Обновить».</div><section class="panel"><div class="panel-heading"><div><h2>Таблицы магазина</h2><p>${state.db ? `База ${esc(state.db.database)} · снимок на ${new Date(state.db.loadedAt).toLocaleTimeString('ru-RU')}` : 'Загрузка снимка PostgreSQL…'}</p></div><span class="mono muted" style="font-size:10px">READ ONLY</span></div><div class="database-tabs" role="group" aria-label="Таблица базы данных">${['users','products','orders','order_items'].map((table) => `<button class="tab ${state.dbTable === table ? 'active' : ''}" data-action="db-table" data-table="${table}" aria-pressed="${state.dbTable === table}">${table} <span class="count">${state.db?.tables[table]?.length ?? '—'}</span></button>`).join('')}</div>${state.dbFilter ? `<div class="notice info" style="margin:15px">Показан заказ #${state.dbFilter} <button class="text-button" data-action="clear-db-filter">Показать все</button></div>` : ''}<div class="database-scroll" id="db-table"></div></section><section class="panel sql-panel"><div class="sql-title"><h2>Проверьте самостоятельно</h2><button class="button small" data-action="copy-sql">${icon('copy')}Копировать SQL</button></div><pre class="code" id="sql-code">${esc(sqlQuery())}</pre><p class="readonly-note">Этот запрос можно выполнить в DBeaver или psql. Просмотр выше показывает записи напрямую из базы, а не локальные данные интерфейса.</p></section>`;
}

function sqlQuery() {
  if (state.dbFilter) return `SELECT o.id, o.status, o.total_amount, o.cancelled_at,\n       u.email, i.product_id, i.quantity, i.unit_price, p.stock\nFROM orders o\nJOIN users u ON u.id = o.user_id\nJOIN order_items i ON i.order_id = o.id\nJOIN products p ON p.id = i.product_id\nWHERE o.id = ${state.dbFilter};`;
  return `SELECT * FROM ${state.dbTable} ORDER BY id;`;
}

function renderDatabaseTable() {
  const el = $('#db-table');
  if (!el) return;
  if (!state.db) { el.innerHTML = '<div class="loading">Получаем записи из базы…</div>'; return; }
  let rows = state.db.tables[state.dbTable] || [];
  if (state.dbFilter) rows = rows.filter((row) => state.dbTable === 'orders' ? row.id === state.dbFilter : state.dbTable === 'order_items' ? row.order_id === state.dbFilter : true);
  const columns = rows.length ? Object.keys(rows[0]).sort((a,b) => a === 'id' ? -1 : b === 'id' ? 1 : a.localeCompare(b)) : [];
  el.innerHTML = rows.length ? `<table class="db-table"><thead><tr>${columns.map((key) => `<th scope="col">${esc(key)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((key) => `<td title="${esc(row[key] === null ? 'NULL' : row[key])}">${row[key] === null ? '<span class="muted">NULL</span>' : esc(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : empty('В таблице пока нет записей','Выполните действие в магазине и обновите снимок.','db');
}

async function loadDatabase() {
  try {
    const data = await api('GET','/lab/database');
    state.db = {...data,loadedAt:Date.now()};
    state.error = '';
  } catch (error) { state.error = error.message; }
  if (state.route === 'database') render();
}

const scenarios = [
  ['stock','Недостаточный остаток','Заказ на количество больше остатка должен вернуть 409. Ни одна запись не должна измениться.','409'],
  ['atomic','Откат всего заказа','Первый товар доступен, второго не хватает. Проверим, что первая позиция тоже не была списана.','409'],
  ['validation','Некорректное количество','Передадим количество 0. API должен вернуть 422, сохранив все таблицы без изменений.','422'],
];
function practicePage() {
  return `${heading('Практика тестирования','Запускайте проверки и сопоставляйте HTTP-ответ с состоянием всех таблиц.')}<div class="notice info">Проверки сравнивают снимки БД до и после запроса. На время проверки остановите эмулятор, чтобы фоновые изменения не повлияли на результат.</div><div class="scenario-grid">${scenarios.map(([id,title,text,code],i) => `<article class="panel scenario"><div class="scenario-number">СЦЕНАРИЙ 0${i+1} <span class="count">HTTP ${code}</span></div><h2>${title}</h2><p>${text}</p><button class="button" data-action="scenario" data-scenario="${id}" ${state.writing ? 'disabled' : ''}>${icon('flask')}${state.scenarios[id]?.running ? 'Проверяем…' : 'Запустить проверку'}</button>${state.scenarios[id]?.text ? `<div class="scenario-result ${state.scenarios[id].passed ? 'passed' : 'failed'}" role="status">${esc(state.scenarios[id].text)}</div>` : ''}</article>`).join('')}</div><section class="panel sql-panel"><h2>От запроса к данным</h2><p class="page-description">1. Создайте заказ в каталоге.<br>2. Найдите его в разделе «Заказы».<br>3. Нажмите «Проверить в БД» и сопоставьте заказ, позиции и остатки.<br>4. Отмените заказ и проверьте, что товары вернулись на склад.<br>5. Повторите отмену: остатки должны остаться прежними.</p><a class="button" style="margin-top:18px" href="/docs" target="_blank" rel="noopener">Открыть Swagger ↗</a></section>`;
}

async function runScenario(id) {
  if (state.writing) return;
  state.writing = true;
  state.scenarios[id] = {running:true};
  render();
  try {
    const before = await api('GET','/lab/database');
    const user = before.tables.users[0];
    const product = before.tables.products.find((p) => p.stock > 0 && p.stock < 1000000);
    if (!user || !product) throw new Error('Нужны пользователь и товар с остатком от 1 до 999999. Добавьте их в интерфейсе.');
    let items;
    if (id === 'stock') items = [{product_id:product.id,quantity:product.stock+1}];
    else if (id === 'validation') items = [{product_id:product.id,quantity:0}];
    else {
      const second = before.tables.products.find((p) => p.id !== product.id && p.stock < 1000000);
      if (!second) throw new Error('Для проверки атомарности нужен ещё один товар с остатком меньше 1000000.');
      items = [{product_id:product.id,quantity:1},{product_id:second.id,quantity:second.stock+1}];
    }
    let status;
    try { await api('POST','/orders',{user_id:user.id,items}); status = 201; }
    catch (error) { status = error.status || 0; }
    const after = await api('GET','/lab/database');
    const expected = id === 'validation' ? 422 : 409;
    const same = JSON.stringify(before.tables) === JSON.stringify(after.tables);
    state.scenarios[id] = {running:false,passed:status === expected && same,text:`HTTP ${status || 'сеть'} · ${same ? 'все 4 таблицы без изменений' : 'состояние таблиц изменилось'}. ${status === expected && same ? 'Проверка пройдена.' : 'Проверка не пройдена — изучите журнал.'}`};
  } catch (error) { state.scenarios[id] = {running:false,passed:false,text:error.message}; }
  finally { state.writing = false; render(); }
}

function openModal(title, content) {
  const modal = $('#modal');
  if (modal.open) modal.close();
  $('#modal-content').innerHTML = `<div class="modal-heading"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть окно">${icon('close')}</button></div>${content}`;
  modal.showModal();
}

function newUser() {
  openModal('Новый пользователь',`<form class="modal-form" id="user-form"><div class="field"><label for="user-name">Имя</label><input id="user-name" name="name" required maxlength="100" placeholder="Например, Анна" autofocus></div><div class="field"><label for="user-email">Email</label><input id="user-email" name="email" type="email" required maxlength="254" placeholder="anna@example.com"><small>Email должен быть уникальным.</small></div><div class="notice" id="form-error" role="alert"></div><div class="actions"><button type="button" class="button" data-action="close-modal">Отмена</button><button type="submit" class="button primary">Создать пользователя</button></div></form>`);
}

function newProduct() {
  openModal('Добавить товар',`<form class="modal-form" id="product-form"><div class="field"><label for="product-name">Название</label><input id="product-name" name="name" required maxlength="100" placeholder="Например, Настольная лампа" autofocus></div><div class="form-row"><div class="field"><label for="product-price">Цена, ₽</label><input id="product-price" name="price" type="number" min="0.01" max="9999999999.99" step="0.01" required placeholder="990.00"></div><div class="field"><label for="product-stock">Количество на складе</label><input id="product-stock" name="stock" type="number" min="0" max="2147483647" step="1" required placeholder="10"></div></div><div class="notice" id="form-error" role="alert"></div><div class="actions"><button type="button" class="button" data-action="close-modal">Отмена</button><button type="submit" class="button primary">Добавить товар</button></div></form>`);
}

async function checkout() {
  if (!state.cart.size || !state.user || state.writing) return;
  const body = {user_id:state.user,items:[...state.cart].map(([product_id,quantity]) => ({product_id,quantity}))};
  state.writing = true;
  state.cartError = '';
  renderCart();
  renderProducts();
  try {
    const order = await api('POST','/orders',body);
    state.cart.clear();
    toast(`Заказ #${order.id} создан. Остатки обновлены.`);
    await loadAll();
  } catch (error) { state.cartError = error.message; }
  finally { state.writing = false; render(); }
}

async function cancelOrder(id) {
  if (state.writing) return;
  state.writing = true;
  render();
  try {
    const alreadyCancelled = state.orders.find((o) => o.id === id)?.status === 'cancelled';
    await api('POST',`/orders/${id}/cancel`);
    toast(alreadyCancelled ? 'Повторная отмена выполнена. Остатки не увеличились.' : `Заказ #${id} отменён. Товары возвращены на склад.`);
    await loadAll();
  } catch (error) { state.error = error.message; }
  finally { state.writing = false; render(); }
}

async function routeChanged() {
  const route = location.hash.slice(1);
  state.route = nav.some((item) => item[0] === route) ? route : 'catalog';
  render();
  if (state.route === 'database' && initialized) await loadDatabase();
}

async function action(event) {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const name = button.dataset.action;
  const id = Number(button.dataset.id);
  if (name === 'close-modal') { $('#modal').close(); return; }
  if (name === 'request') {
    const entry = state.journal.find((e) => e.id === id);
    if (!entry) return;
    openModal('Детали запроса',`<p class="mono" style="font-size:12px">${entry.method} ${esc(entry.path)} · HTTP ${entry.status || 'сеть'} · ${entry.ms} ms</p><p class="modal-json-label">ТЕЛО ЗАПРОСА</p><pre class="code">${esc(entry.body === undefined ? 'Без тела запроса' : JSON.stringify(entry.body,null,2))}</pre><p class="modal-json-label">ОТВЕТ СЕРВЕРА</p><pre class="code">${esc(JSON.stringify(entry.response,null,2))}</pre>`);
    return;
  }
  if (name === 'refresh') { await loadAll(); if (state.route === 'database') await loadDatabase(); return; }
  if (name === 'db-table') {
    state.dbTable = button.dataset.table;
    if (!['orders','order_items'].includes(state.dbTable)) state.dbFilter = null;
    render();
    return;
  }
  if (name === 'clear-db-filter') { state.dbFilter = null; render(); return; }
  if (name === 'copy-sql') {
    try { await navigator.clipboard.writeText(sqlQuery()); toast('SQL скопирован'); }
    catch { toast('Не удалось скопировать. Выделите запрос и скопируйте вручную.'); }
    return;
  }
  if (name === 'inspect-order') { state.dbTable = 'orders'; state.dbFilter = id; location.hash = 'database'; return; }
  if (name === 'user-orders') { state.orderUser = String(id); state.orderFilter = 'all'; location.hash = 'orders'; return; }
  if (state.writing) return;
  if (name === 'new-user') newUser();
  if (name === 'new-product') newProduct();
  if (name === 'add' || name === 'more') {
    const current = state.cart.get(id) || 0;
    if (current >= 1000000) { toast('Максимум — 1000000 единиц на позицию'); return; }
    if (!state.cart.has(id) && state.cart.size >= 100) { toast('В заказе может быть не больше 100 разных товаров'); return; }
    state.cart.set(id,current+1);
    state.cartError = '';
    renderCart();
    if (name === 'add') toast('Товар добавлен в заказ');
  }
  if (name === 'less') { const quantity = state.cart.get(id) || 1; if (quantity <= 1) state.cart.delete(id); else state.cart.set(id,quantity-1); state.cartError = ''; renderCart(); }
  if (name === 'remove') { state.cart.delete(id); state.cartError = ''; renderCart(); }
  if (name === 'checkout') await checkout();
  if (name === 'cancel') await cancelOrder(id);
  if (name === 'scenario') await runScenario(button.dataset.scenario);
}

document.addEventListener('click',(event) => { action(event).catch((error) => { state.error = error.message; render(); }); });
document.addEventListener('input',(event) => {
  if (event.target.id === 'product-search') { state.search = event.target.value; renderProducts(); }
  const el = event.target;
  if (el.dataset.quantity && !state.writing) {
    const id = Number(el.dataset.quantity);
    const value = Number(el.value);
    el.setCustomValidity('');
    if (!Number.isInteger(value) || value < 1 || value > 1000000) {
      el.setCustomValidity('Введите целое количество от 1 до 1000000');
    } else {
      state.cart.set(id,value);
      const product = state.products.find((p) => p.id === id);
      el.closest('.cart-item').querySelector('.cart-item-price').textContent = money(cartTotal(new Map([[id,value]]),[product]));
      $('#cart .total strong').textContent = money(cartTotal(state.cart,state.products));
      $('#cart-count').textContent = [...state.cart.values()].reduce((sum,quantity) => sum+quantity,0);
    }
    // Не пересоздаём DOM при blur: иначе следующий клик по кнопке теряется.
    $('#cart [data-action="checkout"]').disabled = state.loading || !state.user || [...document.querySelectorAll('[data-quantity]')].some((input) => !input.validity.valid);
  }
});
document.addEventListener('change',(event) => {
  const el = event.target;
  if (el.id === 'cart-user') state.user = Number(el.value) || null;
  if (el.id === 'order-status') { state.orderFilter = el.value; render(); }
  if (el.id === 'order-user') { state.orderUser = el.value; render(); }
  if (el.dataset.quantity) {
    if (!el.validity.valid) {
      toast('Введите целое количество от 1 до 1000000');
      el.reportValidity();
    }
  }
});
document.addEventListener('submit',async (event) => {
  const form = event.target;
  if (!['user-form','product-form'].includes(form.id)) return;
  event.preventDefault();
  if (state.writing || form.dataset.busy === 'true') return;
  form.dataset.busy = 'true';
  state.writing = true;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const fields = new FormData(form);
  const isUser = form.id === 'user-form';
  const body = isUser ? {name:fields.get('name').trim(),email:fields.get('email').trim()} : {name:fields.get('name').trim(),price:fields.get('price'),stock:Number(fields.get('stock'))};
  try {
    const result = await api('POST',isUser ? '/users' : '/products',body);
    if (isUser) state.user = result.id;
    $('#modal').close();
    toast(isUser ? 'Пользователь создан и выбран покупателем' : 'Товар добавлен в каталог');
    await loadAll();
  } catch (error) {
    const errorEl = form.querySelector('#form-error');
    if (errorEl) errorEl.textContent = error.message;
  } finally {
    state.writing = false;
    form.dataset.busy = 'false';
    submit.disabled = false;
    render();
  }
});
$('#clear-journal').addEventListener('click',() => { state.journal = []; renderJournal(); });
window.addEventListener('hashchange',routeChanged);
await routeChanged();
await loadAll();
initialized = true;
if (state.route === 'database') await loadDatabase();
