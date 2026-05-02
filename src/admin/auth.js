// Middleware проверки авторизации админки.
// Если пользователь не вошёл — редирект на /login. Запрошенный URL
// сохраняем в session.returnTo, чтобы вернуть туда после успешного входа.

module.exports = (req, res, next) => {
  if (req.session?.isAdmin) return next();
  if (req.method === 'GET') {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/login');
};
