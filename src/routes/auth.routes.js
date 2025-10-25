import { Router } from "express";
import passport from "../config/passport.js";
import nodemailer from "nodemailer";

import bcrypt from "bcrypt";
import { ensureAuth } from "../middlewares/auth.js";
import { query } from "../db.js";

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.replace(/\/+$/, "")
  : null;
const FRONTEND_CALLBACK_URL = FRONTEND_URL
  ? `${FRONTEND_URL}/auth/callback`
  : null;
function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name || "",
  };
}

function handleFrontRedirect(res, path, fallbackPayload) {
  if (FRONTEND_CALLBACK_URL) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        const targetUrl = new URL(normalizedPath, `${FRONTEND_URL}/`);
    const callbackUrl = new URL(FRONTEND_CALLBACK_URL);

    callbackUrl.searchParams.set("redirect", targetUrl.pathname);
    targetUrl.searchParams.forEach((value, key) => {
      callbackUrl.searchParams.append(key, value);
    });

    return res.redirect(callbackUrl.toString());
  }
  return res.json(fallbackPayload);
}

// Iniciar login con Google
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Callback de Google
router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", async (err, user, info) => {
    if (err) return next(err);
    if (!user && info?.message === "register_with_google") {
      req.session.googleEmail = info.email;
      return handleFrontRedirect(res, "/register?google=1", {
        ok: false,
        requiresRegistration: true,
        email: info.email,
      });
    }
    if (!user) {
      return handleFrontRedirect(res, "/login?error=google", {
        ok: false,
        message: "No se pudo autenticar con Google",
      });
    }
    // Consulta roles del usuario
    const rolesRows = await query(
      `SELECT r.name FROM auth.user_roles ur
       JOIN auth.roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [user.id]
    );
    const roles = rolesRows.map((r) => r.name);

    if (roles.includes("admin")) {
      // Si es admin, inicia sesión directo
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return handleFrontRedirect(res, "/profile", {
          ok: true,
          requiresVerification: false,
          user: sanitizeUser(user),
          roles,
        });
      });
    } else {
      // Si es usuario normal, pide verificación de 2 pasos
      await sendVerificationCode(user);
      req.session.pendingUserId = user.id;
      return handleFrontRedirect(
        res,
        `/verify?email=${encodeURIComponent(user.email)}`,
        {
          ok: true,
          requiresVerification: true,
          email: user.email,
        }
      );
    }
  })(req, res, next);
});

// LOGOUT: cierra sesión
router.post("/logout", (req, res, next) => {

  req.logout((err) => {
    if (err) return next(err);

    res.json({ ok: true, message: "Sesión finalizada" });
  });
});
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res
      .status(400)
      .json({ ok: false, message: "Email y contraseña son obligatorios" });
  }


    const rows = await query("SELECT * FROM auth.users WHERE email = $1", [email]);

  const user = rows[0];
  if (!user)
    return res.status(401).json({ ok: false, message: "Usuario no existe" });
  if (!user.is_active)
    return res.status(403).json({ ok: false, message: "Usuario inactivo" });
  if (!user.password_hash)
    return res
      .status(401)
      .json({
        ok: false,
        message: "No tienes contraseña configurada, inicia con Google",
      });


  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch)
    return res
      .status(401)
      .json({ ok: false, message: "Contraseña incorrecta" });


  const rolesRows = await query(
    `SELECT r.name FROM auth.user_roles ur
     JOIN auth.roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [user.id]
  );
  const roles = rolesRows.map((r) => r.name);

  if (roles.includes("admin")) {

    req.login(user, (err) => {
      if (err)
        return res
          .status(500)
          .json({ ok: false, message: "No se pudo iniciar la sesión" });
      return res.json({
        ok: true,
        requiresVerification: false,
        user: sanitizeUser(user),
        roles,
      });
    });
  } else {

    await sendVerificationCode(user);
    req.session.pendingUserId = user.id;
    res.json({
      ok: true,
      requiresVerification: true,
      email: user.email,
    });
  }
});

