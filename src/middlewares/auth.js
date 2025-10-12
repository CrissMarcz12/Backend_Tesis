import { query } from "../db.js";

// Middleware: solo deja pasar si hay sesión (usuario autenticado)
export function ensureAuth(req, res, next) {
  // req.isAuthenticated() lo agrega Passport vía session()
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  // Si no está autenticado, respondemos con 401
  return res.status(401).json({ ok: false, message: "Autenticación requerida" });
}

// Middleware: requiere un rol específico (ej. "admin")
export function ensureRole(roleName) {
  // Devolvemos un middleware que verifica el rol
  return async function (req, res, next) {
    // Si no hay usuario, respondemos con 401 (No autenticado)
    if (!req.user)
      return res
        .status(401)
        .json({ ok: false, message: "Autenticación requerida" });

    // Usa los roles del usuario si ya están cargados
    if (Array.isArray(req.user.roles) && req.user.roles.includes(roleName)) {
      return next();
    }

    // Si no, consulta a la BD
    const rows = await query(
      `SELECT 1
       FROM auth.user_roles ur
       JOIN auth.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name = $2
       LIMIT 1`,
      [req.user.id, roleName]
    );

    if (rows.length) return next();
    return res
      .status(403)
      .json({ ok: false, message: `Prohibido: necesitas rol ${roleName}` });
  };
}
