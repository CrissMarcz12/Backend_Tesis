// Cargamos variables de entorno al inicio
import dotenv from "dotenv";
dotenv.config();

// Express es nuestro servidor HTTP
import express from "express";
// Morgan muestra logs de cada request (útil para aprender)
import morgan from "morgan";
// Sesiones en servidor (stateful); guardan un id de sesión en cookie
import session from "express-session";
// Nuestro passport ya configurado con LocalStrategy
import passport from "./config/passport.js";

// Rutas
import pageRoutes from "./routes/pages.routes.js";
import authRoutes from "./routes/auth.routes.js";
import meRoutes from "./routes/me.routes.js";

const app = express();

// Middlewares "globales": se ejecutan en cada request
app.use(morgan("dev")); // Logs de las peticiones
app.use(express.urlencoded({ extended: true })); // Parsear <form> (x-www-form-urlencoded)
app.use(express.json()); // Parsear JSON (por si posteamos JSON)

// Configuramos la sesión del servidor
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Clave para firmar la cookie de sesión
    resave: false, // No volver a guardar si no hay cambios
    saveUninitialized: false, // No crear sesiones vacías
    cookie: {
      httpOnly: true, // JS del navegador no puede leer la cookie (más seguro)
      sameSite: "lax", // Previene CSRF básico en navegación normal
      secure: false, // En producción con HTTPS ponlo en true
    },
  })
);

// Inicializamos Passport y lo conectamos a la sesión
app.use(passport.initialize());
app.use(passport.session());

// Endpoint útil para el front: saber si estás logueado y quién eres
app.get("/me", (req, res) => {
  res.json({
    isAuthenticated: !!(req.isAuthenticated && req.isAuthenticated()),
    user: req.user || null,
  });
});

// Usamos nuestras rutas
app.use("/", pageRoutes); // Páginas (login, register, profile, admin)
app.use("/auth", authRoutes); // Acciones de auth (POST register/login/logout)
app.use(meRoutes);

// Arrancamos el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Servidor listo en http://localhost:" + PORT);
});
