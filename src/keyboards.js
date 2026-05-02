// Модуль клавиатур бота: главное меню, корзина, подтверждения, отмена в сцене.
const { Markup } = require('telegraf');

// Главная reply-клавиатура — показывается под полем ввода
const mainMenu = Markup.keyboard([
  ['🌹 Каталог', '🛒 Корзина'],
  ['📦 Мои заказы', 'ℹ️ О магазине'],
])
  .resize() // адаптивный размер кнопок
  .persistent(); // клавиатура остаётся видимой

// Inline-кнопки под карточкой товара
// productId передаётся в callback_data, чтобы обработчик знал какой товар добавить
const productActions = (productId) =>
  Markup.inlineKeyboard([
    Markup.button.callback('➕ В корзину', `add_${productId}`),
  ]);

// Inline-клавиатура корзины: на каждый товар по строке с ➖/➕,
// плюс снизу строка с управлением — очистить и оформить.
// Имя товара урезаем, чтобы кнопка влезала в одну строку на телефоне.
const truncate = (s, max = 18) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const cartKeyboard = (items) => {
  const rows = items.map((it) => [
    Markup.button.callback(`➖ ${truncate(it.name)}`, `dec_${it.product_id}`),
    Markup.button.callback(`➕ ${truncate(it.name)}`, `inc_${it.product_id}`),
  ]);
  rows.push([
    Markup.button.callback('🗑 Очистить', 'clear_cart'),
    Markup.button.callback('✅ Оформить заказ', 'checkout'),
  ]);
  return Markup.inlineKeyboard(rows);
};

// Inline-подтверждение очистки корзины.
const clearConfirmKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Да, очистить', 'clear_confirm'),
    Markup.button.callback('❌ Отмена', 'clear_cancel'),
  ],
]);

// Reply-клавиатура для шагов сцены оформления — кнопка отмены всегда под рукой.
const cancelReply = Markup.keyboard([['❌ Отмена']]).resize().oneTime(false);

module.exports = {
  mainMenu,
  productActions,
  cartKeyboard,
  clearConfirmKeyboard,
  cancelReply,
};
