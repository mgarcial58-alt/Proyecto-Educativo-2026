import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createSecurity, hashPassword, loadConfig, validPasswordHash, verifyPassword } from '../src/security.js';
import { createFakeDb } from '../test-support/fake-db.js';

// Ephemeral fixtures: these are not the user's password or server credentials.
const testPassword = 'TEST-ONLY-una-frase-segura-2026';
const passwordHash = await hashPassword(testPassword);
const baseEnv = {
  DOCENTE_PASSWORD_HASH: passwordHash,
  STUDENT_TOKEN_SECRET: randomBytes(32).toString('hex'),
  CORS_ORIGIN: 'http://localhost:5173,https://proyecto-educativo-2026.vercel.app',
};

async function fixture(t, overrides = {}) {
  let clock = 1_790_000_000_000;
  const config = { ...loadConfig(baseEnv), ...overrides };
  const db = createFakeDb();
  const app = createApp({ db, config, now: () => clock });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
    const response = await fetch(url + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, data: text ? JSON.parse(text) : null };
  }
  async function login() {
    const response = await request('/api/docentes/login', { method: 'POST', body: { password: testPassword } });
    assert.equal(response.status, 200);
    return response.data;
  }
  async function register(nombre = 'Alumno de prueba', edad = 8) {
    const response = await request('/api/estudiantes', { method: 'POST', body: { nombre, edad } });
    assert.equal(response.status, 201);
    return response.data;
  }
  return { db, config, request, login, register, advance: milliseconds => { clock += milliseconds; }, url };
}

test('hash con sal aleatoria; verifica sin aceptar otra contraseña ni formatos débiles', async () => {
  assert.ok(validPasswordHash(passwordHash));
  assert.equal(await verifyPassword(testPassword, passwordHash), true);
  assert.equal(await verifyPassword('contraseña incorrecta', passwordHash), false);
  assert.equal(await verifyPassword(testPassword, 'texto-sin-hash'), false);
  assert.equal(await verifyPassword('x'.repeat(257), passwordHash), false);
  await assert.rejects(hashPassword('corta'));
  await assert.rejects(hashPassword('x'.repeat(257)));
  assert.notEqual(await hashPassword(testPassword), passwordHash);
});

test('configuración falla cerrada si faltan secretos, CORS exacto o límites válidos', () => {
  assert.throws(() => loadConfig({}));
  for (const change of [
    { DOCENTE_PASSWORD_HASH: 'contraseña-en-texto' }, { STUDENT_TOKEN_SECRET: 'corto' },
    { CORS_ORIGIN: '*' }, { CORS_ORIGIN: 'https://ejemplo.com/ruta' },
    { CORS_ORIGIN: 'null' }, { NODE_ENV: 'production', CORS_ORIGIN: '' },
    { NODE_ENV: 'production', CORS_ORIGIN: 'http://ejemplo.com' },
    { DOCENTE_SESSION_MINUTES: '0' }, { DOCENTE_SESSION_MINUTES: '121' },
    { ESTUDIANTE_SESSION_DAYS: '31' }, { TRUST_PROXY: 'true' },
  ]) assert.throws(() => loadConfig({ ...baseEnv, ...change }));
  assert.equal(loadConfig({ ...baseEnv, NODE_ENV: 'production', CORS_ORIGIN: 'https://ejemplo.com' }).production, true);
});

test('anónimo no accede a listados antiguos, listados docentes ni acceso individual', async t => {
  const f = await fixture(t);
  for (const path of ['/api/estudiantes', '/api/progresos', '/api/progresos?estudiante_id=1', '/api/docentes/estudiantes', '/api/docentes/progresos', '/api/docentes/sesion', '/api/mi-estudiante', '/api/mis-progresos']) {
    assert.equal((await f.request(path)).status, 401, path);
  }
  assert.equal((await f.request('/api/docentes/estudiantes/1/acceso', { method: 'POST', body: {} })).status, 401);
  assert.equal((await f.request('/api/progresos', { method: 'POST', body: { estudiante_id: 1, actividad_id: 1, puntaje: 5, total: 5 } })).status, 401);
  assert.equal(f.db.calls.length, 0, 'No consulta datos antes de autenticar');
});

test('login correcto, contraseña incorrecta, cierre y reutilización rechazada', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/docentes/login', { method: 'POST', body: { password: 'contraseña incorrecta' } })).status, 401);
  const session = await f.login();
  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.request('/api/docentes/sesion', { token: session.token })).status, 200);
  for (const path of ['/api/estudiantes', '/api/progresos', '/api/docentes/estudiantes', '/api/docentes/progresos']) {
    assert.equal((await f.request(path, { token: session.token })).status, 200);
  }
  assert.equal((await f.request('/api/docentes/logout', { method: 'POST', token: session.token, body: {} })).status, 204);
  assert.equal((await f.request('/api/docentes/sesion', { token: session.token })).status, 401);
  assert.equal((await f.request('/api/estudiantes', { token: session.token })).status, 401);
});

