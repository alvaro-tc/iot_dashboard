// Presencia de los robots.
//
// El robot publica `estado` retenido con {en_linea:true} al conectar, y deja configurado un
// Last Will con {en_linea:false}. Así Mosquitto avisa de la caída aunque el robot se quede
// sin batería a mitad de sesión: no hace falta sondear nada.
import { pool } from './db.ts';
import { cerrarSesion } from './sesiones.ts';
import { emitirEstado } from './ws.ts';

export async function marcarPresencia(dispositivoId: string, enLinea: boolean, firmware: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE dispositivos
     SET en_linea = $2, ultimo_contacto = now(), version_firmware = coalesce($3, version_firmware)
     WHERE id = $1
     RETURNING id`,
    [dispositivoId, enLinea, firmware],
  );
  if (!rows[0]) return; // id desconocido: alguien publicando con credenciales de un robot borrado

  emitirEstado(dispositivoId, { enLinea, versionFirmware: firmware, ultimoContacto: Date.now() });

  // Un robot que se cae deja de publicar: la sesión abierta se cierra para que su duración
  // no siga contando mientras está apagado.
  if (!enLinea) await cerrarSesion(dispositivoId).catch(() => {});
}
