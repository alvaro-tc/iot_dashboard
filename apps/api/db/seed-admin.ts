// pnpm db:seed-admin — crea (o resetea la contraseña de) el admin admin@admin.com sin tocar el resto de datos.
import bcrypt from 'bcrypt';
import { pool } from '../src/db.ts';

const EMAIL = 'admin@admin.com';
const PASSWORD = 'admin1234';

await pool.query(
  `INSERT INTO usuarios (correo, contrasena, nombre, rol)
   VALUES ($1, $2, 'Administración', 'admin')
   ON CONFLICT (correo) DO UPDATE SET contrasena = $2, rol = 'admin', activo = true`,
  [EMAIL, await bcrypt.hash(PASSWORD, 10)],
);
console.log(`db: admin listo (${EMAIL} / ${PASSWORD})`);
await pool.end();
