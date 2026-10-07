// Panel de administración: usuarios y visión global de la flota de robots.
//
// Un admin puede ver todos los robots (exigirPropiedad lo contempla), así que aquí solo
// vive lo que es exclusivamente suyo: gestionar cuentas y el resumen de la flota.
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.ts';
import { pool } from '../db.ts';
import { HttpError, isUniqueViolation, parse, positiveId } from '../http.ts';
import { removeDevices, syncBroker } from '../mqtt/broker-credentials.ts';
import { cerrarSesion } from '../sesiones.ts';
import { disconnectUser } from '../ws.ts';
import { EMAIL_TAKEN, USER_COLUMNS, emailSchema, nameSchema, passwordSchema } from './auth.ts';
import { COLUMNAS_DISPOSITIVO } from './dispositivos.ts';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const rolSchema = z.enum(['admin', 'client'], { message: 'Elige un rol: admin o cliente.' });

async function getUser(id: number) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'El usuario no existe.');
  return rows[0];
}

/** Debe quedar al menos un admin activo aparte del usuario `exceptId`. */
async function exigirOtroAdmin(exceptId: number) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
    [exceptId],
  );
  if (rows[0].n === 0) throw new HttpError(409, 'Debe quedar al menos un administrador activo.');
}

const sincronizarBrokerSuave = () =>
  syncBroker().catch((e) => console.error('[admin] no se pudo sincronizar el broker:', e.message));

// ---------- Panel general ----------

adminRouter.get('/resumen', async (_req, res) => {
  const [totales, activos] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*) FROM users WHERE role = 'client')::int            AS clientes,
              (SELECT count(*) FROM dispositivos WHERE NOT is_revoked)::int      AS robots,
              (SELECT count(*) FROM dispositivos WHERE en_linea
                                               AND NOT is_revoked)::int          AS "robotsEnLinea",
              (SELECT count(*) FROM sesiones
                WHERE iniciada_en >= date_trunc('day', now()))::int              AS "sesionesHoy",
              (SELECT count(*) FROM sesiones WHERE finalizada_en IS NULL)::int   AS "sesionesActivas",
              (SELECT count(*) FROM eventos
                WHERE NOT atendido AND tipo IN ('atascado','bateria_baja'))::int AS "alertasPendientes"`,
    ),
    pool.query(
      `SELECT s.id AS "sesionId", s.dispositivo_id AS "dispositivoId", d.nombre, u.name AS "usuario",
              s.iniciada_en AS "iniciadaEn", s.total_lecturas AS "lecturas",
              s.distancia_recorrida_cm AS "distanciaCm"
       FROM sesiones s
       JOIN dispositivos d ON d.id = s.dispositivo_id
       JOIN users u ON u.id = d.user_id
       WHERE s.finalizada_en IS NULL ORDER BY s.iniciada_en`,
    ),
  ]);
  res.json({ ...totales.rows[0], sesionesEnCurso: activos.rows });
});

adminRouter.get('/robots', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO}, u.name AS "usuario", u.email AS "usuarioEmail",
            (SELECT count(*)::int FROM sesiones s WHERE s.dispositivo_id = d.id) AS "totalSesiones"
     FROM dispositivos d JOIN users u ON u.id = d.user_id
     ORDER BY d.is_revoked, d.creado_en DESC`,
  );
  res.json(rows);
});

// ---------- Usuarios ----------

adminRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.is_active AS "isActive", u.created_at AS "createdAt",
            (SELECT count(*)::int FROM dispositivos d
              WHERE d.user_id = u.id AND NOT d.is_revoked)                        AS "robots",
            (SELECT count(*)::int FROM sesiones s JOIN dispositivos d ON d.id = s.dispositivo_id
              WHERE d.user_id = u.id)                                             AS "sesiones",
            (SELECT max(d.ultimo_contacto) FROM dispositivos d WHERE d.user_id = u.id) AS "ultimaActividad"
     FROM users u ORDER BY u.role, u.name`,
  );
  res.json(rows);
});

adminRouter.post('/users', async (req, res) => {
  const body = parse(
    z.object({ name: nameSchema, email: emailSchema, password: passwordSchema, role: rolSchema }),
    req.body,
  );
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
      [body.email, await bcrypt.hash(body.password, 10), body.name, body.role],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw EMAIL_TAKEN;
    throw e;
  }
});

adminRouter.get('/users/:id', async (req, res) => {
  res.json(await getUser(positiveId(req.params.id)));
});

adminRouter.get('/users/:id/robots', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO} FROM dispositivos WHERE user_id = $1 ORDER BY is_revoked, creado_en DESC`,
    [positiveId(req.params.id)],
  );
  res.json(rows);
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = positiveId(req.params.id);
  const body = parse(
    z.object({
      name: nameSchema.optional(),
      email: emailSchema.optional(),
      role: rolSchema.optional(),
      isActive: z.boolean().optional(),
    }),
    req.body,
  );
  const objetivo = await getUser(id);
  const pierdeAdmin = objetivo.role === 'admin' && (body.role === 'client' || body.isActive === false);
  if (id === req.user.id && pierdeAdmin) {
    throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
  }
  if (pierdeAdmin) await exigirOtroAdmin(id);

  let actualizado;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email), role = coalesce($4, role),
                        is_active = coalesce($5, is_active)
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, body.name ?? null, body.email ?? null, body.role ?? null, body.isActive ?? null],
    );
    actualizado = rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) throw EMAIL_TAKEN;
    throw e;
  }

  // Desactivar a alguien corta sus robots: la ACL deja de incluirlos y sus sesiones se cierran.
  if (body.isActive === false && objetivo.isActive) {
    const robots = await pool.query<{ id: string }>('SELECT id FROM dispositivos WHERE user_id = $1', [id]);
    for (const r of robots.rows) await cerrarSesion(r.id).catch(() => {});
    disconnectUser(id);
  }
  if (body.role && body.role !== objetivo.role) disconnectUser(id); // que reconecte con el rol nuevo
  if (body.isActive !== undefined && body.isActive !== objetivo.isActive) await sincronizarBrokerSuave();
  res.json(actualizado);
});

adminRouter.post('/users/:id/password', async (req, res) => {
  const id = positiveId(req.params.id);
  await getUser(id);
  const password = nanoid(12);
  await pool.query('UPDATE users SET password = $2 WHERE id = $1', [id, await bcrypt.hash(password, 10)]);
  res.json({ password }); // se muestra una sola vez
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = positiveId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');
  const objetivo = await getUser(id);
  if (objetivo.role === 'admin') await exigirOtroAdmin(id);

  const robots = await pool.query<{ id: string }>('SELECT id FROM dispositivos WHERE user_id = $1', [id]);
  for (const r of robots.rows) await cerrarSesion(r.id).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = $1', [id]); // cascada: dispositivos, sesiones, lecturas, eventos
  disconnectUser(id);
  if (robots.rowCount) {
    await removeDevices(robots.rows.map((r) => r.id)).catch((e) =>
      console.error('[admin] no se pudo quitar credenciales del broker:', e.message),
    );
  }
  res.status(204).end();
});

/** Borra el historial de un usuario sin borrar sus robots ni su cuenta. */
adminRouter.delete('/users/:id/datos', async (req, res) => {
  const id = positiveId(req.params.id);
  await getUser(id);
  const { rowCount } = await pool.query(
    `DELETE FROM sesiones WHERE dispositivo_id IN (SELECT id FROM dispositivos WHERE user_id = $1)`,
    [id],
  ); // cascada: lecturas y eventos de esas sesiones
  res.json({ sesionesBorradas: rowCount });
});
