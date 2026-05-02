// Скрипт начального наполнения БД тестовыми букетами.
// Запуск: node src/db/seed.js (или npm run seed).
// Идемпотентный: если в таблице products уже есть записи — выходит без вставки.

const { db } = require('./index');

// Тестовые букеты. Цены в рублях (INTEGER), как и в схеме БД.
// image_path пока null — фотографии добавим позже.
const SEED_PRODUCTS = [
  {
    name: 'Букет «Нежность»',
    description: '25 розовых пионов в стильной упаковке. Идеален для романтического подарка.',
    price: 4500,
  },
  {
    name: 'Букет «Весеннее настроение»',
    description: 'Микс из 21 разноцветного тюльпана — солнечный привет даже в пасмурный день.',
    price: 2200,
  },
  {
    name: 'Букет «Классика»',
    description: '15 красных роз сорта Ред Наоми, длина стебля 60 см. Беспроигрышный выбор.',
    price: 3500,
  },
  {
    name: 'Букет «Полевые цветы»',
    description: 'Ромашки, васильки и колоски пшеницы — лёгкое летнее настроение в подарок.',
    price: 1500,
  },
  {
    name: 'Букет «Премиум»',
    description: 'Эксклюзивная композиция из орхидей, гортензий и эвкалипта в авторской упаковке.',
    price: 5000,
  },
];

const main = () => {
  // Считаем существующие товары — если уже что-то есть, выходим без изменений.
  const existing = db.prepare('SELECT COUNT(*) AS cnt FROM products').get();
  if (existing.cnt > 0) {
    console.log(`ℹ️  В БД уже ${existing.cnt} товаров — пропускаем seed.`);
    return;
  }

  const insertStmt = db.prepare(
    'INSERT INTO products (name, description, price, image_path) VALUES (?, ?, ?, ?)'
  );

  // Транзакция — либо все товары вставлены, либо ни одного.
  // На случай если БД заблокируется или упадёт посреди вставки.
  const insertMany = db.transaction((products) => {
    for (const p of products) {
      insertStmt.run(p.name, p.description, p.price, null);
    }
  });

  insertMany(SEED_PRODUCTS);

  console.log(`✅ Добавлено товаров: ${SEED_PRODUCTS.length}`);
  console.log('🌸 Каталог готов к показу в боте!');
};

try {
  main();
} catch (err) {
  console.error('❌ Ошибка при наполнении БД:', err);
  process.exit(1);
}
