// Presencia de los robots.
//
// El robot publica `estado` retenido con {en_linea:true} al conectar, y deja configurado un
// Last Will con {en_linea:false}. Así Mosquitto avisa de la caída aunque el robot se quede
// sin batería a mitad de limpieza: no hace falta sondear nada.
import { pool } from './db.ts';
import { encolarEvento } from './persistencia.ts';
import { cerrarSesion, sesionActiva } from './sesiones.ts';
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

  const evento = {
    dispositivoId,
    sesionId: sesionActiva(dispositivoId)?.id ?? null,
    tipo: enLinea ? 'conexion' : 'desconexion',
    sensor: null,
    distanciaCm: null,
    posXCm: null,
    posYCm: null,
    mensaje: enLinea ? 'El robot se conectó' : 'El robot se desconectó',
    creadoEn: Date.now(),
  };
  emitirEstado(dispositivoId, { enLinea, versionFirmware: firmware, ultimoContacto: Date.now() });
  encolarEvento(evento);

  // Un robot que se cae deja de recorrer: la sesión abierta se cierra para que la duración
  // y la distancia no sigan contando mientras está apagado.
  if (!enLinea) await cerrarSesion(dispositivoId).catch(() => {});
}
