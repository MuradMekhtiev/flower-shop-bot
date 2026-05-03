// Точка входа: загружает окружение, проверяет переменные,
// запускает Telegram-бота и веб-админку в одном Node-процессе.

require('dotenv').config();

const bot = require('./src/bot');
const adminApp = require('./src/admin/server');

// Проверка обязательных переменных окружения.
const required = ['BOT_TOKEN', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`❌ Не заданы переменные .env: ${missing.join(', ')}`);
  console.error('   Проверьте файл .env и перезапустите.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;

// Сначала поднимаем веб-сервер админки (синхронный listen).
// На Railway внешний URL формируется автоматически (Settings → Networking),
// поэтому в логе печатаем нейтральное «слушает порт N» без хардкода localhost.
const adminServer = adminApp.listen(PORT, () => {
  console.log(`✅ Админка слушает порт ${PORT}`);
  console.log('   Логин/пароль из переменных окружения ADMIN_USERNAME / ADMIN_PASSWORD');
});

// Параллельно стартуем Telegram-бота (long polling).
bot
  .launch()
  .then(() => {
    console.log('✅ Telegram-бот запущен (long polling)');
    console.log('🛑 Для остановки используйте Ctrl+C');
  })
  .catch((err) => {
    console.error('❌ Не удалось запустить бота:', err);
    adminServer.close();
    process.exit(1);
  });

// Корректное завершение по системным сигналам — останавливаем оба компонента.
const shutdown = (signal) => {
  console.log(`\n🛑 Получен сигнал ${signal}, останавливаем...`);
  bot.stop(signal);
  adminServer.close((err) => {
    if (err) console.error('Ошибка остановки веб-сервера:', err);
  });
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
