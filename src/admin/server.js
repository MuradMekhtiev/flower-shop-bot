// Express-приложение админки. Запускается из index.js параллельно с ботом.
// Использует ту же БД (src/db), сессии хранятся в памяти процесса.

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');

const requireAuth = require('./auth');
const helpers = require('./helpers');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const ordersRoutes = require('./routes/orders');
const productsRoutes = require('./routes/products');

const app = express();
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// --- Шаблонизатор: EJS + общий layout через express-ejs-layouts ---
// Все view рендерятся внутри views/layout.ejs (за исключением login —
// там в render передаётся layout: false для отрисовки без обёртки).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// --- Статика: стили и фото товаров ---
// Содержимое public/ доступно по корню сайта (например, /styles.css, /uploads/xxx.jpg).
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

// --- Парсеры тела запроса и cookie ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// method-override: формы шлют POST с hidden-полем _method=PUT|DELETE,
// здесь оно превращается в реальный HTTP-метод для нужного роута.
app.use(methodOverride('_method'));

// --- Сессии ---
// MemoryStore используется в проде только для одного процесса; для горизонтального
// масштабирования стоит подключить connect-redis или connect-sqlite3.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
  },
}));

// --- Локальные переменные для шаблонов ---
// currentPath — для подсветки активного пункта sidebar.
// flash      — одноразовое сообщение (читаем и сразу очищаем).
// STATUSES/STATUS_LABELS/STATUS_BADGES — справочники для select/badge.
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.STATUSES = helpers.ORDER_STATUSES;
  res.locals.STATUS_LABELS = helpers.ORDER_STATUS_LABELS;
  res.locals.STATUS_BADGES = helpers.ORDER_STATUS_BADGES;
  next();
});

// --- Маршруты ---
// authRoutes — без requireAuth (там /login и /logout).
// dashboardRoutes mount-ится на /, поэтому защиту ставим ВНУТРИ роутера на
// конкретный route '/' — иначе middleware ловил бы и /unknown, и редиректил
// его на /login вместо честного 404.
// orders/products — на собственных префиксах, тут requireAuth можно вешать на mount.
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/orders', requireAuth, ordersRoutes);
app.use('/products', requireAuth, productsRoutes);

// --- 404 ---
// Любой не-сматчившийся запрос. В Express 5 catch-all делается обычным
// middleware без route — wildcard-роуты ('*') теперь требуют другого синтаксиса.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Не найдено',
    code: 404,
    message: 'Такой страницы нет.',
  });
});

// --- 500: error handler (всегда 4 аргумента!) ---
app.use((err, req, res, _next) => {
  console.error('❌ Express ошибка:', err);
  res.status(500).render('error', {
    title: 'Ошибка',
    code: 500,
    message: 'Произошла ошибка на сервере. Попробуйте позже.',
  });
});

module.exports = app;
