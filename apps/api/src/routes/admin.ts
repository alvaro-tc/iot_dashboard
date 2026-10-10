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

const rolSchema = z.enum(['admin', 'cliente'], { message: 'Elige un rol: admin o cliente.' });

async function getUser(id: number) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM usuarios WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'El usuario no existe.');
  return rows[0];
}

/** Debe quedar al menos un admin activo aparte del usuario `exceptId`. */
async function exigirOtroAdmin(exceptId: number) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo AND id <> $1`,
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
      `SELECT (SELECT count(*) FROM usuarios WHERE rol = 'cliente')::int            AS clientes,
              (SELECT count(*) FROM dispositivos WHERE NOT revocado)::int      AS robots,
              (SELECT count(*) FROM dispositivos WHERE en_linea
                                               AND NOT revocado)::int          AS "robotsEnLinea",
              (SELECT count(*) FROM sesiones
                WHERE iniciada_en >= date_trunc('day', now()))::int              AS "sesionesHoy",
              (SELECT count(*) FROM sesiones WHERE finalizada_en IS NULL)::int   AS "sesionesActivas"`,
    ),
    pool.query(
      `SELECT s.id AS "sesionId", s.dispositivo_id AS "dispositivoId", d.nombre, u.nombre AS "usuario",
              s.iniciada_en AS "iniciadaEn", s.total_lecturas AS "lecturas"
       FROM sesiones s
       JOIN dispositivos d ON d.id = s.dispositivo_id
       JOIN usuarios u ON u.id = d.usuario_id
       WHERE s.finalizada_en IS NULL ORDER BY s.iniciada_en`,
    ),
  ]);
  res.json({ ...totales.rows[0], sesionesEnCurso: activos.rows });
});

adminRouter.get('/robots', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO}, u.nombre AS "usuario", u.correo AS "usuarioEmail",
            (SELECT count(*)::int FROM sesiones s WHERE s.dispositivo_id = d.id) AS "totalSesiones"
     FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id
     ORDER BY d.revocado, d.creado_en DESC`,
  );
  res.json(rows);
});

// ---------- Usuarios ----------

adminRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.correo AS email, u.nombre AS name, u.rol AS role,
            u.activo AS "isActive", u.creado_en AS "createdAt",
            (SELECT count(*)::int FROM dispositivos d
              WHERE d.usuario_id = u.id AND NOT d.revocado)                        AS "robots",
            (SELECT count(*)::int FROM sesiones s JOIN dispositivos d ON d.id = s.dispositivo_id
              WHERE d.usuario_id = u.id)                                             AS "sesiones",
            (SELECT max(d.ultimo_contacto) FROM dispositivos d WHERE d.usuario_id = u.id) AS "ultimaActividad"
     FROM usuarios u ORDER BY u.rol, u.nombre`,
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
      `INSERT INTO usuarios (correo, contrasena, nombre, rol) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
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
    `SELECT ${COLUMNAS_DISPOSITIVO} FROM dispositivos WHERE usuario_id = $1 ORDER BY revocado, creado_en DESC`,
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
  const pierdeAdmin = objetivo.role === 'admin' && (body.role === 'cliente' || body.isActive === false);
  if (id === req.user.id && pierdeAdmin) {
    throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
  }
  if (pierdeAdmin) await exigirOtroAdmin(id);

  let actualizado;
  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET nombre = coalesce($2, nombre), correo = coalesce($3, correo),
                           rol = coalesce($4, rol), activo = coalesce($5, activo)
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
    const robots = await pool.query<{ id: string }>('SELECT id FROM dispositivos WHERE usuario_id = $1', [id]);
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
  await pool.query('UPDATE usuarios SET contrasena = $2 WHERE id = $1', [id, await bcrypt.hash(password, 10)]);
  res.json({ password }); // se muestra una sola vez
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = positiveId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');
  const objetivo = await getUser(id);
  if (objetivo.role === 'admin') await exigirOtroAdmin(id);

  const robots = await pool.query<{ id: string }>('SELECT id FROM dispositivos WHERE usuario_id = $1', [id]);
  for (const r of robots.rows) await cerrarSesion(r.id).catch(() => {});
  await pool.query('DELETE FROM usuarios WHERE id = $1', [id]); // cascada: dispositivos, sesiones y lecturas
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
    `DELETE FROM sesiones WHERE dispositivo_id IN (SELECT id FROM dispositivos WHERE usuario_id = $1)`,
    [id],
  ); // cascada: las lecturas de esas sesiones
  res.json({ sesionesBorradas: rowCount });
});
