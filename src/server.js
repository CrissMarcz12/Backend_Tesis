// Cargar .env
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import morgan from "morgan";
import session from "express-session";
import passport from "./config/passport.js";

// Rutas
import accountRoutes from "./routes/account.routes.js";
import authRoutes from "./routes/auth.routes.js";
import meRoutes from "./routes/me.routes.js";
import adminUsersRoutes from "./routes/admin.users.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import adminChatRoutes from "./routes/admin.chat.routes.js";
import {
  ensureChatMessageMetadataColumn,
  ensureDatabaseSchema,
} from "./db.migrations.js";
// Utils
const normalize = (u) => (u ? u.trim().replace(/\/+$/, "") : u);

// FRONTEND_URL opcional (no es necesario si CORS_ALLOW_ALL=true)
const FRONTEND_URL = normalize(
  process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_FRONTEND_URL || null
);

// Orígenes extra por coma
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((o) => normalize(o))
  .filter(Boolean);

// Abrir/limitar CORS por env (en EB pon CORS_ALLOW_ALL=true)
const allowAllOrigins =
  (process.env.CORS_ALLOW_ALL ?? "true").toLowerCase() === "true";

const allowedOrigins = allowAllOrigins
  ? null
  : new Set(
      [
        FRONTEND_URL,
        ...extraOrigins,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]
        .filter(Boolean)
        .map((o) => normalize(o))
    );

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

// *** IMPORTANTE detrás de ALB/ELB para cookies Secure ***
app.set("trust proxy", 1);

// --- CORS ---
app.use(
  cors({
    origin: (origin, callback) => {
      if (allowAllOrigins) return callback(null, true);
      if (!origin) return callback(null, true); // curl/Postman
      const normalized = normalize(origin);
      if (allowedOrigins && allowedOrigins.has(normalized)) {
        return callback(null, true);
      }
      if (isLocalNetworkOrigin(origin)) return callback(null, true);
      if (
        allowedOrigins &&
        allowedOrigins.size === 0 &&
        (process.env.NODE_ENV || "development") === "development"
      ) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Preflight rápido
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Middlewares base
app.use(morgan("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Sesión (cross-site) ---
app.use(
  session({
    secret: process.env.SESSION_SECRET || "cambia-esto-en-render",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "none",
      secure: process.env.NODE_ENV === "production",  // SOLO en producción
    },
  })
);


// Passport
app.use(passport.initialize());
app.use(passport.session());

// Rutas
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

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "API operativa" });
});

// Manejo CORS denegado
app.use((err, _req, res, next) => {
  if (err?.message === "Origin not allowed by CORS") {
    return res.status(403).json({ ok: false, message: "CORS no permitido" });
  }
  return next(err);
});

async function bootstrap() {
  try {
    await ensureDatabaseSchema();               // <---- ESTA CREA auth, chat, admin, TABLAS Y VISTAS
    await ensureChatMessageMetadataColumn();    // opcional
  } catch (err) {
    console.error("❌ Error al preparar la base de datos:", err);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Backend en Render corriendo en puerto ${PORT}`);
    console.log("🔵 CORS permitidos:", allowAllOrigins ? "(todos los orígenes)" : [...(allowedOrigins ?? [])].join(", "));
  });
}

bootstrap();
