# Despliegue en un VPS sin Docker

Ubuntu 22.04 o 24.04. Todo nativo: Mosquitto, PostgreSQL, Node.js LTS, pm2, Nginx y Certbot.
Pensado para un VPS pequeño (1 vCPU, 1–2 GB de RAM).

## 1. Paquetes

```bash
sudo apt update && sudo apt upgrade -y

# Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm pm2

# Mosquitto desde el repositorio oficial (el de Ubuntu suele ir atrasado)
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:mosquitto-dev/mosquitto-ppa
sudo apt update && sudo apt install -y mosquitto mosquitto-clients

sudo apt install -y postgresql nginx certbot python3-certbot-nginx git
```

## 2. Cortafuegos

```bash
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP (Certbot)
sudo ufw allow 443/tcp    # HTTPS
sudo ufw allow 8883/tcp   # MQTT sobre TLS (los robots)
sudo ufw enable
```

El puerto **1883 no se abre**: ese listener escucha solo en `127.0.0.1` y es por donde habla
el backend. Nadie desde fuera debe poder conectarse a MQTT sin TLS.

## 3. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE USER iot WITH PASSWORD 'pon-aqui-una-clave-larga';
CREATE DATABASE iot OWNER iot;
SQL
```

Se queda escuchando solo en localhost, que es el valor por defecto. No hay que tocar
`postgresql.conf`.

## 4. Código

```bash
sudo mkdir -p /srv/iot && sudo chown $USER:$USER /srv/iot
git clone <tu-repo> /srv/iot && cd /srv/iot
pnpm install
cp .env.example .env
```

Edita `/srv/iot/.env`:

```ini
DATABASE_URL=postgres://iot:pon-aqui-una-clave-larga@localhost:5432/iot
MQTT_URL=mqtt://localhost:1883
MQTT_ADMIN_USER=iot-backend
MQTT_ADMIN_PASS=otra-clave-larga-distinta
MQTT_PUBLIC_HOST=tu-dominio.com
MOSQUITTO_PASSWD_PATH=/etc/mosquitto/passwd
MOSQUITTO_ACL_PATH=/etc/mosquitto/acl
MOSQUITTO_RELOAD_CMD=sudo systemctl reload mosquitto
JWT_SECRET=genera-uno-con-openssl-rand-base64-48
PORT=4000
VITE_API_URL=https://tu-dominio.com
VITE_SOCKET_URL=https://tu-dominio.com
```

> `.env` tiene las claves del broker y de la base. Que no salga del VPS:
> `chmod 600 /srv/iot/.env`.

El backend necesita poder escribir `passwd`/`acl` y recargar Mosquitto:

```bash
sudo touch /etc/mosquitto/passwd /etc/mosquitto/acl
sudo chown $USER /etc/mosquitto/passwd /etc/mosquitto/acl
sudo chmod 600 /etc/mosquitto/passwd

# Permitir el reload sin contraseña, y solo ese comando
echo "$USER ALL=(root) NOPASSWD: /bin/systemctl reload mosquitto" | \
  sudo tee /etc/sudoers.d/mosquitto-reload
