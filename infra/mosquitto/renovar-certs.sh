#!/bin/bash
# Copia el certificado que gestiona Caddy a donde Mosquitto puede leerlo y lo recarga.
#
# Por qué existe: el listener 8883 necesita el mismo certificado del dominio, pero Mosquitto
# corre como el usuario `mosquitto`, que no tiene permiso sobre el almacén de Caddy
# (/var/lib/caddy/...). Por eso se copia en vez de enlazarlo.
#
# Caddy renueva solo, sin hooks. Este script se ejecuta a diario por cron y no hace nada si
# el certificado no ha cambiado.
#
# Instalación:
#   sudo cp renovar-certs.sh /usr/local/bin/mosquitto-certs
#   sudo chmod +x /usr/local/bin/mosquitto-certs
#   sudo DOMINIO=tu-dominio.com /usr/local/bin/mosquitto-certs
#   echo '17 4 * * * DOMINIO=tu-dominio.com /usr/local/bin/mosquitto-certs' | sudo tee /etc/cron.d/mosquitto-certs
set -euo pipefail

DOMINIO="${DOMINIO:-}"
if [ -z "$DOMINIO" ]; then
  echo "No sé para qué dominio: define DOMINIO=tu-dominio.com" >&2
  exit 1
fi

# La ruta incluye la CA que emitió el certificado, que puede cambiar: se busca.
BASE=/var/lib/caddy/.local/share/caddy/certificates
CRT=$(find "$BASE" -type f -name "$DOMINIO.crt" 2>/dev/null | head -1)
if [ -z "$CRT" ]; then
  echo "No encuentro el certificado de $DOMINIO en $BASE. ¿Ya lo emitió Caddy?" >&2
  exit 1
fi

DESTINO=/etc/mosquitto/certs
install -d -o mosquitto -g mosquitto -m 750 "$DESTINO"
# El .crt de Caddy ya es la cadena completa (hoja + intermedios).
if cmp -s "$CRT" "$DESTINO/fullchain.pem"; then
  exit 0
fi
install -o mosquitto -g mosquitto -m 644 "$CRT" "$DESTINO/fullchain.pem"
install -o mosquitto -g mosquitto -m 600 "${CRT%.crt}.key" "$DESTINO/privkey.pem"

systemctl reload mosquitto
echo "Certificado de $DOMINIO copiado y Mosquitto recargado."
