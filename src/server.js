// Cargamos variables de entorno al inicio
import dotenv from "dotenv";
dotenv.config();

// Express es nuestro servidor HTTP
import express from "express";
import cors from "cors";
// Morgan muestra logs de cada request (útil para aprender)
import morgan from "morgan";
// Sesiones en servidor (stateful); guardan un id de sesión en cookie
import session from "express-session";
// Nuestro passport ya configurado con LocalStrategy
import passport from "./config/passport.js";

// Rutas
import accountRoutes from "./routes/account.routes.js";

import authRoutes from "./routes/auth.routes.js";
import meRoutes from "./routes/me.routes.js";
import adminUsersRoutes from "./routes/admin.users.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import adminChatRoutes from "./routes/admin.chat.routes.js";
const FRONTEND_URL = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.replace(/\/+$/, "")
  : null;

const extraOrigins = process.env.CORS_EXTRA_ORIGINS
  ? process.env.CORS_EXTRA_ORIGINS.split(",").map((origin) =>
      origin.trim().replace(/\/+$/, "")
    )
  : [];

const allowedOrigins = new Set(
  [FRONTEND_URL, ...extraOrigins, "http://localhost:5173", "http://127.0.0.1:5173"]
    .filter(Boolean)
    .map((origin) => origin.replace(/\/+$/, ""))
);


const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/+$/, "");
      if (!allowedOrigins.size || allowedOrigins.has(normalized)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);
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


app.use("/auth", authRoutes); // Acciones de auth (POST register/login/logout)
app.use(meRoutes);
app.use(accountRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin/chat", adminChatRoutes);

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "API operativa",
  });
});

app.use((err, _req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({ ok: false, message: "CORS no permitido" });
  }
  return next(err);
});

// Arrancamos el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Servidor listo en http://localhost:" + PORT);
});
