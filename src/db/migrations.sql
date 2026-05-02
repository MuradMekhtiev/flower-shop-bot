-- Миграции схемы для цветочного магазина.
-- Все CREATE TABLE используют IF NOT EXISTS, чтобы скрипт был идемпотентным
-- и его можно было безопасно прогонять при каждом старте бота.

-- Товары (букеты). Цена хранится в рублях как INTEGER.
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL,
    image_path  TEXT,
    in_stock    INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Пользователи Telegram. telegram_id уникален — по нему ищем/создаём запись.
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    name        TEXT,
    phone       TEXT,
    address     TEXT,
    created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
);

-- Заказы. total — итоговая сумма в рублях, status имеет значение по умолчанию 'new'.
CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    total      INTEGER NOT NULL,
    status     TEXT    DEFAULT 'new',
    comment    TEXT,
    created_at TEXT    DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Позиции заказа. price дублируем из products на момент заказа,
-- чтобы история не «поплыла» при изменении цен в каталоге.
CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity   INTEGER NOT NULL,
    price      INTEGER NOT NULL,
    FOREIGN KEY (order_id)   REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Корзина пользователя. UNIQUE(user_id, product_id) — один товар хранится одной строкой,
-- повторное добавление просто увеличивает quantity (через UPSERT в коде).
CREATE TABLE IF NOT EXISTS cart_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT    DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, product_id),
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
