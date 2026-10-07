// pm2 start infra/ecosystem.config.cjs
//
// Un solo proceso a propósito: el cuello de botella de este backend es la E/S (MQTT,
// Postgres, WebSocket), no la CPU. Con cluster se duplicaría la RAM sin ganar nada, y
// además habría que coordinar el estado de las sesiones, que vive en memoria.
module.exports = {
  apps: [
    {
      name: 'iot-api',
      cwd: '/srv/iot/apps/api',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // Si una fuga lo hincha, se reinicia solo antes de que el VPS empiece a usar swap.
      max_memory_restart: '400M',
      // SIGINT en vez de SIGKILL, y 10 s de margen: el backend vacía el buffer de
      // persistencia y cierra las sesiones abiertas antes de salir.
      kill_timeout: 10000,
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/iot/api-error.log',
      out_file: '/var/log/iot/api-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
