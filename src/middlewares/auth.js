// Middleware: solo deja pasar si hay sesión (usuario autenticado)
export function ensureAuth(req, res, next) {
  // req.isAuthenticated() lo agrega Passport vía session()
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next(); // Adelante
  }
  // Si no está autenticado, lo mandamos a login
  return res.redirect("/login?error=need_login");
}

// Middleware: requiere un rol específico (ej. "admin")
export function ensureRole(role) {
  // Devolvemos un middleware que verifica el rol
  return function (req, res, next) {
    // Si no hay usuario o el rol no coincide, bloqueamos
    if (!req.user || req.user.role !== role) {
      return res.status(403).send("Prohibido: necesitas rol " + role);
    }
    // Si todo OK, continua
    next();
  };
}
