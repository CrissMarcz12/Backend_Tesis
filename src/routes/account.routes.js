import { Router } from "express";
import bcrypt from "bcrypt";
import { ensureAuth } from "../middlewares/auth.js";
import { query } from "../db.js";

const router = Router();

// Todas las rutas requieren usuario autenticado
router.use(ensureAuth);

// Obtiene la información básica de la cuenta del usuario logueado
router.get("/api/account", async (req, res) => {
  const rows = await query(
    `SELECT id, display_name, email, password_hash
     FROM auth.users
     WHERE id = $1`,
    [req.user.id]
  );

  if (!rows.length)
    return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  const user = rows[0];
  res.json({
    ok: true,
    data: {
      id: user.id,
      display_name: user.display_name || "",
      email: user.email,
      hasPassword: !!user.password_hash,
    },
  });
});

// Actualiza el nombre y/o la contraseña del usuario actual
router.put("/api/account", async (req, res) => {
  const {
    display_name: displayName,
    current_password: currentPassword,
    new_password: newPassword,
    confirm_password: confirmPassword,
  } = req.body || {};

  const trimmedName = typeof displayName === "string" ? displayName.trim() : undefined;

  if (trimmedName !== undefined && !trimmedName)
    return res
      .status(400)
      .json({ ok: false, message: "El nombre no puede estar vacío" });

  const rows = await query(
    `SELECT id, display_name, password_hash
     FROM auth.users
     WHERE id = $1`,
    [req.user.id]
  );

  if (!rows.length)
    return res.status(404).json({ ok: false, message: "Usuario no encontrado" });

  const user = rows[0];
  const updates = [];
  const params = [];

  if (trimmedName !== undefined && trimmedName !== user.display_name) {
    updates.push(`display_name = $${updates.length + 1}`);
    params.push(trimmedName);
  }

  const wantsPasswordChange =
    currentPassword || newPassword || confirmPassword;

  if (wantsPasswordChange) {
    if (!newPassword || !confirmPassword)
      return res
        .status(400)
        .json({ ok: false, message: "Completa la nueva contraseña" });

    if (newPassword !== confirmPassword)
      return res
        .status(400)
        .json({ ok: false, message: "Las contraseñas no coinciden" });

    if (newPassword.length < 8)
      return res
        .status(400)
        .json({ ok: false, message: "La nueva contraseña debe tener al menos 8 caracteres" });

    if (user.password_hash) {
      if (!currentPassword)
        return res
          .status(400)
          .json({ ok: false, message: "Debes ingresar tu contraseña actual" });

      const validCurrent = await bcrypt.compare(currentPassword, user.password_hash);
      if (!validCurrent)
        return res
          .status(400)
          .json({ ok: false, message: "La contraseña actual es incorrecta" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    updates.push(`password_hash = $${updates.length + 1}`);
    params.push(newHash);
  }

  if (!updates.length)
    return res.json({ ok: true, message: "No hay cambios para guardar" });

  params.push(req.user.id);

  await query(
    `UPDATE auth.users
     SET ${updates.join(", ")}
     WHERE id = $${params.length}`,
    params
  );

  res.json({ ok: true, message: "Cambios guardados correctamente" });
});

export default router;