import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './security.js';

// Explicit paths support Alwaysdata commands running from a different cwd.
// Server environment takes priority over local files.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env.auth', import.meta.url)) });
let config;
try { config = loadConfig(process.env); }
catch (error) {
  console.error(error.message);
  process.exit(1);
}
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'educativo2026',
  waitForConnections: true,
  connectionLimit: 10,
});
const app = createApp({ db, config });
const server = app.listen(Number(process.env.PORT || 3001), process.env.IP || process.env.HOST || '0.0.0.0', () => {
  console.log('Explora y Aprende 2026: API iniciada con autenticación docente.');
});
async function shutdown() {
  server.close(async () => { await db.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
