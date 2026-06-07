// middleware/auth.js

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2>Access Denied</h2>
          <p>Your role (${req.session.user.role}) cannot access this page.</p>
          <a href="/dashboard">Go to your dashboard</a>
        </body></html>
      `);
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
