// Заказы: список с фильтром по статусу, страница деталей, смена статуса.

const express = require('express');
const router = express.Router();
const {
  getOrdersWithCustomer,
  getOrderDetails,
  updateOrderStatus,
} = require('../../db');
const { ORDER_STATUSES } = require('../helpers');

// Список с фильтром ?status=
router.get('/', (req, res) => {
  const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
  const orders = getOrdersWithCustomer({ status });
  res.render('orders/list', {
    title: 'Заказы',
    orders,
    selectedStatus: status,
  });
});

// Деталка заказа.
router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(404).render('error', {
      title: 'Не найдено',
      code: 404,
      message: 'Некорректный id заказа.',
    });
  }
  const result = getOrderDetails(id);
  if (!result) {
    return res.status(404).render('error', {
      title: 'Не найдено',
      code: 404,
      message: `Заказ #${id} не найден.`,
    });
  }
  res.render('orders/detail', {
    title: `Заказ #${id}`,
    order: result.order,
    items: result.items,
  });
});

// Смена статуса. Принимаем только значения из белого списка.
router.post('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!ORDER_STATUSES.includes(status)) {
    req.session.flash = { type: 'danger', message: 'Недопустимый статус' };
    return res.redirect(`/orders/${id}`);
  }
  updateOrderStatus(id, status);
  req.session.flash = { type: 'success', message: `Статус заказа #${id} обновлён` };
  res.redirect(`/orders/${id}`);
});

module.exports = router;
