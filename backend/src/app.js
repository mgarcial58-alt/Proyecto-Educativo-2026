import express from 'express';
import cors from 'cors';
import { bearer, createSecurity, rateLimit, verifyPassword } from './security.js';

const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
const positiveId = value => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export function createApp({ db, config, now = Date.now }) {
  const app = express();
  const security = createSecurity(config, now);
  let passwordChecks = 0;
  app.disable('x-powered-by');
  app.disable('etag');
  app.set('trust proxy', config.trustProxy || false);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.get('origin') && !config.origins.includes(req.get('origin'))) return res.status(403).json({ error: 'Origen no permitido.' });
    next();
  });
  app.use(cors({ origin: config.origins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'], exposedHeaders: ['Retry-After'], maxAge: 600 }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Envía datos como application/json.' });
    next();
  });
  app.use(express.json({ limit: '8kb', strict: true }));
  const teacher = (req, res, next) => {
    const session = security.teacher(bearer(req));
    if (!session) return res.status(401).json({ error: 'Inicia sesión como docente.' });
    req.teacher = session;
    next();
  };
  const student = (req, res, next) => {
    const session = security.student(bearer(req));
    if (!session) return res.status(401).json({ error: 'El acceso del estudiante venció. Pide a tu docente que lo habilite o registra un nuevo perfil.' });
    req.student = session;
    next();
  };
  const loginGlobal = rateLimit({ limit: 30, windowMs: 15 * 60_000, now, key: () => 'global' });
  const loginIp = rateLimit({ limit: 5, windowMs: 15 * 60_000, now });
  app.post('/api/docentes/login', loginIp, loginGlobal, route(async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 256) return res.status(400).json({ error: 'Contraseña inválida.' });
    if (passwordChecks >= 2) {
      res.set('Retry-After', '3');
      return res.status(429).json({ error: 'El acceso está ocupado. Inténtalo en unos segundos.' });
    }
    passwordChecks += 1;
    let valid;
    try { valid = await verifyPassword(password, config.passwordHash); }
    finally { passwordChecks -= 1; }
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta.' });
    const session = security.issueTeacher();
    if (!session) return res.status(503).json({ error: 'No se pudo abrir la sesión. Inténtalo más tarde.' });
    res.json(session);
  }));
  app.get('/api/docentes/sesion', teacher, (req, res) => res.json(req.teacher));
  app.post('/api/docentes/logout', teacher, (req, res) => {
    security.revokeTeacher(bearer(req));
    res.status(204).end();
  });
  app.get('/api/salud', route(async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  }));
  app.get('/api/actividades', route(async (_req, res) => {
    const [rows] = await db.query('SELECT id, codigo, titulo, nivel FROM actividades ORDER BY id');
    res.json(rows);
  }));
  app.get(['/api/estudiantes', '/api/docentes/estudiantes'], teacher, route(async (_req, res) => {
    const [rows] = await db.query('SELECT id, nombre, edad FROM estudiantes ORDER BY nombre');
    res.json(rows);
  }));
  app.post('/api/estudiantes', rateLimit({ limit: 60, windowMs: 15 * 60_000, now }), route(async (req, res) => {
    const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
    const edad = req.body?.edad;
    if (!nombre || nombre.length > 100 || !Number.isInteger(edad) || edad < 3 || edad > 18) return res.status(400).json({ error: 'Nombre o edad inválidos.' });
    const [result] = await db.execute('INSERT INTO estudiantes(nombre, edad) VALUES (?, ?)', [nombre, edad]);
    res.status(201).json({ id: result.insertId, nombre, edad, ...security.issueStudent(result.insertId) });
  }));
  app.get('/api/mi-estudiante', student, route(async (req, res) => {
    const [rows] = await db.execute('SELECT id, nombre, edad FROM estudiantes WHERE id=?', [req.student.id]);
    if (!rows.length) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    res.json(rows[0]);
  }));
  app.post('/api/docentes/estudiantes/:id/acceso', teacher, route(async (req, res) => {
    if (!positiveId(req.params.id)) return res.status(400).json({ error: 'Estudiante inválido.' });
    const [rows] = await db.execute('SELECT id, nombre, edad FROM estudiantes WHERE id=?', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    res.json({ ...rows[0], ...security.issueStudent(rows[0].id) });
  }));
  app.post('/api/progresos', student, rateLimit({ limit: 120, windowMs: 15 * 60_000, now, key: req => req.student.id }), route(async (req, res) => {
    const { estudiante_id, actividad_id, puntaje, total } = req.body || {};
    const values = [estudiante_id, actividad_id, puntaje, total];
    if (values.some(value => !Number.isSafeInteger(value)) || estudiante_id < 1 || actividad_id < 1 || puntaje < 0 || total < 1 || puntaje > total) return res.status(400).json({ error: 'Puntuación inválida.' });
    if (estudiante_id !== req.student.id) return res.status(403).json({ error: 'Solo puedes guardar el progreso de tu perfil.' });
    const [activities] = await db.execute('SELECT codigo FROM actividades WHERE id=?', [actividad_id]);
    if (!activities.length) return res.status(400).json({ error: 'Actividad inválida.' });
    if (total !== (activities[0].codigo === 'memoria' ? 4 : 5)) return res.status(400).json({ error: 'Total inválido para esta actividad.' });
    const [result] = await db.execute('INSERT INTO progresos (estudiante_id, actividad_id, puntaje, total) VALUES (?, ?, ?, ?)', values);
    res.status(201).json({ id: result.insertId });
  }));
  async function progressRows(id) {
    const [rows] = await db.execute(`SELECT p.id, e.nombre AS estudiante, a.titulo AS actividad,
      p.puntaje, p.total, p.fecha, p.estudiante_id FROM progresos p
      JOIN estudiantes e ON e.id = p.estudiante_id
      JOIN actividades a ON a.id = p.actividad_id` + (id ? ' WHERE p.estudiante_id=?' : '') + ' ORDER BY p.fecha DESC, p.id DESC', id ? [id] : []);
    return rows;
  }
  app.get(['/api/progresos', '/api/docentes/progresos'], teacher, route(async (req, res) => {
    const id = req.query.estudiante_id;
    if (id !== undefined && !positiveId(id)) return res.status(400).json({ error: 'Estudiante inválido.' });
    res.json(await progressRows(id ? Number(id) : undefined));
  }));
  app.get('/api/mis-progresos', student, route(async (req, res) => {
    if (req.query.estudiante_id !== undefined && req.query.estudiante_id !== String(req.student.id)) return res.status(403).json({ error: 'Solo puedes consultar tu progreso.' });
    res.json(await progressRows(req.student.id));
  }));
  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use((error, _req, res, _next) => {
    // Never log SQL, request bodies, authorization headers or credentials.
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Solicitud demasiado grande.' });
    if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(400).json({ error: 'Estudiante o actividad inexistente.' });
    console.error('No se pudo completar una solicitud. Revisa la disponibilidad de MySQL.');
    res.status(500).json({ error: 'Error interno del servidor.' });
  });
  return app;
}
