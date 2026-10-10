// POST /api/ingesta — camino alternativo al MQTT.
//
// Un firmware que no pueda usar MQTT manda aquí lotes de lecturas por HTTP cada segundo,
// sin pasar por el broker. Es más lento, no recibe comandos y no detecta la desconexión,
// pero demuestra la inserción por API REST y sirve si en una red no se puede usar MQTT.
//
// Autenticación: el robot se identifica con su propia contraseña MQTT
// (Authorization: Bearer <token>), que en la base está como hash bcrypt. No usa el JWT de
// usuario: un ESP32 no inicia sesión.
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.ts';
import { HttpError, parse } from '../http.ts';
import { procesarTelemetria, telemetriaSchema } from '../telemetria.ts';

export const ingestaRouter = Router();

const cuerpoSchema = z.object({
  dispositivoId: z.string().min(1).max(64),
  lecturas: z.array(telemetriaSchema).min(1).max(200),
});

/**
 * Caché del hash por robot: comparar bcrypt en cada lote (1/s por robot) costaría ~100 ms
 * de CPU cada vez. Se guarda el hash, no el token, y se relee cada 5 minutos para que una
 * regeneración de credenciales surta efecto sin reiniciar.
 */
const cacheHash = new Map<string, { hash: string; expira: number }>();
const TTL_CACHE_MS = 5 * 60_000;

async function hashDe(dispositivoId: string): Promise<string | null> {
  const enCache = cacheHash.get(dispositivoId);
  if (enCache && enCache.expira > Date.now()) return enCache.hash;

  const { rows } = await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM dispositivos WHERE id = $1 AND NOT revocado',
    [dispositivoId],
  );
  if (!rows[0]) {
    cacheHash.delete(dispositivoId);
    return null;
  }
  cacheHash.set(dispositivoId, { hash: rows[0].token_hash, expira: Date.now() + TTL_CACHE_MS });
  return rows[0].token_hash;
}

ingestaRouter.post('/ingesta', async (req, res) => {
  const cabecera = req.headers.authorization;
  const token = cabecera?.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) throw new HttpError(401, 'Falta el token del robot.');

  const cuerpo = parse(cuerpoSchema, req.body);
  const hash = await hashDe(cuerpo.dispositivoId);
  if (!hash || !(await bcrypt.compare(token, hash))) {
    throw new HttpError(401, 'Credenciales del robot incorrectas.');
  }

  // Mismo camino que el puente MQTT: emitir por WebSocket primero, persistir después.
  for (const lectura of cuerpo.lecturas) {
    await procesarTelemetria(cuerpo.dispositivoId, lectura, Date.now());
  }
  res.status(202).json({ recibidas: cuerpo.lecturas.length });
});
