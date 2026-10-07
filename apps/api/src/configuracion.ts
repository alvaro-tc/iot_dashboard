// Configuración de cada robot: lectura con caché y publicación retenida en MQTT.
//
// La caché existe porque cada lectura de telemetría (5 Hz por robot) necesita los umbrales
// de evasión para decidir si hay evento. Ir a Postgres 5 veces por segundo y por robot para
// leer una fila que casi nunca cambia no tiene sentido.
import { CONFIG_POR_DEFECTO, topico, type Configuracion, type Modo } from '@iot/shared';
import { z } from 'zod';
import { pool } from './db.ts';
import { publicar } from './mqtt/bridge.ts';

export const configSchema = z.object({
  modo: z.enum(['automatico', 'pausado', 'detenido']).optional(),
  distanciaEvasionCm: z.number().int().min(5).max(50).optional(),
  distanciaPrecaucionCm: z.number().int().min(6).max(100).optional(),
  velocidadBasePct: z.number().int().min(30).max(100).optional(),
  intervaloTelemetriaMs: z.number().int().min(100).max(2000).optional(),
  angulosSensores: z
    .object({ izq: z.number().min(-90).max(90), centro: z.number().min(-90).max(90), der: z.number().min(-90).max(90) })
    .optional(),
  areaAnchoCm: z.number().int().min(100).max(2000).optional(),
  areaAltoCm: z.number().int().min(100).max(2000).optional(),
});
export type CambioConfig = z.infer<typeof configSchema>;

const cache = new Map<string, Configuracion>();

const COLUMNAS = `modo,
  distancia_evasion_cm    AS "distanciaEvasionCm",
  distancia_precaucion_cm AS "distanciaPrecaucionCm",
  velocidad_base_pct      AS "velocidadBasePct",
  intervalo_telemetria_ms AS "intervaloTelemetriaMs",
  angulos_sensores        AS "angulosSensores",
  area_ancho_cm           AS "areaAnchoCm",
  area_alto_cm            AS "areaAltoCm"`;

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

/**
 * Aplica un cambio parcial, lo guarda y lo publica. La validación de rangos la hacen zod y
 * los CHECK de la tabla; aquí solo se comprueba la relación entre los dos umbrales, que
 * depende de los dos valores a la vez.
 */
export async function actualizarConfiguracion(dispositivoId: string, cambio: CambioConfig): Promise<Configuracion> {
  const actual = await configuracionDe(dispositivoId);
  const evasion = cambio.distanciaEvasionCm ?? actual.distanciaEvasionCm;
  const precaucion = cambio.distanciaPrecaucionCm ?? actual.distanciaPrecaucionCm;
  if (precaucion <= evasion) {
    throw Object.assign(new Error('La distancia de precaución debe ser mayor que la de evasión.'), {
      campo: 'distanciaPrecaucionCm',
    });
  }

  const { rows } = await pool.query<Configuracion>(
    `UPDATE configuracion_dispositivo SET
       modo = coalesce($2, modo),
       distancia_evasion_cm = coalesce($3, distancia_evasion_cm),
       distancia_precaucion_cm = coalesce($4, distancia_precaucion_cm),
       velocidad_base_pct = coalesce($5, velocidad_base_pct),
       intervalo_telemetria_ms = coalesce($6, intervalo_telemetria_ms),
       angulos_sensores = coalesce($7::jsonb, angulos_sensores),
       area_ancho_cm = coalesce($8, area_ancho_cm),
       area_alto_cm = coalesce($9, area_alto_cm),
       actualizado_en = now()
     WHERE dispositivo_id = $1
     RETURNING ${COLUMNAS}`,
    [
      dispositivoId,
      cambio.modo ?? null,
      cambio.distanciaEvasionCm ?? null,
      cambio.distanciaPrecaucionCm ?? null,
      cambio.velocidadBasePct ?? null,
      cambio.intervaloTelemetriaMs ?? null,
      cambio.angulosSensores ? JSON.stringify(cambio.angulosSensores) : null,
      cambio.areaAnchoCm ?? null,
      cambio.areaAltoCm ?? null,
    ],
  );

  const cfg = rows[0];
  cache.set(dispositivoId, cfg);
  publicarConfiguracion(dispositivoId, cfg);
  return cfg;
}

export const modoDe = async (dispositivoId: string): Promise<Modo> => (await configuracionDe(dispositivoId)).modo;
