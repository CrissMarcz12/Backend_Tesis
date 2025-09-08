import { Router } from "express";
import bcrypt from "bcrypt";
import passport from "../config/passport.js";
import { query } from "../db.js";

const router = Router();

// REGISTRO: crea un usuario con hash de contraseña y rol 'user'
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password } = req.body; // Leemos datos del formulario

    // Validación mínima
    if (!name || !email || !password) {
      return res.status(400).send("Faltan campos");
    }

    // ¿Ya existe ese email?
    const exists = await query("SELECT id FROM users WHERE email = ?", [email]);
    if (exists.length > 0) {
      return res.status(409).send("Ese email ya está registrado");
    }

    // Creamos el hash de la contraseña (12 rondas = seguro y razonable)
    const passwordHash = await bcrypt.hash(password, 12);

    // Insertamos el usuario
    await query(
      "INSERT INTO users (name, email, passwordHash, role) VALUES (?,?,?, 'user')",
      [name, email, passwordHash]
    );

    // Opcional: loguear automáticamente después de registrar
    const rows = await query("SELECT id, email, name, role FROM users WHERE email = ?", [email]);
    const user = rows[0];

    // req.login guarda al user en la sesión
    req.login(user, err => {
      if (err) return next(err);
      return res.redirect("/profile");
    });
  } catch (err) {
    next(err);
  }
});

// LOGIN: usa Passport LocalStrategy
router.post("/login",
  // passport.authenticate hace la verificación de email/password
  passport.authenticate("local", {
    failureRedirect: "/login?error=invalid" // Si falla, vuelve al login
  }),
  // Si pasa, ya tienes req.user. Redirigimos al perfil
  (req, res) => {
    res.redirect("/profile");
  }
);

// LOGOUT: cierra sesión
router.post("/logout", (req, res, next) => {
  // req.logout borra la sesión del usuario
  req.logout(err => {
    if (err) return next(err);
    // Redirige al login
    res.redirect("/login?msg=bye");
  });
});

export default router;