router.post("/verify", async (req, res) => {
  const { email, code } = req.body || {};
  let user;

  if (req.session.pendingUserId) {
    // Verificación tras Google
    const rows = await query("SELECT * FROM auth.users WHERE id = $1", [
      req.session.pendingUserId,
    ]);
    user = rows[0];
  } else if (email) {
    // Verificación tras login manual
    const rows = await query("SELECT * FROM auth.users WHERE email = $1", [
      email,
    ]);
    user = rows[0];
  }
  if (
    !user ||
    !user.verification_code ||
    user.verification_code !== code ||
    !user.verification_expires ||
    new Date() > user.verification_expires
  ) {
    return res
      .status(401)
      .json({ ok: false, message: "Código inválido o expirado" });
  }

  // Limpia el código y completa el login
  await query(
    "UPDATE auth.users SET verification_code = NULL, verification_expires = NULL WHERE id = $1",
    [user.id]
  );
  req.login(user, (err) => {
    if (err)
      return res
        .status(500)
        .json({ ok: false, message: "No se pudo iniciar la sesión" });
    delete req.session.pendingUserId;
    res.json({ ok: true, requiresVerification: false, user: sanitizeUser(user) });
  });
});

// Mostrar formulario para establecer contraseña
router.get("/set-password", ensureAuth, (req, res) => {
  res.json({ ok: true, message: "Puedes establecer tu contraseña vía POST" });
});

// Guardar la nueva contraseña
router.post("/set-password", ensureAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) {
    return res
      .status(400)
      .json({ ok: false, message: "La contraseña debe tener 8 caracteres" });
  }
  const hash = await bcrypt.hash(password, 10);
  await query("UPDATE auth.users SET password_hash = $1 WHERE id = $2", [
    hash,
    req.user.id,
  ]);
  res.json({ ok: true, message: "Contraseña actualizada" });
});

router.post("/register", async (req, res) => {
  try {
    const { email, display_name, password } = req.body || {};

    // Validaciones básicas
    if (!email || !display_name || !password)
      return res
        .status(400)
        .json({ ok: false, message: "Faltan campos obligatorios" });
    if (password.length < 8)
      return res
        .status(400)
        .json({ ok: false, message: "Contraseña muy corta" });

    // ¿Ya existe el usuario?
    const exists = await query("SELECT 1 FROM auth.users WHERE email = $1", [
      email,
    ]);
    if (exists.length)
      return res
        .status(409)
        .json({ ok: false, message: "El email ya está registrado" });

    // Hash de la contraseña
    const hash = await bcrypt.hash(password, 10);

    // Crear usuario
    const userRows = await query(
      `INSERT INTO auth.users (email, password_hash, display_name, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, email, display_name`,
      [email, hash, display_name]
    );
    const user = userRows[0];

    // Asignar rol 'user'
    const roleRows = await query(
      "SELECT id FROM auth.roles WHERE name = 'user'"
    );
    if (roleRows.length) {
      await query(
        "INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [user.id, roleRows[0].id]
      );
    }


    if (req.session.googleEmail) {

      delete req.session.googleEmail;
      return res.json({
        ok: true,
        requiresGoogleLink: true,
        message: "Ahora inicia sesión con Google para enlazar tu cuenta",
      });
    }

    // Login automático tras registro
    req.login(user, (err) => {
      if (err)
        return res
          .status(500)
          .json({ ok: false, message: "No se pudo iniciar la sesión" });
      res.json({ ok: true, user: sanitizeUser(user) });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: "Error al registrar usuario" });
  }
});

async function sendVerificationCode(user) {
  // Genera código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  await query(
    "UPDATE auth.users SET verification_code = $1, verification_expires = $2 WHERE id = $3",
    [code, expires, user.id]
  );

  // Envía el código por email
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: user.email,
    subject: "Tu código de verificación",
    text: `Tu código de verificación es: ${code}`,
  });
}

export default router;
