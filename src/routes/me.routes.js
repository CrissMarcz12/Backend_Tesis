import { Router } from "express";
import { query } from "../db.js";

const router = Router();

router.get("/me", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ isAuthenticated: false });
  }
  const userId = req.user.id;
  const rows = await query(
    `SELECT u.display_name, u.email, u.password_hash,
            COALESCE(string_agg(r.name, ', '), '') AS roles
     FROM auth.users u
     LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
     LEFT JOIN auth.roles r ON r.id = ur.role_id
     WHERE u.id = $1
     GROUP BY u.id, u.display_name, u.email, u.password_hash`,
    [userId]
  );
  if (!rows.length) return res.json({ isAuthenticated: false });

  const user = rows[0];
  res.json({
    isAuthenticated: true,
    user: {
      display_name: user.display_name,
      email: user.email,
      roles: user.roles,
      has_password: !!user.password_hash, // true si tiene contraseña
    },
  });
});

export default router;
