#!/bin/bash
# Instalación del VPS (Ubuntu 22.04 / 24.04), sin Docker.
#
#   sudo bash infra/instalar.sh
#
# Deja instalado y configurado: Node.js LTS, pnpm, pm2, Mosquitto, PostgreSQL,
# Caddy y el cortafuegos. NO toca el código ni arranca nada: eso es /docs/despliegue.md
# a partir del paso 4, que requiere decisiones (claves, dominio) que no se adivinan.
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Ejecútalo con sudo." >&2
  exit 1
fi

USUARIO="${SUDO_USER:-root}"

echo "==> Actualizando paquetes"
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Node.js LTS + pnpm + pm2"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm pm2

echo "==> Mosquitto (repositorio oficial)"
apt-get install -y software-properties-common
add-apt-repository -y ppa:mosquitto-dev/mosquitto-ppa
apt-get update -qq
apt-get install -y mosquitto mosquitto-clients

echo "==> PostgreSQL y git"
apt-get install -y postgresql git

echo "==> Caddy (repositorio oficial; trae TLS automático, no hace falta Certbot)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
fi

echo "==> Cortafuegos"
# 1883 NO se abre: ese listener escucha solo en 127.0.0.1 para el backend.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8883/tcp
ufw --force enable

echo "==> Permisos para que el backend gestione las credenciales del broker"
touch /etc/mosquitto/passwd /etc/mosquitto/acl
chown "$USUARIO" /etc/mosquitto/passwd /etc/mosquitto/acl
chmod 600 /etc/mosquitto/passwd
# Solo este comando, sin contraseña: el backend recarga Mosquitto al vincular o revocar.
echo "$USUARIO ALL=(root) NOPASSWD: /usr/bin/systemctl reload mosquitto, /bin/systemctl reload mosquitto" > /etc/sudoers.d/mosquitto-reload
chmod 440 /etc/sudoers.d/mosquitto-reload

echo "==> Carpeta de logs"
install -d -o "$USUARIO" -g "$USUARIO" /var/log/iot
install -d -o "$USUARIO" -g "$USUARIO" /srv/iot

# Caddy pide el certificado el solo la primera vez que sirve el dominio: basta con dejarle
# el Caddyfile con el nombre correcto (paso 5 de docs/despliegue.md). Certbot ya no hace falta.

cat <<FIN

Listo. Sigue en /docs/despliegue.md a partir del paso 4:

  1. Clona el repositorio en /srv/iot y ejecuta pnpm install
  2. Copia .env.example a .env y rellena las claves
  3. Crea el usuario y la base en PostgreSQL, y ejecuta pnpm db:reset
  4. Copia infra/mosquitto/roomba.conf a /etc/mosquitto/conf.d/
  5. Compila el frontend y copia infra/caddy/Caddyfile a /etc/caddy/Caddyfile
  6. pm2 start infra/ecosystem.config.cjs

FIN
