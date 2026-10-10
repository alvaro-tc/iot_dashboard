// Configuración de cada robot: lectura con caché y publicación retenida en MQTT.
//
// Son solo dos ajustes: la velocidad de crucero (PWM 0..255, misma escala que el firmware) y
// el ángulo de montaje de cada HC-SR04. La caché existe porque la configuración casi nunca
// cambia y se consulta en cada alta de robot y en cada navegador que se une a una sala.
import { CONFIG_POR_DEFECTO, PWM_MAX, topico, type Configuracion } from '@iot/shared';
import { z } from 'zod';
import { pool } from './db.ts';
import { publicar } from './mqtt/bridge.ts';

const angulo = z.number().min(-90).max(90);

export const configSchema = z.object({
  velocidadBase: z.number().int().min(0).max(PWM_MAX).optional(),
  angulosSensores: z.object({ izquierdo: angulo, central: angulo, derecho: angulo }).optional(),
});
export type CambioConfig = z.infer<typeof configSchema>;

const cache = new Map<string, Configuracion>();

const COLUMNAS = `velocidad_base   AS "velocidadBase",
  angulos_sensores AS "angulosSensores"`;

export async function configuracionDe(dispositivoId: string): Promise<Configuracion> {
  const enCache = cache.get(dispositivoId);
  if (enCache) return enCache;
  const { rows } = await pool.query<Configuracion>(
    `SELECT ${COLUMNAS} FROM configuracion_dispositivo WHERE dispositivo_id = $1`,
    [dispositivoId],
  );
  // Un robot sin fila de configuración no debería existir (lo crea un trigger), pero si el
  // mensaje llega de un id desconocido es mejor usar los valores por defecto que reventar.
  const cfg = rows[0] ?? CONFIG_POR_DEFECTO;
  cache.set(dispositivoId, cfg);
  return cfg;
}

export const olvidarConfiguracion = (dispositivoId: string) => cache.delete(dispositivoId);

/** Publica la configuración vigente retenida: un robot que arranca la recibe al suscribirse. */
export function publicarConfiguracion(dispositivoId: string, cfg: Configuracion): void {
  publicar(topico(dispositivoId, 'config'), cfg, { qos: 1, retain: true });
}

/** Aplica un cambio parcial, lo guarda y lo publica. Los rangos los validan zod y los CHECK. */
export async function actualizarConfiguracion(dispositivoId: string, cambio: CambioConfig): Promise<Configuracion> {
  const { rows } = await pool.query<Configuracion>(
    `UPDATE configuracion_dispositivo SET
       velocidad_base = coalesce($2, velocidad_base),
       angulos_sensores = coalesce($3::jsonb, angulos_sensores),
       actualizado_en = now()
     WHERE dispositivo_id = $1
     RETURNING ${COLUMNAS}`,
    [
      dispositivoId,
      cambio.velocidadBase ?? null,
      cambio.angulosSensores ? JSON.stringify(cambio.angulosSensores) : null,
    ],
  );

  const cfg = rows[0];
  cache.set(dispositivoId, cfg);
  publicarConfiguracion(dispositivoId, cfg);
  return cfg;
}
