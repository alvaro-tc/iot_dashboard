import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, signToken } from '../auth.ts';
import { pool } from '../db.ts';
import { HttpError, isUniqueViolation, parse } from '../http.ts';

export const passwordSchema = z
  .string({ required_error: 'Escribe una contraseña.' })
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128, 'La contraseña no puede superar 128 caracteres.')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra.')
  .regex(/\d/, 'La contraseña debe incluir al menos un número.');
export const emailSchema = z
  .string({ required_error: 'Escribe tu correo.' })
  .trim()
  .toLowerCase()
  .email('Escribe un correo válido, por ejemplo nombre@dominio.com.');
export const nameSchema = z
  .string({ required_error: 'Escribe un nombre.' })
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres.')
  .max(80, 'El nombre no puede superar 80 caracteres.');

export const USER_COLUMNS = `id, email, name, role, is_active AS "isActive", created_at AS "createdAt"`;
export const EMAIL_TAKEN = new HttpError(409, 'Revisa los campos marcados.', { email: 'Ya existe una cuenta con este correo.' });

const signupSchema = z
  .object({ name: nameSchema, email: emailSchema, password: passwordSchema, confirm: z.string().default('') })
  .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' });

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Escribe tu contraseña.' }).min(1, 'Escribe tu contraseña.'),
});

export const authRouter = Router();

authRouter.post('/auth/signup', async (req, res) => {
  const body = parse(signupSchema, req.body);
  const hash = await bcrypt.hash(body.password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, 'client') RETURNING ${USER_COLUMNS}`,
      [body.email, hash, body.name],
    );
    res.status(201).json({ token: signToken(rows[0]), user: rows[0] });
  } catch (e) {
    if (isUniqueViolation(e)) throw EMAIL_TAKEN;
    throw e;
  }
});

authRouter.post('/auth/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS}, password FROM users WHERE email = $1`, [body.email]);
  const row = rows[0];
  if (!row || !(await bcrypt.compare(body.password, row.password))) {
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  }
  if (!row.isActive) throw new HttpError(403, 'Tu cuenta está desactivada. Pide a un administrador que la reactive.');
  delete row.password;
  res.json({ token: signToken(row), user: row });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.user.id]);
  res.json(rows[0]);
});

const meSchema = z
  .object({
    name: nameSchema.optional(),
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.optional(),
  })
  .refine((d) => !d.newPassword || d.currentPassword, {
    path: ['currentPassword'],
    message: 'Escribe tu contraseña actual para cambiarla.',
  });

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = parse(meSchema, req.body);
  if (body.newPassword) {
    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(body.currentPassword!, rows[0].password))) {
      throw new HttpError(400, 'Revisa los campos marcados.', { currentPassword: 'La contraseña actual no es correcta.' });
    }
    await pool.query('UPDATE users SET password = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(body.newPassword, 10)]);
  }
  const { rows } = await pool.query(
    `UPDATE users SET name = coalesce($2, name) WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [req.user.id, body.name ?? null],
  );
  res.json(rows[0]);
});
