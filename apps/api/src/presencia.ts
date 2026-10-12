// Presencia de los robots.
//
// El robot publica `estado` retenido con {en_linea:true} al conectar, y deja configurado un
// Last Will con {en_linea:false}. Así Mosquitto avisa de la caída aunque el robot se quede
// sin batería a mitad de sesión: no hace falta sondear nada.
import { pool } from './db.ts';
import { cerrarSesion } from './sesiones.ts';
import { emitirCambio, emitirEstado } from './ws.ts';

const CLAVES_PRESENCIA = ['dispositivos', 'admin-robots', 'admin-resumen', 'sesiones', 'resumen'];

export async function marcarPresencia(dispositivoId: string, enLinea: boolean, firmware: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string; usuario_id: number }>(
    `UPDATE dispositivos
     SET en_linea = $2, ultimo_contacto = now(), version_firmware = coalesce($3, version_firmware)
     WHERE id = $1
     RETURNING id, usuario_id`,
    [dispositivoId, enLinea, firmware],
  );
  if (!rows[0]) return; // id desconocido: alguien publicando con credenciales de un robot borrado

  emitirEstado(dispositivoId, { enLinea, versionFirmware: firmware, ultimoContacto: Date.now() });
  // El badge "en línea" de las listas sale de /api/dispositivos, no de la sala del robot:
  // sin esto solo se enteraba el panel del robot que estuvieras mirando.
  emitirCambio(CLAVES_PRESENCIA, rows[0].usuario_id);

  // Un robot que se cae deja de publicar: la sesión abierta se cierra para que su duración
  // no siga contando mientras está apagado.
  if (!enLinea) await cerrarSesion(dispositivoId).catch(() => {});
}
