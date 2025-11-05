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
import { ensureChatMessageMetadataColumn } from "./db.migrations.js";

// Normaliza URLs (quita slash final)
const normalize = (u) => (u ? u.trim().replace(/\/+$/, "") : u);

// FRONTEND_URL (o NEXT_PUBLIC_FRONTEND_URL) desde .env
const FRONTEND_URL = normalize(
  process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_FRONTEND_URL || null
);

// Orígenes extra por coma
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((o) => normalize(o))
  .filter(Boolean);

// Lista base de orígenes permitidos (incluye Vite por defecto)
const allowedOrigins = new Set(
  [FRONTEND_URL, ...extraOrigins, "http://localhost:5173", "http://127.0.0.1:5173"]
    .filter(Boolean)
    .map((o) => normalize(o))
);

// Helper: detectar orígenes en red local (rango privado)
function isLocalNetworkOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

const app = express();

// --- CORS ---
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin Origin (curl/Postman/server-to-server)
      if (!origin) return callback(null, true);

      const normalized = normalize(origin);

      // Permitidos explícitos
      if (allowedOrigins.size > 0 && allowedOrigins.has(normalized)) {
        return callback(null, true);
      }

      // Permitir IPs de red local (ej: http://192.168.56.1:5173)
      if (isLocalNetworkOrigin(origin)) {
        return callback(null, true);
      }

      // Modo dev abierto si no configuraste nada
      if (allowedOrigins.size === 0 && (process.env.NODE_ENV || "development") === "development") {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// (Opcional) Responder preflights manualmente por si algún proxy los corta
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Middlewares "globales": se ejecutan en cada request
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuramos la sesión del servidor
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-no-uses-esto-en-produccion",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax", // ver nota abajo si usas sesión entre dominios
      secure: false,   // en prod HTTPS ponlo en true
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

app.use("/auth", authRoutes);
app.use(meRoutes);
app.use(accountRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/admin/chat", adminChatRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "API operativa" });
});

app.use((err, _req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({ ok: false, message: "CORS no permitido" });
  }
  return next(err);
});

async function bootstrap() {
  try {
    await ensureChatMessageMetadataColumn();
  } catch (err) {
    console.error("❌ Error al preparar la base de datos:", err);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log("✅ Servidor listo en http://localhost:" + PORT);
    console.log(
      "CORS permitidos:",
      [...allowedOrigins].join(", ") || "(LAN/dev abierto)"
    );
  });
}

bootstrap();