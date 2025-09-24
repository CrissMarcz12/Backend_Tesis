import { Router } from "express";
import { ensureAuth, ensureRole } from "../middlewares/auth.js";
import { query } from "../db.js";

const router = Router();

router.use(ensureAuth, ensureRole("admin"));

// Listado de usuarios (con filtros)
router.get("/", async (req, res) => {
  try {
    const { q = "", page = "1", limit = "20", role, status } = req.query;
    const p = Math.max(parseInt(page, 10) || 1, 1);
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (p - 1) * l;

    const where = [];
    const params = [];

    if (q) {
      params.push(`%${q}%`, `%${q}%`);
      where.push(
        `(u.email ILIKE $${params.length - 1} OR u.display_name ILIKE $${
          params.length
        })`
      );
    }

    if (status === "active" || status === "inactive") {
      params.push(status === "active");
      where.push(`u.is_active = $${params.length}`);
    }

    if (role) {
      params.push(role);
      where.push(`EXISTS (
        SELECT 1
        FROM auth.user_roles ur
        JOIN auth.roles r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND r.name = $${params.length}
      )`);
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    params.push(l, offset); // LIMIT / OFFSET

    const sql = `
      WITH base AS (
        SELECT
          u.id, u.email, u.display_name, u.is_active, u.created_at,
          COALESCE(string_agg(DISTINCT r.name::text, ', '), '') AS roles
        FROM auth.users u
        LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
        LEFT JOIN auth.roles r ON r.id = ur.role_id
        ${whereSQL}
        GROUP BY u.id
      ),
      counted AS (
        SELECT *, COUNT(*) OVER()::int AS total FROM base
      )
      SELECT * FROM counted
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;

    const rows = await query(sql, params);
    const total = rows[0]?.total || 0;

    res.json({
      ok: true,
      page: p,
      limit: l,
      total,
      data: rows.map(({ total, ...x }) => x),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Hacer admin
router.post("/:id/grant-admin", async (req, res) => {
  const userId = req.params.id;
  const roleRows = await query(
    "SELECT id FROM auth.roles WHERE name = 'admin'"
  );
  if (!roleRows.length)
    return res.status(500).json({ ok: false, error: "No existe rol admin" });
  const roleId = roleRows[0].id;
  await query(
    "INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, roleId]
  );
  res.json({ ok: true });
});

// Quitar admin y asegurar rol usuario
router.post("/:id/revoke-admin", async (req, res) => {
  const userId = req.params.id;
  const adminRoleRows = await query(
    "SELECT id FROM auth.roles WHERE name = 'admin'"
  );
  if (!adminRoleRows.length)
    return res
      .status(500)
      .json({ ok: false, error: "No existe rol admin" });

  const adminRoleId = adminRoleRows[0].id;

  await query(
    "DELETE FROM auth.user_roles WHERE user_id = $1 AND role_id = $2",
    [userId, adminRoleId]
  );
   const userRoleRows = await query(
    "SELECT id FROM auth.roles WHERE name = 'user'"
  );
  if (!userRoleRows.length)
    return res
      .status(500)
      .json({ ok: false, error: "No existe rol usuario" });

  const userRoleId = userRoleRows[0].id;
  await query(
    "INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [userId, userRoleId]
  );

  res.json({ ok: true });
});

export default router;
