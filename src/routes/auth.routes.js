import { Router } from "express";
import passport from "../config/passport.js";
import nodemailer from "nodemailer";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { ensureAuth } from "../middlewares/auth.js";
import { query } from "../db.js";
import path from "path";

const router = Router();

// Iniciar login con Google
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Callback de Google
router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", async (err, user, info) => {
    if (err) return next(err);
    if (!user && info && info.message === "register_with_google") {
      req.session.googleEmail = info.email;
      return res.redirect("/register?google=1");
    }
    if (!user) {
      return res.redirect("/login?error=google");
    }
    // Enviar código de verificación antes de loguear
    await sendVerificationCode(user);
    // Guarda temporalmente el id del usuario para la verificación
    req.session.pendingUserId = user.id;
    res.sendFile(path.join(process.cwd(), "src/views/verify.html"));
  })(req, res, next);
});

// LOGOUT: cierra sesión
router.post("/logout", (req, res, next) => {
  // req.logout borra la sesión del usuario
  req.logout((err) => {
    if (err) return next(err);
    // Redirige al login
    res.redirect("/login?msg=bye");
  });
});

// Elimina o comenta ESTA ruta:
/*
router.post(
  "/login",
  // passport.authenticate hace la verificación de email/password
  passport.authenticate("local", {
    failureRedirect: "/login?error=invalid", // Si falla, vuelve al login
  }),
  // Si pasa, ya tienes req.user. Redirigimos al perfil
  (req, res) => {
    res.redirect("/profile");
  }
);
*/

// Deja solo la versión con verificación por código:
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const rows = await query("SELECT * FROM auth.users WHERE email = $1", [
    email,
  ]);
  const user = rows[0];
  if (!user) return res.status(401).send("Usuario no existe");
  if (!user.is_active) return res.status(403).send("Usuario inactivo");
  if (!user.password_hash)
    return res.status(401).send("No tienes contraseña, usa Google.");

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) return res.status(401).send("Contraseña incorrecta");

  // Enviar código de verificación
  await sendVerificationCode(user);

  // Muestra formulario para ingresar código
  res.sendFile(path.join(process.cwd(), "src/views/verify.html"));
});

router.post("/verify", async (req, res) => {
  const { email, code } = req.body;
  let user;
  if (req.session.pendingUserId) {
    // Verificación tras Google
    const rows = await query("SELECT * FROM auth.users WHERE id = $1", [
      req.session.pendingUserId,
    ]);
    user = rows[0];
  } else {
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
    return res.status(401).send("Código inválido o expirado");
  }

  // Limpia el código y completa el login
  await query(
    "UPDATE auth.users SET verification_code = NULL, verification_expires = NULL WHERE id = $1",
    [user.id]
  );
  req.login(user, (err) => {
    if (err) return res.status(500).send("Error de sesión");
    // Limpia la sesión temporal
    delete req.session.pendingUserId;
    res.redirect("/profile");
  });
});

// Mostrar formulario para establecer contraseña
router.get("/set-password", ensureAuth, (req, res) => {
  res.sendFile(path.join(process.cwd(), "src/views/set_password.html"));
});

// Guardar la nueva contraseña
router.post("/set-password", ensureAuth, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).send("Contraseña muy corta");
  }
  const hash = await bcrypt.hash(password, 10);
  await query("UPDATE auth.users SET password_hash = $1 WHERE id = $2", [
    hash,
    req.user.id,
  ]);
  res.redirect("/profile");
});

router.post("/register", async (req, res) => {
  try {
    const { email, display_name, password } = req.body;

    // Validaciones básicas
    if (!email || !display_name || !password)
      return res.status(400).send("Faltan campos");
    if (password.length < 8)
      return res.status(400).send("Contraseña muy corta");

    // ¿Ya existe el usuario?
    const exists = await query("SELECT 1 FROM auth.users WHERE email = $1", [
      email,
    ]);
    if (exists.length)
      return res.status(409).send("El email ya está registrado");

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

    // Si viene de Google, enlaza la cuenta OAuth
    if (req.session.googleEmail) {
      // Busca el último provider_account_id de Google (no lo tienes, así que pide al usuario iniciar sesión con Google de nuevo)
      // Limpia la sesión
      delete req.session.googleEmail;
      // Puedes mostrar un mensaje: "Ahora inicia sesión con Google para enlazar tu cuenta"
      return res.redirect("/login?msg=now_google");
    }

    // Login automático tras registro
    req.login(user, (err) => {
      if (err) return res.status(500).send("Error de sesión");
      res.redirect("/profile");
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error al registrar usuario");
  }
});

async function sendVerificationCode(user) {
  // Genera código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

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