```

Esquema y datos de demo:

```bash
pnpm db:reset
```

## 5. Dominio, Nginx y certificado

Apunta un registro **A** de `tu-dominio.com` a la IP del VPS y espera a que propague.

El orden importa: **primero** se instala la configuración de Nginx del repositorio y
**luego** se pide el certificado, porque `certbot --nginx` edita ese archivo para añadirle el
bloque TLS. Al revés, el `cp` del paso 7 machacaba lo que escribió Certbot y el sitio se
quedaba sin HTTPS y sin el proxy de `/socket.io/`.

```bash
sudo cp /srv/iot/infra/nginx/roomba.conf /etc/nginx/sites-available/roomba
sudo sed -i 's/tu-dominio.com/TU-DOMINIO-REAL/g' /etc/nginx/sites-available/roomba
sudo ln -sf /etc/nginx/sites-available/roomba /etc/nginx/sites-enabled/roomba
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d tu-dominio.com
```

Comprueba que el WebSocket queda proxyado (y no servido como `index.html`):

```bash
curl -s "https://tu-dominio.com/socket.io/?EIO=4&transport=polling" | head -c 40
# 0{"sid":"...   ← bien
# <!doctype html ← falta el bloque location /socket.io/ en el Nginx instalado
```

## 6. Mosquitto

Copia la configuración del repositorio:

```bash
sudo cp /srv/iot/infra/mosquitto/roomba.conf /etc/mosquitto/conf.d/
sudo mkdir -p /etc/mosquitto/certs
sudo cp /srv/iot/infra/mosquitto/renovar-certs.sh /etc/letsencrypt/renewal-hooks/deploy/
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/renovar-certs.sh
sudo DOMINIO=tu-dominio.com /etc/letsencrypt/renewal-hooks/deploy/renovar-certs.sh
sudo systemctl restart mosquitto
```

Comprueba que los dos listeners están arriba:

```bash
sudo ss -tlnp | grep mosquitto
# 127.0.0.1:1883   ← solo local, para el backend
# 0.0.0.0:8883     ← TLS, para los robots
```

## 7. Frontend

```bash
cd /srv/iot && pnpm --filter @iot/web build
```

El Nginx ya quedó instalado en el paso 5; aquí solo se regenera `apps/web/dist`.

## 8. Backend con pm2

```bash
cd /srv/iot
pm2 start infra/ecosystem.config.cjs
pm2 save
pm2 startup systemd   # ejecuta el comando que imprima
```

## 9. Comprobar

```bash
curl -s https://tu-dominio.com/api/salud -H "Authorization: Bearer $TOKEN"
# {"ok":true,"postgres":true,"mosquitto":true,"bufferPersistencia":0,"clientesWebSocket":0}

pm2 logs iot-api --lines 50
sudo journalctl -u mosquitto -f
sudo tail -f /var/log/nginx/error.log
```

Un robot debería poder conectar a `tu-dominio.com:8883` con TLS y su usuario/contraseña.

## Actualizar

```bash
cd /srv/iot
git pull
pnpm install
pnpm --filter @iot/web build
pm2 reload iot-api        # reload, no restart: vacía el buffer antes de salir
```

El despliegue **no toca la base de datos**. Si `apps/api/db/schema.sql` cambió, hay que
aplicarlo a mano con `pnpm db:reset` (borra y regenera todo, incluidas las cuentas) y luego
`pnpm db:seed-admin`.

`pm2 reload` manda SIGINT, y el backend vacía el buffer de persistencia y las sesiones
abiertas antes de terminar. Un `kill -9` perdería hasta un segundo de lecturas.

## Copias de seguridad

```bash
# Diaria, a las 3:00
sudo crontab -e
0 3 * * * sudo -u postgres pg_dump iot | gzip > /var/backups/iot-$(date +\%F).sql.gz
```

Guarda también `/srv/iot/.env` y `/etc/mosquitto/passwd`: sin el `passwd`, todos los robots
tendrían que regenerar credenciales (en la base solo está el hash bcrypt, no el token).

## Memoria en un VPS pequeño

- **Un solo proceso de Node** (`instances: 1` en pm2). El cuello de botella de este backend
  es la E/S, no la CPU; con cluster se duplicaría la RAM sin ganar nada.
- `max_memory_restart: '400M'` en pm2: si una fuga lo hincha, se reinicia solo.
- Mosquitto con `max_queued_messages` bajo: un robot desconectado no debe acumular cola.
- `pnpm install --prod` en el VPS si quieres ahorrar espacio, pero entonces compila el
  frontend antes o en otra máquina.

## Problemas frecuentes

| Síntoma | Causa habitual |
|---|---|
| `[broker] no se pudo sincronizar Mosquitto` | Faltan permisos sobre `passwd`/`acl`, o la regla de sudoers para el reload |
| El robot conecta pero no publica | Su usuario no está en la ACL: da de baja y vuelve a dar de alta, o reinicia el backend (hace `syncBroker()` al arrancar) |
| El WebSocket no conecta desde el navegador | El Nginx instalado no tiene el `location /socket.io/` (o le faltan las cabeceras `Upgrade`/`Connection`). Compruébalo con el `curl` del paso 5 |
| `500` en cualquier cosa de robots, pero login y `/api/health` van bien | El esquema de la base está atrasado (p. ej. no existe la tabla `dispositivos`). Mira `\dt` en `psql` y aplica `pnpm db:reset` |
| Latencia alta y a saltos | El reloj del ESP32 no está sincronizado por NTP: `t` viene mal y la latencia medida es basura |
| `ECONNREFUSED` al arrancar la API | Postgres no está levantado o `DATABASE_URL` apunta a otro puerto |
