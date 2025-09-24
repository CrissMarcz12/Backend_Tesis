// Passport maneja el "quién eres" en cada request
import passport from "passport";
// Estrategia Local: email + contraseña
import { Strategy as LocalStrategy } from "passport-local";
// Estrategia de Google
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
// Bcrypt para comparar/crear hashes de contraseñas
import bcrypt from "bcrypt";
// Nuestra función query() para hablar con MySQL
import { query } from "../db.js";

// Estrategia local: busca en auth.users
passport.use(
  new LocalStrategy(
    {
      usernameField: "email", // Por defecto "username"; aquí decimos que usamos "email"
      passwordField: "password",
    },
    // Esta función se ejecuta cuando alguien hace POST /login
    // email y password vienen del body del formulario
    async (email, password, done) => {
      try {
        const rows = await query(
          "SELECT id, email, password_hash, display_name, is_active FROM auth.users WHERE email = $1",
          [email]
        );
        const user = rows[0];

        // Si no existe, devolvemos false (login fallido)
        if (!user) return done(null, false, { message: "Usuario no existe" });
        if (!user.is_active)
          return done(null, false, { message: "Usuario inactivo" });
        if (!user.password_hash || user.password_hash === "")
          return done(null, false, {
            message: "No tienes contraseña, usa Google o establece una.",
          });

        // Comparamos la contraseña enviada con el hash guardado en BD
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch)
          return done(null, false, { message: "Contraseña incorrecta" });

        // OK: devolvemos el objeto user (Passport lo pondrá en req.user)
        return done(null, {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Estrategia de Google
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.GOOGLE_REDIRECT_URI ||
        "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 1. Buscar cuenta OAuth
        const oauth = await query(
          "SELECT user_id FROM auth.oauth_accounts WHERE provider = 'google' AND provider_account_id = $1",
          [profile.id]
        );
        let user;
        if (oauth.length) {
          // Ya existe cuenta OAuth
          const rows = await query(
            "SELECT id, email, display_name FROM auth.users WHERE id = $1",
            [oauth[0].user_id]
          );
          user = rows[0];
          return done(null, user);
        } else {
          // Buscar usuario por email
          const email = profile.emails?.[0]?.value;
          if (!email)
            return done(null, false, { message: "Google no devolvió email" });

          let rows = await query(
            "SELECT id, email, display_name FROM auth.users WHERE email = $1",
            [email]
          );
          if (rows.length) {
            user = rows[0];
            // Enlazar cuenta OAuth a usuario existente
            await query(
              `INSERT INTO auth.oauth_accounts (user_id, provider, provider_account_id)
               VALUES ($1, 'google', $2)
               ON CONFLICT DO NOTHING`,
              [user.id, profile.id]
            );
            return done(null, user);
          } else {
            // NO crear usuario aquí, solo guardar email en sesión
            // Passport no permite pasar datos extra, así que lo haremos en el callback de la ruta
            return done(null, false, {
              message: "register_with_google",
              email,
            });
          }
        }
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Cómo guardar al usuario en la sesión: solo guardamos su id
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Cómo recuperar al usuario desde la sesión: buscamos por id en la BD
passport.deserializeUser(async (id, done) => {
  try {
    const rows = await query(
      `SELECT u.id, u.email, u.display_name, u.is_active,
              COALESCE(string_agg(r.name::text, ',') FILTER (WHERE r.name IS NOT NULL), '') AS roles
       FROM auth.users u
       LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
       LEFT JOIN auth.roles r ON r.id = ur.role_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [id]
    );
    const user = rows[0];
    user.roles = user.roles ? user.roles.split(",").filter(Boolean) : [];
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Exportamos passport ya configurado
export default passport;
