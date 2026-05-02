// Маршруты входа и выхода. Не защищены auth middleware (это бы создало петлю).

const express = require('express');
const router = express.Router();

// Форма входа. Если уже залогинен — сразу на главную.
router.get('/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/');
  res.render('login', { title: 'Вход', layout: false, error: null });
});

// Проверка логина/пароля. Простое сравнение plain-text.
// TODO: В проде хранить хеш пароля (bcrypt.hash + bcrypt.compare) в БД,
//       а не в .env. Для пет-проекта/портфолио хватает текущей схемы.
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const okUser = username === process.env.ADMIN_USERNAME;
  const okPass = password === process.env.ADMIN_PASSWORD;

  if (!okUser || !okPass) {
    return res.status(401).render('login', {
      title: 'Вход',
      layout: false,
      error: 'Неверный логин или пароль',
    });
  }

  req.session.isAdmin = true;
  req.session.flash = { type: 'success', message: 'Добро пожаловать!' };

  // Редиректим на тот URL, который пытались открыть до /login (если был).
  const dest = req.session.returnTo || '/';
  delete req.session.returnTo;
  res.redirect(dest);
});

// Выход — уничтожаем сессию полностью.
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
