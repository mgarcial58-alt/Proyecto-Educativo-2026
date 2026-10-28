import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';

// ==========================================
// CONFIGURACIÓN DEL SERVIDOR
// ==========================================

const app = express();

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.IP || '0.0.0.0';

// ==========================================
// CONFIGURACIÓN DE CORS
// ==========================================

const allowedOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:5173'
)
  .split(',')
  .map(origin => origin.trim());

app.use(
  cors({
    origin: allowedOrigins
  })
);

app.use(express.json());

// ==========================================
// CONEXIÓN A BASE DE DATOS MYSQL
// ==========================================

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'educativo2026',
  waitForConnections: true,
  connectionLimit: 10
});

// ==========================================
// MANEJO GENERAL DE ERRORES
// ==========================================

const route = fn => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(error => {
      console.error('Error del servidor:', error);

      res.status(500).json({
        error: 'Error interno del servidor'
      });
    });

// ==========================================
// VERIFICAR ESTADO DE LA API
// ==========================================

app.get('/api/salud', route(async (req, res) => {

  await db.query('SELECT 1');

  res.json({
    ok: true
  });

}));

// ==========================================
// OBTENER ACTIVIDADES
// ==========================================

app.get('/api/actividades', route(async (req, res) => {

  const [rows] = await db.query(
    'SELECT * FROM actividades ORDER BY id'
  );

  res.json(rows);

}));

// ==========================================
// OBTENER ESTUDIANTES
// ==========================================

app.get('/api/estudiantes', route(async (req, res) => {

  const [rows] = await db.query(
    'SELECT * FROM estudiantes ORDER BY nombre'
  );

  res.json(rows);

}));

// ==========================================
// REGISTRAR ESTUDIANTES
// ==========================================

app.post('/api/estudiantes', route(async (req, res) => {

  const nombre = String(req.body.nombre || '').trim();
  const edad = Number(req.body.edad);

  if (
    !nombre ||
    nombre.length > 100 ||
    !Number.isInteger(edad) ||
    edad < 3 ||
    edad > 18
  ) {
    return res.status(400).json({
      error: 'Nombre o edad inválidos'
    });
  }

  const [result] = await db.execute(
    'INSERT INTO estudiantes(nombre, edad) VALUES (?, ?)',
    [nombre, edad]
  );

  res.status(201).json({
    id: result.insertId,
    nombre,
    edad
  });

}));

// ==========================================
// GUARDAR PROGRESO DE ACTIVIDADES
// ==========================================

app.post('/api/progresos', route(async (req, res) => {

  const {
    estudiante_id,
    actividad_id,
    puntaje,
    total
  } = req.body;

  const nums = [
    estudiante_id,
    actividad_id,
    puntaje,
    total
  ].map(Number);

  if (
    nums.some(n => !Number.isInteger(n)) ||
    nums[0] < 1 ||
    nums[1] < 1 ||
    nums[2] < 0 ||
    nums[3] < 1 ||
    nums[2] > nums[3]
  ) {
    return res.status(400).json({
      error: 'Puntuación inválida'
    });
  }

  const [result] = await db.execute(
    `INSERT INTO progresos
    (estudiante_id, actividad_id, puntaje, total)
    VALUES (?, ?, ?, ?)`,
    nums
  );

  res.status(201).json({
    id: result.insertId
  });

}));

// ==========================================
// CONSULTAR PROGRESOS
// ==========================================

app.get('/api/progresos', route(async (req, res) => {

  const id = Number(req.query.estudiante_id);

  if (
    req.query.estudiante_id &&
    (!Number.isInteger(id) || id < 1)
  ) {
    return res.status(400).json({
      error: 'Estudiante inválido'
    });
  }

  const sql = `
    SELECT
      p.id,
      e.nombre AS estudiante,
      a.titulo AS actividad,
      p.puntaje,
      p.total,
      p.fecha,
      p.estudiante_id
    FROM progresos p
    JOIN estudiantes e
      ON e.id = p.estudiante_id
    JOIN actividades a
      ON a.id = p.actividad_id
  `;

  const [rows] = await db.execute(
    sql +
      (id ? ' WHERE p.estudiante_id=?' : '') +
      ' ORDER BY p.fecha DESC, p.id DESC',
    id ? [id] : []
  );

  res.json(rows);

}));

// ==========================================
// INICIAR SERVIDOR
// COMPATIBLE CON LOCALHOST Y ALWAYSDATA
// ==========================================

app.listen(PORT, HOST, () => {

  console.log('====================================');
  console.log(' EXPLORA Y APRENDE 2026');
  console.log('====================================');
  console.log(`Servidor iniciado correctamente`);
  console.log(`Puerto: ${PORT}`);
  console.log(`Host: ${HOST}`);
  console.log('API lista para recibir solicitudes');
  console.log('====================================');

});