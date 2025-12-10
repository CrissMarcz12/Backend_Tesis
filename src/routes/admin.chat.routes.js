import { Router } from 'express'
import { query } from '../db.js'
import { ensureAuth, ensureRole } from '../middlewares/auth.js'

const router = Router()

router.use(ensureAuth, ensureRole('admin'))

// Estadísticas generales del dashboard
router.get('/stats', async (req, res) => {
  try {
    // Total de usuarios
    const usersResult = await query(`
      SELECT COUNT(*) as total
      FROM auth.users
    `)

    // Usuarios activos (que tienen al menos una conversación)
    const activeUsersResult = await query(`
      SELECT COUNT(DISTINCT owner_user_id) as total
      FROM chat.conversations
    `)

    // Total de conversaciones
    const conversationsResult = await query(`
      SELECT COUNT(*) as total
      FROM chat.conversations
    `)

    // Total de mensajes
    const messagesResult = await query(`
      SELECT COUNT(*) as total
      FROM chat.messages
    `)

    // Total de feedback y promedio de rating
    const feedbackResult = await query(`
      SELECT
        COUNT(*) as total,
        AVG(rating) as avg_rating
      FROM chat.message_feedback
    `)

    res.json({
      ok: true,
      data: {
        total_users: parseInt(usersResult[0].total),
        active_users: parseInt(activeUsersResult[0].total),
        total_conversations: parseInt(conversationsResult[0].total),
        total_messages: parseInt(messagesResult[0].total),
        total_feedback: parseInt(feedbackResult[0].total),
        avg_rating: parseFloat(feedbackResult[0].avg_rating) || 0,
      },
    })
  } catch (error) {
    console.error('Error en /stats:', error)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Actividad de los últimos 7 días
router.get('/activity/week', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('day', created_at), 'Day') as day_name,
        TO_CHAR(DATE_TRUNC('day', created_at), 'DD/MM') as day_short,
        COUNT(*) as message_count
      FROM chat.messages
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', created_at), TO_CHAR(DATE_TRUNC('day', created_at), 'Day'), TO_CHAR(DATE_TRUNC('day', created_at), 'DD/MM')
      ORDER BY DATE_TRUNC('day', created_at) ASC
    `)

    // Nombres de días en español
    const dayNames = {
      Monday: 'Lunes',
      Tuesday: 'Martes',
      Wednesday: 'Miércoles',
      Thursday: 'Jueves',
      Friday: 'Viernes',
      Saturday: 'Sábado',
      Sunday: 'Domingo',
    }

    const data = result.map((row) => ({
      period: dayNames[row.day_name.trim()] || row.day_name.trim(),
      messages: parseInt(row.message_count),
      conversations: 0, // opcional, por si quieres agregarlo después
    }))

    res.json({ ok: true, data })
  } catch (error) {
    console.error('Error en /activity/week:', error)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Actividad de las últimas 4 semanas
router.get('/activity/month', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        'Semana ' || (4 - FLOOR(EXTRACT(DAY FROM NOW() - created_at) / 7)::int) as week_name,
        COUNT(*) as message_count
      FROM chat.messages
      WHERE created_at >= NOW() - INTERVAL '28 days'
      GROUP BY FLOOR(EXTRACT(DAY FROM NOW() - created_at) / 7)
      ORDER BY FLOOR(EXTRACT(DAY FROM NOW() - created_at) / 7) DESC
    `)

    const data = result.map((row) => ({
      period: row.week_name,
      messages: parseInt(row.message_count),
      conversations: 0,
    }))

    res.json({ ok: true, data })
  } catch (error) {
    console.error('Error en /activity/month:', error)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Actividad de los últimos 12 meses
router.get('/activity/year', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Month') as month_name,
        COUNT(*) as message_count
      FROM chat.messages
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at), TO_CHAR(DATE_TRUNC('month', created_at), 'Month')
      ORDER BY DATE_TRUNC('month', created_at) ASC
    `)

    // Nombres de meses en español
    const monthNames = {
      January: 'Enero',
      February: 'Febrero',
      March: 'Marzo',
      April: 'Abril',
      May: 'Mayo',
      June: 'Junio',
      July: 'Julio',
      August: 'Agosto',
      September: 'Septiembre',
      October: 'Octubre',
      November: 'Noviembre',
      December: 'Diciembre',
    }

    const data = result.map((row) => ({
      period: monthNames[row.month_name.trim()] || row.month_name.trim(),
      messages: parseInt(row.message_count),
      conversations: 0,
    }))

    res.json({ ok: true, data })
  } catch (error) {
    console.error('Error en /activity/year:', error)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Resumen paginado de conversaciones con estadísticas clave.
router.get('/conversations', async (req, res) => {
  try {
    const { page = '1', limit = '20', q = '', owner, participant } = req.query

    const p = Math.max(parseInt(page, 10) || 1, 1)
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
    const offset = (p - 1) * l

    const clauses = []
    const params = []

    if (q) {
      params.push(`%${q}%`)
      clauses.push(`(v.title ILIKE $${params.length})`)
    }

    if (owner) {
      params.push(owner)
      clauses.push(`v.owner_user_id = $${params.length}`)
    }

    if (participant) {
      params.push(participant)
      clauses.push(
        `EXISTS (
           SELECT 1 FROM chat.participants p
           WHERE p.conversation_id = v.conversation_id
             AND p.user_id = $${params.length}
         )`
      )
    }

    const whereSQL = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const baseFrom =
      'FROM admin.v_conversations_summary v JOIN chat.conversations c ON c.id = v.conversation_id'

    const totalRows = await query(
      `SELECT COUNT(*)::int AS count
       ${baseFrom}
       ${whereSQL}`,
      params
    )
    const total = totalRows[0]?.count || 0

    const rows = await query(
      `SELECT v.*, c.is_active
       ${whereSQL}
       ORDER BY v.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, offset]
    )

    res.json({ ok: true, page: p, limit: l, total, data: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Detalle completo de una conversación: participantes, mensajes y feedback.
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversationId = req.params.id

    const conversations = await query(
      `SELECT id, owner_user_id, title, created_at, closed_at, is_active
       FROM chat.conversations
       WHERE id = $1`,
      [conversationId]
    )

    const conversation = conversations[0]
    if (!conversation) {
      return res
        .status(404)
        .json({ ok: false, error: 'conversation_not_found' })
    }

    const participants = await query(
      `SELECT p.user_id, p.is_owner, p.added_at,
              u.display_name, u.email
       FROM chat.participants p
       JOIN auth.users u ON u.id = p.user_id
       WHERE p.conversation_id = $1
       ORDER BY p.added_at`,
      [conversationId]
    )

    const messages = await query(
      `SELECT
         m.id,
         m.sender,
         m.sender_user_id,
         su.display_name AS sender_display_name,
         su.email AS sender_email,
        m.content,
        m.latency_ms,
        m.created_at,
        m.metadata,
        COALESCE(feedback.items, '[]'::json) AS feedback
       FROM chat.messages m
       LEFT JOIN auth.users su ON su.id = m.sender_user_id
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'id', f.id,
                    'user_id', f.user_id,
                    'user_display_name', fu.display_name,
                    'user_email', fu.email,
                    'rating', f.rating,
                    'comment', f.comment,
                    'created_at', f.created_at
                  )
                  ORDER BY f.created_at
                ) AS items
         FROM chat.message_feedback f
         JOIN auth.users fu ON fu.id = f.user_id
         WHERE f.message_id = m.id
       ) feedback ON TRUE
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    )

    res.json({ ok: true, data: { ...conversation, participants, messages } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Resumen de calificaciones agrupadas por usuario.
router.get('/feedback/summary', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT *
       FROM admin.v_feedback_stats_by_user
       ORDER BY total_ratings DESC, avg_rating DESC`
    )

    res.json({ ok: true, data: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

// Listado paginado de calificaciones individuales (para ver sugerencias).
router.get('/feedback/messages', async (req, res) => {
  try {
    const { page = '1', limit = '20', conversation, user } = req.query

    const p = Math.max(parseInt(page, 10) || 1, 1)
    const l = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)
    const offset = (p - 1) * l

    const clauses = []
    const params = []

    if (conversation) {
      params.push(conversation)
      clauses.push(`m.conversation_id = $${params.length}`)
    }

    if (user) {
      params.push(user)
      clauses.push(`f.user_id = $${params.length}`)
    }

    const whereSQL = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

    const totalRows = await query(
      `SELECT COUNT(*)::int AS count
       FROM chat.message_feedback f
       JOIN chat.messages m ON m.id = f.message_id
       ${whereSQL}`,
      params
    )
    const total = totalRows[0]?.count || 0

    const rows = await query(
      `SELECT
         f.id,
         f.message_id,
         f.user_id,
         fu.display_name AS user_display_name,
         fu.email AS user_email,
         f.rating,
         f.comment,
         f.created_at,
         m.conversation_id,
         m.sender,
        m.created_at AS message_created_at,
        m.metadata,
        su.display_name AS sender_display_name,
         su.email AS sender_email
       FROM chat.message_feedback f
       JOIN chat.messages m ON m.id = f.message_id
       JOIN auth.users fu ON fu.id = f.user_id
       LEFT JOIN auth.users su ON su.id = m.sender_user_id
       ${whereSQL}
       ORDER BY f.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, offset]
    )

    res.json({ ok: true, page: p, limit: l, total, data: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: 'internal_error' })
  }
})

export default router
