import { Router } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { ensureAuth, ensureRole } from "../middlewares/auth.js";

// Necesitamos __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Página: Login (formulario)
router.get("/login", (req, res) => {
  // Servimos el archivo login.html
  res.sendFile(path.join(__dirname, "..", "views", "login.html"));
});

// Página: Registro (formulario)
router.get("/register", (req, res) => {
  const email = req.session.googleEmail || "";
  res.sendFile(path.join(__dirname, "..", "views", "register.html"));
  // Si usas un motor de plantillas, puedes pasar el email para prellenar el campo
});

// Página: Perfil (ruta protegida)
router.get("/profile", ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "profile.html"));
});

// Página: Admin (ruta protegida + requiere rol)
router.get("/admin", ensureAuth, ensureRole("admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "..", "views", "admin.html"));
});

// Home simple que redirige a /profile si ya estás logueado
router.get("/", (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated())
    return res.redirect("/profile");
  res.redirect("/login");
});

export default router;
