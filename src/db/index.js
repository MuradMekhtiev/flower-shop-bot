// Инициализация SQLite (better-sqlite3) и обёртки для запросов.
// Все запросы к БД идут через подготовленные выражения (db.prepare) —
// это даёт защиту от SQL-инъекций и заметный прирост скорости при повторных вызовах.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Путь к файлу БД. В разработке — data.db в корне проекта (рядом с index.js).
// В продакшене (Railway) задаётся через DB_PATH и указывает на файл внутри
// persistent volume, чтобы данные переживали редеплои.
const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.db');

// Гарантируем, что родительская директория существует — на свежесмонтированном
// volume она пустая, и Database() не создаст её сам.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// Открываем (или создаём) файл БД. В продакшене можно добавить { verbose: console.log }
// для дебага запросов, но в обычном режиме это шумно.
const db = new Database(DB_PATH);

// Включаем поддержку внешних ключей — в SQLite она ВЫКЛЮЧЕНА по умолчанию,
// и без этой строки FOREIGN KEY-ограничения просто игнорируются.
db.pragma('foreign_keys = ON');

// Прогоняем миграции из SQL-файла. Использован CREATE TABLE IF NOT EXISTS,
// поэтому повторный запуск не сломает существующие данные.
const migrationsSQL = fs.readFileSync(path.join(__dirname, 'migrations.sql'), 'utf8');
db.exec(migrationsSQL);

// --- Подготовленные выражения ---
// Готовим один раз при загрузке модуля и переиспользуем на каждый вызов.

// Каталог
const stmtAllProducts = db.prepare(
  'SELECT * FROM products WHERE in_stock = 1 ORDER BY id'
);
const stmtProductById = db.prepare('SELECT * FROM products WHERE id = ?');

// Пользователи
const stmtInsertUser = db.prepare(
  'INSERT OR IGNORE INTO users (telegram_id, name) VALUES (?, ?)'
);
const stmtUserByTelegramId = db.prepare(
  'SELECT * FROM users WHERE telegram_id = ?'
);
const stmtUpdateUserContact = db.prepare(
  'UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?'
);

// Корзина
// UPSERT: если строка (user_id, product_id) уже есть — увеличиваем quantity на 1.
const stmtAddToCart = db.prepare(`
  INSERT INTO cart_items (user_id, product_id, quantity)
  VALUES (?, ?, 1)
  ON CONFLICT(user_id, product_id)
  DO UPDATE SET quantity = quantity + 1
`);
const stmtCartItemQuantity = db.prepare(
  'SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?'
);
// JOIN с products — забираем имя/цену и сразу считаем subtotal на стороне БД.
const stmtCart = db.prepare(`
  SELECT
    c.product_id,
    p.name,
    p.price,
    c.quantity,
    (p.price * c.quantity) AS subtotal
  FROM cart_items c
  JOIN products p ON p.id = c.product_id
  WHERE c.user_id = ?
  ORDER BY c.id
`);
const stmtCartTotal = db.prepare(`
  SELECT COALESCE(SUM(p.price * c.quantity), 0) AS total
  FROM cart_items c
  JOIN products p ON p.id = c.product_id
  WHERE c.user_id = ?
`);
const stmtUpdateCartItem = db.prepare(
  'UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?'
);
const stmtDeleteCartItem = db.prepare(
  'DELETE FROM cart_items WHERE user_id = ? AND product_id = ?'
);
const stmtClearCart = db.prepare('DELETE FROM cart_items WHERE user_id = ?');

// Заказы
const stmtInsertOrder = db.prepare(
  'INSERT INTO orders (user_id, total, comment) VALUES (?, ?, ?)'
);
const stmtInsertOrderItem = db.prepare(
  'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)'
);

// --- Публичные методы-обёртки ---

// Возвращает все товары в наличии. Бросает исключение при ошибке БД —
// ловить её должен вызывающий код (хендлер бота).
const getAllProducts = () => stmtAllProducts.all();

// Возвращает товар по id или undefined, если не найден.
const getProductById = (id) => stmtProductById.get(id);

