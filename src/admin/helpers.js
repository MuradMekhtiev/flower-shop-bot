// Константы статусов заказа в одном месте.
// Используется в роутах (валидация) и шаблонах (метки + цвета бейджей).

const ORDER_STATUSES = ['new', 'in_progress', 'delivered', 'cancelled'];

const ORDER_STATUS_LABELS = {
  new: 'Новый',
  in_progress: 'В работе',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};

// Bootstrap-цвета для классов вида bg-<color>.
const ORDER_STATUS_BADGES = {
  new: 'primary',
  in_progress: 'warning',
  delivered: 'success',
  cancelled: 'danger',
};

module.exports = {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_BADGES,
};
