// Основной модуль бота: Telegraf + Scenes (WizardScene) для checkout.
// Логика хендлеров вынесена в именованные функции, чтобы их можно было
// переиспользовать как в обычных bot.hears, так и при выходе из сцены.

const { Telegraf, Scenes, session } = require('telegraf');
const { message } = require('telegraf/filters');

const {
  mainMenu,
  productActions,
  cartKeyboard,
  clearConfirmKeyboard,
  cancelReply,
} = require('./keyboards');

const {
  getAllProducts,
  getOrCreateUser,
  addToCart,
  getCartItemQuantity,
  getCart,
  getCartTotal,
  updateCartItem,
  clearCart,
  createOrderFromCart,
  updateUserContact,
} = require('./db');

// =============================================================================
// Вспомогательные функции
// =============================================================================

// Получает (или создаёт) пользователя в БД по данным из ctx и возвращает запись.
// Используется почти в каждом хендлере, поэтому вынесено отдельно.
const ensureUser = (ctx) =>
  getOrCreateUser(ctx.from.id, ctx.from.first_name || 'друг');

// Собирает текст и клавиатуру для текущего состояния корзины.
// Если корзина пуста — отдаёт сообщение без inline-кнопок.
const renderCart = (userId) => {
  const items = getCart(userId);
  if (items.length === 0) {
    return {
      text: '🛒 *Корзина пуста.*\n\nЗагляните в каталог — там есть на что посмотреть! 🌸',
      extra: { parse_mode: 'Markdown' },
    };
  }

  const lines = items.map(
    (it, i) => `${i + 1}. ${it.name} × ${it.quantity} = *${it.subtotal} ₽*`
  );
  const total = items.reduce((sum, it) => sum + it.subtotal, 0);
  const text =
    `🛒 *Ваша корзина:*\n\n` +
    `${lines.join('\n')}\n\n` +
    `💰 *Итого:* ${total} ₽`;

  return {
    text,
    extra: { parse_mode: 'Markdown', ...cartKeyboard(items) },
  };
};

// Безопасное редактирование сообщения: Telegram ругается, если новый текст идентичен старому.
// В нашем случае это бывает (например, кликнули dec на товаре с qty=1 второй раз — но он уже удалён).
// Мы просто молча игнорируем эту ошибку, любую другую — пробрасываем.
const safeEditMessageText = async (ctx, text, extra) => {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (!String(err?.description || '').includes('message is not modified')) {
      throw err;
    }
  }
};

// Telegram считает callback_query «протухшим» примерно через 10 секунд:
// после перезапуска бота во время разработки старые клики прилетают и падают
// с ошибкой 400 «query is too old». Эта ошибка безвредна — пользователь просто
// увидит «крутилку», которая сама исчезнет. Поэтому глушим её и в обёртке,
// и в глобальном обработчике bot.catch.
const isStaleCallbackError = (err) => {
  if (!err) return false;
  const code = err.code ?? err.response?.error_code;
  const desc = err.description ?? err.response?.description ?? '';
  return code === 400 && /query is too old/i.test(desc);
};

// Обёртка над ctx.answerCbQuery, проглатывающая ошибки «query is too old».
// Любые другие ошибки пробрасываем — их по-прежнему важно видеть в логах.
const safeAnswerCb = async (ctx, ...args) => {
  try {
    await ctx.answerCbQuery(...args);
  } catch (err) {
    if (!isStaleCallbackError(err)) throw err;
  }
};

// =============================================================================
// Базовые хендлеры (используются и из меню, и при выходе из сцены)
// =============================================================================

const greet = async (ctx) => {
  const name = ctx.from.first_name || 'друг';
  try {
    ensureUser(ctx);
  } catch (err) {
    console.error('❌ Не удалось сохранить пользователя в БД:', err);
  }

  const text =
    `🌸 *Привет, ${name}!*\n\n` +
    `Добро пожаловать в наш цветочный магазин 💐\n` +
    `Здесь вы можете заказать букеты с доставкой в любой уголок города.\n\n` +
    `Воспользуйтесь меню ниже, чтобы начать 👇`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu });
};