test('sesión docente vence exactamente en el límite y no sobrevive a reinicio', async t => {
  const f = await fixture(t);
  const session = await f.login();
  f.advance(f.config.teacherTtlMs - 1);
  assert.equal((await f.request('/api/docentes/sesion', { token: session.token })).status, 200);
  f.advance(1);
  assert.equal((await f.request('/api/docentes/sesion', { token: session.token })).status, 401);
  const restarted = await fixture(t);
  assert.equal((await restarted.request('/api/docentes/sesion', { token: session.token })).status, 401);
});

test('límite por IP cuenta intentos y no se evade con X-Forwarded-For no confiable', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.request('/api/docentes/login', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } })).status, 400);
  }
  const blocked = await f.request('/api/docentes/login', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': '198.51.100.99' } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  f.advance(15 * 60_000);
  assert.equal((await f.request('/api/docentes/login', { method: 'POST', body: {} })).status, 400);
});

test('límite global bloquea intentos distribuidos entre IP distintas', async t => {
  // Simulates a single trusted reverse proxy; production must verify that topology.
  const f = await fixture(t, { trustProxy: 1 });
  for (let i = 0; i < 30; i++) {
    assert.equal((await f.request('/api/docentes/login', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': `198.51.100.${i + 1}` } })).status, 400);
  }
  assert.equal((await f.request('/api/docentes/login', { method: 'POST', body: {}, headers: { 'X-Forwarded-For': '198.51.100.100' } })).status, 429);
});

test('CORS admite origen exacto y preflight Authorization; rechaza desconocidos', async t => {
  const f = await fixture(t);
  const allowed = await f.request('/api/actividades', { headers: { Origin: 'https://proyecto-educativo-2026.vercel.app' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://proyecto-educativo-2026.vercel.app');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null);
  const preflight = await f.request('/api/docentes/login', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  for (const origin of ['https://intruso.example', 'https://proyecto-educativo-2026.vercel.app.intruso.example', 'null']) {
    const denied = await f.request('/api/docentes/login', { method: 'POST', body: { password: testPassword }, headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
});

test('registro público de dos alumnos y guardado de los seis juegos sin sesión docente', async t => {
  const f = await fixture(t);
  const [a, b] = [await f.register('Ana', 7), await f.register('Beto', 9)];
  const catalog = await f.request('/api/actividades');
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.data.map(row => row.codigo), ['espacial', 'figuras', 'memoria', 'tablas', 'fracciones', 'decimales']);
  for (const activity of catalog.data) {
    const total = activity.codigo === 'memoria' ? 4 : 5;
    const response = await f.request('/api/progresos', { method: 'POST', token: a.token, body: { estudiante_id: a.id, actividad_id: activity.id, puntaje: total, total } });
    assert.equal(response.status, 201, activity.codigo);
  }
  assert.equal((await f.request('/api/progresos', { method: 'POST', token: b.token, body: { estudiante_id: b.id, actividad_id: 1, puntaje: 3, total: 5 } })).status, 201);
  const own = await f.request('/api/mis-progresos', { token: a.token });
  assert.equal(own.data.length, 6);
  assert.ok(own.data.every(row => row.estudiante_id === a.id));
  const second = await f.request('/api/mis-progresos', { token: b.token });
  assert.equal(second.data.length, 1);
  assert.equal(second.data[0].estudiante_id, b.id);
  assert.deepEqual((await f.request('/api/mi-estudiante', { token: a.token })).data, { id: a.id, nombre: 'Ana', edad: 7 });
  const teacher = await f.login();
  assert.equal((await f.request('/api/docentes/progresos', { token: teacher.token })).data.length, 7);
  assert.equal((await f.request(`/api/progresos?estudiante_id=${b.id}`, { token: teacher.token })).data.length, 1);
});

test('un alumno no consulta ni altera a otro; roles y token alterado rechazados', async t => {
  const f = await fixture(t);
  const a = await f.register('Ana');
  const b = await f.register('Beto');
  const teacher = await f.login();
  assert.equal((await f.request('/api/progresos', { method: 'POST', token: a.token, body: { estudiante_id: b.id, actividad_id: 1, puntaje: 5, total: 5 } })).status, 403);
  assert.equal((await f.request(`/api/mis-progresos?estudiante_id=${b.id}`, { token: a.token })).status, 403);
  assert.equal((await f.request('/api/docentes/progresos', { token: a.token })).status, 401);
  assert.equal((await f.request('/api/estudiantes', { token: a.token })).status, 401);
  assert.equal((await f.request('/api/mis-progresos', { token: teacher.token })).status, 401);
  const [payload, signature] = a.token.split('.');
  const modified = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: b.id })).toString('base64url');
  assert.equal((await f.request('/api/mi-estudiante', { token: `${modified}.${signature}` })).status, 401);
  assert.equal((await f.request('/api/mi-estudiante', { token: `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}` })).status, 401);
  assert.equal(f.db.progresses.length, 0);
});

test('credencial estudiante vence, persiste al reiniciar y no admite rol ni expiración manipulados', async t => {
  const f = await fixture(t);
  const student = await f.register();
  const now = 1_790_000_000_000;
  const restarted = createSecurity(f.config, () => now);
  assert.equal(restarted.student(student.token).id, student.id);
  const signed = fields => {
    const payload = Buffer.from(JSON.stringify(fields)).toString('base64url');
    return `${payload}.${createHmac('sha256', Buffer.from(f.config.studentSecret, 'hex')).update(payload).digest('base64url')}`;
  };
  assert.equal(restarted.student(signed({ role: 'docente', sub: student.id, exp: now + 1000 })), null);
  assert.equal(restarted.student(signed({ role: 'estudiante', sub: student.id, exp: now + f.config.studentTtlMs + 1 })), null);
  assert.equal(restarted.student(signed({ role: 'estudiante', sub: -1, exp: now + 1000 })), null);
  f.advance(f.config.studentTtlMs - 1);
  assert.equal((await f.request('/api/mi-estudiante', { token: student.token })).status, 200);
  f.advance(1);
  assert.equal((await f.request('/api/mi-estudiante', { token: student.token })).status, 401);
});

test('docente habilita perfil existente conservando id, alumno no puede hacerlo', async t => {
  const f = await fixture(t);
  f.db.students.push({ id: 1, nombre: 'Perfil anterior', edad: 10 });
  const teacher = await f.login();
  const response = await f.request('/api/docentes/estudiantes/1/acceso', { method: 'POST', token: teacher.token, body: {} });
  assert.equal(response.status, 200);
  assert.equal(response.data.id, 1);
  assert.equal((await f.request('/api/mi-estudiante', { token: response.data.token })).data.nombre, 'Perfil anterior');
  assert.equal((await f.request('/api/docentes/estudiantes/1/acceso', { method: 'POST', token: response.data.token, body: {} })).status, 401);
  assert.equal((await f.request('/api/docentes/estudiantes/999/acceso', { method: 'POST', token: teacher.token, body: {} })).status, 404);
  assert.equal((await f.request('/api/docentes/estudiantes/1x/acceso', { method: 'POST', token: teacher.token, body: {} })).status, 400);
});

test('valida registro, puntuaciones, filtros, tipo y tamaño del cuerpo sin escrituras inválidas', async t => {
  const f = await fixture(t);
  for (const body of [{ nombre: '', edad: 8 }, { nombre: 'Ana', edad: '8' }, { nombre: {}, edad: 8 }, { nombre: 'Ana', edad: 2 }, { nombre: 'Ana', edad: 19 }]) {
    assert.equal((await f.request('/api/estudiantes', { method: 'POST', body })).status, 400);
  }
  const student = await f.register();
  const normal = { estudiante_id: student.id, actividad_id: 1, puntaje: 3, total: 5 };
  for (const changes of [{ puntaje: -1 }, { puntaje: 6 }, { puntaje: '3' }, { total: 4 }, { actividad_id: 999 }, { actividad_id: 3, total: 5 }]) {
    assert.equal((await f.request('/api/progresos', { method: 'POST', token: student.token, body: { ...normal, ...changes } })).status, 400);
  }
  const teacher = await f.login();
  for (const query of ['estudiante_id=abc', 'estudiante_id=0', 'estudiante_id=', 'estudiante_id=1&estudiante_id=2']) {
    assert.equal((await f.request(`/api/progresos?${query}`, { token: teacher.token })).status, 400);
  }
  const wrongType = await fetch(f.url + '/api/estudiantes', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
  const badJson = await fetch(f.url + '/api/estudiantes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(badJson.status, 400);
  assert.equal((await f.request('/api/estudiantes', { method: 'POST', body: { nombre: 'x'.repeat(9000), edad: 8 } })).status, 413);
  assert.equal(f.db.students.length, 1);
  assert.equal(f.db.progresses.length, 0);
});

test('datos privados y errores llevan no-store, no divulgan implementación ni detalles de DB', async t => {
  const f = await fixture(t, { production: true });
  const response = await f.request('/api/docentes/estudiantes');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('etag'), null);
  assert.equal((await f.request('/ruta-inexistente')).status, 404);
  f.db.query = async () => { throw new Error('fixture-internal-db-detail-not-for-clients'); };
  const failure = await f.request('/api/salud');
  assert.equal(failure.status, 500);
  assert.deepEqual(failure.data, { error: 'Error interno del servidor.' });
});
