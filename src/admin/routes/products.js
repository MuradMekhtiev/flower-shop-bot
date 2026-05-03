// Товары: список + CRUD + загрузка фото через multer.

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const {
  getAllProductsForAdmin,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../../db');
const { UPLOADS_DIR: UPLOAD_DIR } = require('../paths');

const router = express.Router();

// --- Multer: куда и как сохраняем загруженные фото ---
// UPLOAD_DIR общий для multer (запись) и express.static (отдача) —
// определён в src/admin/paths.js и учитывает UPLOADS_PATH из окружения.

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Уникальное имя: timestamp + случайное число + расширение исходного файла.
    const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext || '.jpg'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 МБ
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Допустимы только изображения JPEG/PNG/WebP/GIF'), ok);
  },
});

// Обёртка над multer.single, превращающая ошибки загрузки в flash + редирект,
// чтобы пользователь не получил голую страницу 500.
const handleUpload = (field) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (err) {
      req.session.flash = { type: 'danger', message: `Ошибка загрузки: ${err.message}` };
      return res.redirect(req.get('Referer') || '/products');
    }
    next();
  });
};

// Безопасное удаление физического файла из public/uploads.
// Если файл не наш или его нет — просто молчим.
const tryRemoveFile = (relPath) => {
  if (!relPath || !relPath.startsWith('/uploads/')) return;
  const filename = path.basename(relPath);
  const fullPath = path.join(UPLOAD_DIR, filename);
  fs.unlink(fullPath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error('Не удалось удалить файл:', fullPath, err);
    }
  });
};

// --- Список товаров ---
router.get('/', (req, res) => {
  const products = getAllProductsForAdmin();
  res.render('products/list', { title: 'Товары', products });
});

// --- Форма создания ---
router.get('/new', (req, res) => {
  res.render('products/form', {
    title: 'Новый товар',
    action: '/products',
    method: 'POST',
    isEdit: false,
    product: { name: '', description: '', price: '', image_path: null, in_stock: 1 },
  });
});

// --- Создание ---
router.post('/', handleUpload('image'), (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  const price = Number(req.body.price);
  const in_stock = req.body.in_stock === '1' ? 1 : 0;
  const image_path = req.file ? `/uploads/${req.file.filename}` : null;

  if (!name || !Number.isFinite(price) || price < 0) {
    if (req.file) tryRemoveFile(`/uploads/${req.file.filename}`);
    req.session.flash = { type: 'danger', message: 'Название и корректная цена обязательны' };
    return res.redirect('/products/new');
  }

  const id = createProduct({ name, description, price, image_path, in_stock });
  req.session.flash = { type: 'success', message: `Товар #${id} создан` };
  res.redirect('/products');
});

// --- Форма редактирования ---
router.get('/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  const product = getProductById(id);
  if (!product) {
    return res.status(404).render('error', {
      title: 'Не найдено',
      code: 404,
      message: `Товар #${id} не найден.`,
    });
  }
  res.render('products/form', {
    title: `Товар #${id}`,
    // method-override: реальный POST превратится в PUT через ?_method=PUT.
    action: `/products/${id}?_method=PUT`,
    method: 'POST',
    isEdit: true,
    product,
  });
});

// --- Обновление ---
router.put('/:id', handleUpload('image'), (req, res) => {
  const id = Number(req.params.id);
  const existing = getProductById(id);
  if (!existing) {
    if (req.file) tryRemoveFile(`/uploads/${req.file.filename}`);
    req.session.flash = { type: 'danger', message: 'Товар не найден' };
    return res.redirect('/products');
  }

  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim();
  const price = Number(req.body.price);
  const in_stock = req.body.in_stock === '1' ? 1 : 0;

  // Если загрузили новое фото — удаляем старое и подставляем свежий путь.
  let image_path = existing.image_path;
  if (req.file) {
    tryRemoveFile(existing.image_path);
    image_path = `/uploads/${req.file.filename}`;
  }

  if (!name || !Number.isFinite(price) || price < 0) {
    req.session.flash = { type: 'danger', message: 'Название и корректная цена обязательны' };
    return res.redirect(`/products/${id}/edit`);
  }

  updateProduct(id, { name, description, price, image_path, in_stock });
  req.session.flash = { type: 'success', message: `Товар #${id} обновлён` };
  res.redirect('/products');
});

// --- Удаление ---
// Если товар уже фигурирует в order_items — FOREIGN KEY запретит удаление.
// В этом случае вежливо подсказываем снять с продажи (in_stock=0) вместо удаления.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = getProductById(id);
  if (!existing) {
    req.session.flash = { type: 'danger', message: 'Товар не найден' };
    return res.redirect('/products');
  }

  try {
    deleteProduct(id);
    tryRemoveFile(existing.image_path);
    req.session.flash = { type: 'success', message: `Товар #${id} удалён` };
  } catch (err) {
    if (String(err.code || '').includes('FOREIGN')) {
      req.session.flash = {
        type: 'warning',
        message: `Товар #${id} нельзя удалить — он есть в заказах. Снимите его с продажи.`,
      };
    } else {
      throw err;
    }
  }
  res.redirect('/products');
});

module.exports = router;