const showHelp = async (ctx) => {
  const text =
    `📋 *Доступные команды:*\n\n` +
    `/start — перезапустить бота и показать меню\n` +
    `/help — показать эту справку\n` +
    `/cancel — отменить оформление заказа (если оно идёт)\n\n` +
    `*Кнопки главного меню:*\n` +
    `🌹 Каталог — посмотреть наши букеты\n` +
    `🛒 Корзина — товары перед оформлением\n` +
    `📦 Мои заказы — история и статус заказов\n` +
    `ℹ️ О магазине — контакты и информация`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu });
};

const showCatalog = async (ctx) => {
  let products;
  try {
    products = getAllProducts();
  } catch (err) {
    console.error('❌ Ошибка получения каталога из БД:', err);
    await ctx.reply('⚠️ Произошла ошибка, попробуйте позже.');
    return;
  }

  if (products.length === 0) {
    await ctx.reply('🌱 Каталог пока пуст. Загляните чуть позже!');
    return;
  }

  for (const product of products) {
    const card =
      `🌸 *${product.name}*\n\n` +
      `_${product.description}_\n\n` +
      `💰 *Цена:* ${product.price} ₽`;

    await ctx.reply(card, {
      parse_mode: 'Markdown',
      ...productActions(product.id),
    });
  }
};

const showCart = async (ctx) => {
  let user;
  try {
    user = ensureUser(ctx);
  } catch (err) {
    console.error('❌ Ошибка работы с пользователем:', err);
    await ctx.reply('⚠️ Произошла ошибка, попробуйте позже.');
    return;
  }
  const { text, extra } = renderCart(user.id);
  await ctx.reply(text, extra);
};

const showOrders = async (ctx) => {
  await ctx.reply(
    '📦 *История заказов*\n\nСкоро будет — здесь появится список всех ваших букетов.',
    { parse_mode: 'Markdown' }
  );
};

const showAbout = async (ctx) => {
  await ctx.reply(
    'ℹ️ *О магазине*\n\nСкоро будет — добавим адрес, контакты и часы работы.',
    { parse_mode: 'Markdown' }
  );
};

// =============================================================================
// Сцена оформления заказа (WizardScene)
// =============================================================================
//
// Структура шагов:
//   step 0 (enter)  — приветствие сцены, спросить имя
//   step 1          — получить имя, спросить телефон
//   step 2          — получить телефон (валидация), спросить адрес
//   step 3          — получить адрес, спросить комментарий
//   step 4          — получить комментарий, оформить заказ, выйти
//
// На каждом шаге пользователь может отправить /skip, чтобы использовать ранее
// сохранённое значение из таблицы users (если оно есть).

// Нормализуем телефон: убираем пробелы, дефисы и скобки, приводим к канонике.
const normalizePhone = (text) => text.replace(/[\s\-()]/g, '');

// Валидация телефона: должен начинаться с +, 7 или 8 и содержать минимум 10 цифр.
const isValidPhone = (text) => {
  const norm = normalizePhone(text);
  return /^(\+\d{10,}|[78]\d{9,})$/.test(norm);
};

// ВАЖНО про WizardScene в Telegraf v4: первый шаг НЕ запускается автоматически
// при вызове ctx.scene.enter() — он отработает только на следующий апдейт от
// пользователя. Поэтому первый вопрос ("Введите имя") мы отправляем СНАРУЖИ
// сцены, прямо в bot.action('checkout'), а нужный начальный state передаём
// через второй аргумент scene.enter('checkout', { ... }) — он попадает в
// ctx.wizard.state. Сама сцена начинается сразу с шага «получить имя».

