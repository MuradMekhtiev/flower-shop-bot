// Главная страница админки: статистика + топ товаров + последние заказы.

const express = require('express');
const router = express.Router();
const requireAuth = require('../auth');
const { getDashboardStats, getTopProducts } = require('../../db');

// requireAuth именно здесь, а не на app.use('/', ...) — иначе middleware
// перехватывал бы все неизвестные пути и слал их на /login вместо 404.
router.get('/', requireAuth, (req, res) => {
  const stats = getDashboardStats();
  const top = getTopProducts(3);
  res.render('dashboard', {
    title: 'Главная',
    stats,
    top,
  });
});

module.exports = router;
