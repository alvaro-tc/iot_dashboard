import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from './db.ts';
import { env } from './env.ts';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'client';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

export function signToken(user: Pick<AuthUser, 'id' | 'role'>): string {
  return jwt.sign({ sub: String(user.id), role: user.role }, env.JWT_SECRET, { expiresIn: '12h' });
}

/**
 * Verifica el JWT y relee el usuario: así un usuario desactivado o con el rol cambiado
 * pierde el acceso en la siguiente petición, sin esperar a que caduque el token.
 */
export async function userFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    const { rows } = await pool.query<AuthUser>(
      'SELECT id, email, name, role FROM users WHERE id = $1 AND is_active',
      [Number(payload.sub)],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  const user = await userFromToken(header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!user) {
    res.status(401).json({ error: 'Tu sesión expiró o tu cuenta está desactivada. Inicia sesión de nuevo.' });
    return;
  }
  req.user = user;
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Esta sección es solo para administradores.' });
};
