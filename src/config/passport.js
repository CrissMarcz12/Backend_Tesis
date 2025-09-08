// Passport maneja el "quién eres" en cada request
import passport from "passport";
// Estrategia Local: email + contraseña
import { Strategy as LocalStrategy } from "passport-local";
// Bcrypt para comparar/crear hashes de contraseñas
import bcrypt from "bcrypt";
// Nuestra función query() para hablar con MySQL
import { query } from "../db.js";

// Definimos cómo autenticar con email + password
passport.use(new LocalStrategy(
  {
    usernameField: "email", // Por defecto "username"; aquí decimos que usamos "email"
    passwordField: "password"
  },
  // Esta función se ejecuta cuando alguien hace POST /login
  // email y password vienen del body del formulario
  async (email, password, done) => {
    try {
      // Buscamos al usuario por email
      const rows = await query("SELECT * FROM users WHERE email = ?", [email]);
      const user = rows[0];

      // Si no existe, devolvemos false (login fallido)
      if (!user) return done(null, false, { message: "Usuario no existe" });

      // Si el usuario no tiene passwordHash (p. ej. vendrá de Google a futuro), no puede loguear por método local
      if (!user.passwordHash) {
        return done(null, false, { message: "Este usuario no tiene contraseña local. Usa Google o crea una." });
      }

      // Comparamos la contraseña enviada con el hash guardado en BD
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) return done(null, false, { message: "Contraseña incorrecta" });

      // OK: devolvemos el objeto user (Passport lo pondrá en req.user)
      return done(null, {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      });
    } catch (err) {
      return done(err);
    }
  }
));

// Cómo guardar al usuario en la sesión: solo guardamos su id
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Cómo recuperar al usuario desde la sesión: buscamos por id en la BD
passport.deserializeUser(async (id, done) => {
  try {
    const rows = await query("SELECT id, email, name, role FROM users WHERE id = ?", [id]);
    const user = rows[0] || null;
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Exportamos passport ya configurado
export default passport;