// Идемпотентно создаёт пользователя и сразу возвращает его запись.
// INSERT OR IGNORE не пытается обновить существующую строку — это намеренно:
// мы не хотим перетирать имя/телефон/адрес, который пользователь мог отредактировать.
const getOrCreateUser = (telegramId, name) => {
  stmtInsertUser.run(telegramId, name);
  return stmtUserByTelegramId.get(telegramId);
};

// Обновляет контактные данные пользователя (используется в финале checkout).
const updateUserContact = (userId, name, phone, address) => {
  stmtUpdateUserContact.run(name, phone, address, userId);
};

// --- Корзина ---

// Добавляет 1 шт. товара в корзину или увеличивает quantity на 1.
const addToCart = (userId, productId) => {
  stmtAddToCart.run(userId, productId);
};

// Текущее количество товара в корзине пользователя (0, если отсутствует).
const getCartItemQuantity = (userId, productId) => {
  const row = stmtCartItemQuantity.get(userId, productId);
  return row ? row.quantity : 0;
};

// Корзина с раскрытыми названиями/ценами и предрассчитанным subtotal.
const getCart = (userId) => stmtCart.all(userId);

// Сумма всех позиций (0, если корзина пуста).
const getCartTotal = (userId) => stmtCartTotal.get(userId).total;

// Устанавливает количество товара. Если quantity <= 0 — удаляет строку.
const updateCartItem = (userId, productId, quantity) => {
  if (quantity <= 0) {
    stmtDeleteCartItem.run(userId, productId);
  } else {
    stmtUpdateCartItem.run(quantity, userId, productId);
  }
};

// Полная очистка корзины пользователя.
const clearCart = (userId) => {
  stmtClearCart.run(userId);
};

// --- Заказ из корзины ---

// Транзакция: создаёт заказ, копирует cart_items в order_items, очищает корзину.
// При любой ошибке внутри callback'а better-sqlite3 откатит всё изменения.
// Возвращает id созданного заказа (Number).
const createOrderFromCart = db.transaction((userId, comment) => {
  const items = stmtCart.all(userId);
  if (items.length === 0) {
    throw new Error('Невозможно оформить пустую корзину');
  }
  const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const result = stmtInsertOrder.run(userId, total, comment);
  // lastInsertRowid возвращается как BigInt — приводим к Number,
  // чтобы спокойно использовать в шаблонах сообщений и арифметике.
  const orderId = Number(result.lastInsertRowid);
  for (const item of items) {
    stmtInsertOrderItem.run(orderId, item.product_id, item.quantity, item.price);
  }
  stmtClearCart.run(userId);
  return orderId;
});

// =============================================================================
// Методы для админки
// =============================================================================

// --- Товары: полный CRUD (без фильтра in_stock — админ видит всё) ---
const stmtAllProductsAdmin = db.prepare(
  'SELECT * FROM products ORDER BY id DESC'
);
const stmtInsertProduct = db.prepare(
  'INSERT INTO products (name, description, price, image_path, in_stock) VALUES (?, ?, ?, ?, ?)'
);
const stmtUpdateProduct = db.prepare(`
  UPDATE products
  SET name = ?, description = ?, price = ?, image_path = ?, in_stock = ?
  WHERE id = ?
`);
const stmtDeleteProduct = db.prepare('DELETE FROM products WHERE id = ?');

const getAllProductsForAdmin = () => stmtAllProductsAdmin.all();

const createProduct = ({ name, description, price, image_path, in_stock }) => {
  const result = stmtInsertProduct.run(
    name,
    description ?? null,
    price,
    image_path ?? null,
    in_stock ? 1 : 0
  );
  return Number(result.lastInsertRowid);
};

const updateProduct = (id, { name, description, price, image_path, in_stock }) => {
  stmtUpdateProduct.run(
    name,
    description ?? null,
    price,
    image_path ?? null,
    in_stock ? 1 : 0,
    id
  );
};

const deleteProduct = (id) => {
  stmtDeleteProduct.run(id);
};

