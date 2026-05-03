// Общие пути для админки. На Railway/проде задаются через переменные окружения,
// чтобы директории лежали на persistent volume и не пересоздавались при каждом
// деплое. В разработке fallback — public/uploads в корне проекта.

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

const UPLOADS_DIR = process.env.UPLOADS_PATH
  ? path.resolve(process.env.UPLOADS_PATH)
  : path.join(PROJECT_ROOT, 'public', 'uploads');

// Создаём папку при загрузке модуля, чтобы первая загрузка фото не упала.
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = { PROJECT_ROOT, UPLOADS_DIR };
