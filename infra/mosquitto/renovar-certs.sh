#!/bin/bash
# Hook de Certbot: copia los certificados renovados a donde Mosquitto puede leerlos y lo
# recarga.
#
# Mosquitto corre como el usuario `mosquitto`, que NO tiene permiso sobre
# /etc/letsencrypt/live. Por eso se copian en vez de enlazarlos.
#
# Instalación:
#   sudo cp renovar-certs.sh /etc/letsencrypt/renewal-hooks/deploy/
#   sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/renovar-certs.sh
#   sudo DOMINIO=tu-dominio.com /etc/letsencrypt/renewal-hooks/deploy/renovar-certs.sh
set -euo pipefail

DOMINIO="${DOMINIO:-${RENEWED_DOMAINS%% *}}"
if [ -z "$DOMINIO" ]; then
  echo "No sé para qué dominio: define DOMINIO=tu-dominio.com" >&2
  exit 1
fi

ORIGEN="/etc/letsencrypt/live/$DOMINIO"
DESTINO="/etc/mosquitto/certs"

install -d -o mosquitto -g mosquitto -m 750 "$DESTINO"
install -o mosquitto -g mosquitto -m 644 "$ORIGEN/fullchain.pem" "$DESTINO/fullchain.pem"
install -o mosquitto -g mosquitto -m 600 "$ORIGEN/privkey.pem"   "$DESTINO/privkey.pem"

systemctl reload mosquitto
echo "Certificados de $DOMINIO copiados y Mosquitto recargado."