const checkoutScene = new Scenes.WizardScene(
  'checkout',

  // --- Шаг 1/4: получили имя, спрашиваем телефон -----------------------------
  async (ctx) => {
    if (!ctx.message?.text) return;
    const text = ctx.message.text.trim();

    let name;
    if (text === '/skip' && ctx.wizard.state.savedName) {
      name = ctx.wizard.state.savedName;
    } else if (text.length >= 2) {
      name = text;
    } else {
      await ctx.reply('⚠️ Имя слишком короткое. Введите ещё раз:');
      return; // остаёмся на этом шаге
    }
    ctx.wizard.state.name = name;

    const prompt = ctx.wizard.state.savedPhone
      ? `📞 *Шаг 2/4 — Телефон*\n\nВведите телефон или /skip, чтобы использовать сохранённый: *${ctx.wizard.state.savedPhone}*`
      : '📞 *Шаг 2/4 — Телефон*\n\nВведите телефон в формате +71234567890 или 81234567890:';

    await ctx.reply(prompt, { parse_mode: 'Markdown', ...cancelReply });
    return ctx.wizard.next();
  },

  // --- Шаг 2/4: получили телефон, спрашиваем адрес ---------------------------
  async (ctx) => {
    if (!ctx.message?.text) return;
    const text = ctx.message.text.trim();

    let phone;
    if (text === '/skip' && ctx.wizard.state.savedPhone) {
      phone = ctx.wizard.state.savedPhone;
    } else if (isValidPhone(text)) {
      phone = normalizePhone(text);
    } else {
      await ctx.reply(
        '⚠️ Похоже, телефон в неверном формате.\nПример: `+71234567890` или `81234567890`. Попробуйте ещё раз:',
        { parse_mode: 'Markdown' }
      );
      return;
    }
    ctx.wizard.state.phone = phone;

    const prompt = ctx.wizard.state.savedAddress
      ? `🏠 *Шаг 3/4 — Адрес доставки*\n\nВведите адрес или /skip, чтобы использовать сохранённый: *${ctx.wizard.state.savedAddress}*`
      : '🏠 *Шаг 3/4 — Адрес доставки*\n\nВведите адрес доставки (улица, дом, квартира):';

    await ctx.reply(prompt, { parse_mode: 'Markdown', ...cancelReply });
    return ctx.wizard.next();
  },

  // --- Шаг 3/4: получили адрес, спрашиваем комментарий -----------------------
  async (ctx) => {
    if (!ctx.message?.text) return;
    const text = ctx.message.text.trim();

    let address;
    if (text === '/skip' && ctx.wizard.state.savedAddress) {
      address = ctx.wizard.state.savedAddress;
    } else if (text.length >= 5) {
      address = text;
    } else {
      await ctx.reply('⚠️ Адрес слишком короткий. Укажите улицу, дом, квартиру:');
      return;
    }
    ctx.wizard.state.address = address;

    await ctx.reply(
      '💬 *Шаг 4/4 — Комментарий*\n\nКомментарий к заказу или /skip, чтобы пропустить:',
      { parse_mode: 'Markdown', ...cancelReply }
    );
    return ctx.wizard.next();
  },

  // --- Шаг 4/4: получили комментарий, оформляем заказ ------------------------
  async (ctx) => {
    if (!ctx.message?.text) return;
    const text = ctx.message.text.trim();
    const comment = text === '/skip' ? null : text;

    try {
      // Обновляем контакты пользователя, чтобы при следующем заказе предлагать /skip.
      updateUserContact(
        ctx.wizard.state.userId,
        ctx.wizard.state.name,
        ctx.wizard.state.phone,
        ctx.wizard.state.address
      );
      // Создаём заказ из корзины (транзакционно). Если корзина опустела между
      // нажатием кнопки и финалом сцены — будет брошена ошибка.
      const orderId = createOrderFromCart(ctx.wizard.state.userId, comment);

      await ctx.reply(
        `✅ *Заказ #${orderId} принят!*\n\n` +
          `Спасибо! Мы свяжемся с вами по телефону *${ctx.wizard.state.phone}* ` +
          `для подтверждения и согласования времени доставки.`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    } catch (err) {
      console.error('❌ Ошибка оформления заказа:', err);
      await ctx.reply(
        '⚠️ Не удалось оформить заказ. Возможно, корзина пуста или произошла ошибка БД.',
        mainMenu
      );
    }
    return ctx.scene.leave();
  }
);

// Универсальный выход из сцены с сообщением.
const cancelCheckout = async (ctx) => {
  await ctx.reply('❌ Оформление отменено. Корзина сохранена.', mainMenu);
  return ctx.scene.leave();
};

// Хендлеры внутри сцены, перехватывающие команды и кнопки главного меню.
// Без них пользователь, нажавший «🌹 Каталог», будет считаться отвечающим на текущий шаг.
checkoutScene.command('cancel', cancelCheckout);
checkoutScene.hears('❌ Отмена', cancelCheckout);

checkoutScene.command('start', async (ctx) => {
  await ctx.scene.leave();
  return greet(ctx);
});
checkoutScene.command('help', async (ctx) => {
  await ctx.scene.leave();
  return showHelp(ctx);
});

checkoutScene.hears('🌹 Каталог', async (ctx) => {
  await ctx.scene.leave();
  return showCatalog(ctx);
});
checkoutScene.hears('🛒 Корзина', async (ctx) => {
  await ctx.scene.leave();
  return showCart(ctx);
});
checkoutScene.hears('📦 Мои заказы', async (ctx) => {
  await ctx.scene.leave();
  return showOrders(ctx);
});
checkoutScene.hears('ℹ️ О магазине', async (ctx) => {
  await ctx.scene.leave();
  return showAbout(ctx);
});

// Любые inline-кнопки во время сцены (например, добавление в корзину из старого
// сообщения с каталогом) — отвечаем тостом, чтобы у пользователя не висела «крутилка».
checkoutScene.action(/.*/, async (ctx) => {
  await safeAnswerCb(ctx,
    'Сейчас идёт оформление заказа. Завершите его или нажмите «❌ Отмена».'
  );
});

// =============================================================================
// Сборка бота
// =============================================================================

const bot = new Telegraf(process.env.BOT_TOKEN);

// session() необходим для хранения состояния сцены между апдейтами.
// stage.middleware() — роутинг апдейтов в активную сцену пользователя.
const stage = new Scenes.Stage([checkoutScene]);
bot.use(session());
bot.use(stage.middleware());

// --- Команды и кнопки главного меню ---
bot.start(greet);
bot.help(showHelp);

bot.hears('🌹 Каталог', showCatalog);
bot.hears('🛒 Корзина', showCart);
bot.hears('📦 Мои заказы', showOrders);
bot.hears('ℹ️ О магазине', showAbout);

// --- Inline-кнопки под карточкой товара ---
bot.action(/^add_(\d+)$/, async (ctx) => {
  const productId = Number(ctx.match[1]);
  try {
    const user = ensureUser(ctx);
    addToCart(user.id, productId);
    const qty = getCartItemQuantity(user.id, productId);
    await safeAnswerCb(ctx, `✅ Добавлено! В корзине: ${qty} шт.`);
  } catch (err) {
    console.error('❌ Ошибка добавления в корзину:', err);
    await safeAnswerCb(ctx, '⚠️ Не удалось добавить, попробуйте позже.');
  }
});

// --- Inline-кнопки в корзине: ➕ / ➖ ---
// Один общий обработчик для inc и dec — направление берём из match[1].
bot.action(/^(inc|dec)_(\d+)$/, async (ctx) => {
  const direction = ctx.match[1]; // 'inc' | 'dec'
  const productId = Number(ctx.match[2]);

  try {
    const user = ensureUser(ctx);
    const current = getCartItemQuantity(user.id, productId);
    const next = direction === 'inc' ? current + 1 : current - 1;
    updateCartItem(user.id, productId, next);

    await safeAnswerCb(ctx,
      next <= 0 ? '🗑 Удалено из корзины' : `Теперь: ${next} шт.`
    );

    // Перерисовываем сообщение корзины с актуальным состоянием.
    const { text, extra } = renderCart(user.id);
    await safeEditMessageText(ctx, text, extra);
  } catch (err) {
    console.error('❌ Ошибка изменения корзины:', err);
    await safeAnswerCb(ctx, '⚠️ Не удалось обновить корзину.');
  }
});

// --- Очистка корзины с подтверждением ---
bot.action('clear_cart', async (ctx) => {
  await safeAnswerCb(ctx);
  await safeEditMessageText(
    ctx,
    '🗑 *Очистить корзину?*\n\nДействие нельзя отменить.',
    { parse_mode: 'Markdown', ...clearConfirmKeyboard }
  );
});

bot.action('clear_confirm', async (ctx) => {
  try {
    const user = ensureUser(ctx);
    clearCart(user.id);
    await safeAnswerCb(ctx, 'Корзина очищена');
    await safeEditMessageText(ctx, '🗑 Корзина очищена.', { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('❌ Ошибка очистки корзины:', err);
    await safeAnswerCb(ctx, '⚠️ Не удалось очистить.');
  }
});

bot.action('clear_cancel', async (ctx) => {
  try {
    const user = ensureUser(ctx);
    await safeAnswerCb(ctx, 'Отменено');
    const { text, extra } = renderCart(user.id);
    await safeEditMessageText(ctx, text, extra);
  } catch (err) {
    console.error('❌ Ошибка возврата к корзине:', err);
    await safeAnswerCb(ctx, '⚠️ Что-то пошло не так.');
  }
});

// --- Кнопка «Оформить заказ» — вход в сцену ---
// Telegraf v4 WizardScene не выполняет первый шаг автоматически при scene.enter,
// поэтому первый вопрос («Введите имя») отправляем здесь, ДО входа в сцену.
// Контактные данные пользователя кладём в initialState — они доступны внутри
// сцены как ctx.wizard.state.userId / savedName / savedPhone / savedAddress.
bot.action('checkout', async (ctx) => {
  try {
    const user = ensureUser(ctx);
    const total = getCartTotal(user.id);
    if (total === 0) {
      await safeAnswerCb(ctx, 'Корзина пуста — нечего оформлять');
      return;
    }
    await safeAnswerCb(ctx);

    const prompt = user.name
      ? `👤 *Шаг 1/4 — Имя*\n\nВведите ваше имя или /skip, чтобы использовать сохранённое: *${user.name}*`
      : '👤 *Шаг 1/4 — Имя*\n\nВведите ваше имя:';
    await ctx.reply(prompt, { parse_mode: 'Markdown', ...cancelReply });

    await ctx.scene.enter('checkout', {
      userId: user.id,
      savedName: user.name,
      savedPhone: user.phone,
      savedAddress: user.address,
    });
  } catch (err) {
    console.error('❌ Ошибка входа в сцену checkout:', err);
    await safeAnswerCb(ctx, '⚠️ Не удалось начать оформление.');
  }
});

// --- Fallback на произвольный текст вне сцены ---
bot.on(message('text'), async (ctx) => {
  await ctx.reply(
    '🤔 Не понял команду.\n\nВоспользуйтесь меню ниже или отправьте /help для списка команд.',
    mainMenu
  );
});

// Глобальный обработчик ошибок — чтобы бот не падал при неожиданных сбоях.
// Просроченные callback_query (типичны при перезапусках в dev-режиме) не логируем.
bot.catch((err, ctx) => {
  if (isStaleCallbackError(err)) return;
  console.error(`❌ Ошибка при обработке апдейта ${ctx.updateType}:`, err);
});

module.exports = bot;