// --- Заказы: список с клиентом, детали, смена статуса ---
// Один SQL обслуживает фильтр по статусу через COALESCE: NULL = «все статусы».
const stmtOrdersWithCustomer = db.prepare(`
  SELECT
    o.id, o.total, o.status, o.comment, o.created_at,
    u.id   AS customer_id,
    u.name AS customer_name,
    u.phone AS customer_phone,
    u.address AS customer_address,
    u.telegram_id
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  WHERE (? IS NULL OR o.status = ?)
  ORDER BY o.id DESC
`);
const stmtOrderById = db.prepare(`
  SELECT
    o.*,
    u.id   AS customer_id,
    u.name AS customer_name,
    u.phone AS customer_phone,
    u.address AS customer_address,
    u.telegram_id
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  WHERE o.id = ?
`);
const stmtOrderItems = db.prepare(`
  SELECT
    oi.id, oi.product_id, oi.quantity, oi.price,
    (oi.quantity * oi.price) AS subtotal,
    p.name AS product_name,
    p.image_path
  FROM order_items oi
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE oi.order_id = ?
  ORDER BY oi.id
`);
const stmtUpdateOrderStatus = db.prepare(
  'UPDATE orders SET status = ? WHERE id = ?'
);

const getOrdersWithCustomer = ({ status } = {}) => {
  // Если status не задан — передаём NULL, и условие в WHERE становится истинным.
  const filter = status || null;
  return stmtOrdersWithCustomer.all(filter, filter);
};

// Возвращает { order, items } или null, если заказ не найден.
const getOrderDetails = (orderId) => {
  const order = stmtOrderById.get(orderId);
  if (!order) return null;
  const items = stmtOrderItems.all(orderId);
  return { order, items };
};

const updateOrderStatus = (orderId, status) => {
  stmtUpdateOrderStatus.run(status, orderId);
};

// --- Дашборд: статистика и топ ---
const stmtDashboardStats = db.prepare(`
  SELECT
    COUNT(*)                                                              AS total_orders,
    COALESCE(SUM(CASE WHEN status = 'new'         THEN 1 ELSE 0 END), 0)  AS new_orders,
    COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0)  AS in_progress_orders,
    COALESCE(SUM(CASE WHEN status = 'delivered'   THEN 1 ELSE 0 END), 0)  AS delivered_orders,
    COALESCE(SUM(CASE WHEN status = 'cancelled'   THEN 1 ELSE 0 END), 0)  AS cancelled_orders,
    COALESCE(SUM(CASE WHEN status != 'cancelled'  THEN total ELSE 0 END), 0) AS total_revenue
  FROM orders
`);
const stmtRecentOrders = db.prepare(`
  SELECT
    o.id, o.total, o.status, o.created_at,
    u.name AS customer_name
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  ORDER BY o.id DESC
  LIMIT 5
`);
const stmtTopProducts = db.prepare(`
  SELECT
    p.id, p.name, p.price, p.image_path,
    COALESCE(SUM(oi.quantity), 0) AS sold
  FROM products p
  LEFT JOIN order_items oi ON oi.product_id = p.id
  LEFT JOIN orders o       ON o.id = oi.order_id AND o.status != 'cancelled'
  GROUP BY p.id
  ORDER BY sold DESC, p.id
  LIMIT ?
`);

const getDashboardStats = () => {
  const stats = stmtDashboardStats.get();
  const recentOrders = stmtRecentOrders.all();
  return { ...stats, recentOrders };
};

const getTopProducts = (limit = 3) => stmtTopProducts.all(limit);

module.exports = {
  db,
  // --- Бот ---
  getAllProducts,
  getProductById,
  getOrCreateUser,
  updateUserContact,
  addToCart,
  getCartItemQuantity,
  getCart,
  getCartTotal,
  updateCartItem,
  clearCart,
  createOrderFromCart,
  // --- Админка ---
  getAllProductsForAdmin,
  createProduct,
  updateProduct,
  deleteProduct,
  getOrdersWithCustomer,
  getOrderDetails,
  updateOrderStatus,
  getDashboardStats,
  getTopProducts,
};
