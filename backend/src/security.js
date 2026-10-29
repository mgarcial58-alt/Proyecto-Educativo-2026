import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HASH_PATTERN = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/;
const digest = value => createHash('sha256').update(value).digest('hex');

export function validPasswordHash(value) {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || Buffer.byteLength(password) > 256) {
    throw new Error('Usa al menos 12 caracteres y como máximo 256 bytes.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, Buffer.from(salt, 'hex'), 64, SCRYPT);
  return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const match = typeof encoded === 'string' && encoded.match(HASH_PATTERN);
  if (!match || typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 256) return false;
  const key = await derive(password, Buffer.from(match[1], 'hex'), 64, SCRYPT);
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}

function integerSetting(env, name, fallback, min, max) {
  const value = Number(env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Configuración inválida: ${name}`);
  return value;
}

export function loadConfig(env) {
  if (!validPasswordHash(env.DOCENTE_PASSWORD_HASH)) throw new Error('Configura DOCENTE_PASSWORD_HASH con npm run configurar-docente.');
  if (!/^[a-f0-9]{64}$/.test(env.STUDENT_TOKEN_SECRET || '')) throw new Error('Configura STUDENT_TOKEN_SECRET con npm run configurar-docente.');
  const production = env.NODE_ENV === 'production';
  const origins = (env.CORS_ORIGIN || (production ? '' : 'http://localhost:5173')).split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => {
    try {
      const parsed = new URL(origin);
      return parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol) ||
        (production && parsed.protocol !== 'https:');
    } catch { return true; }
  })) throw new Error('CORS_ORIGIN debe contener orígenes exactos separados por comas; HTTPS en producción.');
  const trustProxy = integerSetting(env, 'TRUST_PROXY', '0', 0, 5);
  return {
    passwordHash: env.DOCENTE_PASSWORD_HASH,
    studentSecret: env.STUDENT_TOKEN_SECRET,
    teacherTtlMs: integerSetting(env, 'DOCENTE_SESSION_MINUTES', '60', 5, 120) * 60_000,
    studentTtlMs: integerSetting(env, 'ESTUDIANTE_SESSION_DAYS', '7', 1, 30) * 86_400_000,
    origins, trustProxy, production,
  };
}

export function bearer(req) {
  const header = req.get('authorization') || '';
  return /^Bearer [A-Za-z0-9_.-]{1,1024}$/.test(header) ? header.slice(7) : '';
}

export function createSecurity(config, now = Date.now) {
  // One Node process. Restarts intentionally invalidate all teacher sessions.
  const sessions = new Map();
  function pruneSessions() {
    for (const [key, session] of sessions) if (session.expiresAt <= now()) sessions.delete(key);
  }
  return {
    issueTeacher() {
      pruneSessions();
      if (sessions.size >= 1000) return null;
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now() + config.teacherTtlMs;
      sessions.set(digest(token), { expiresAt });
      return { token, expiresAt };
    },
    teacher(token) {
      pruneSessions();
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? sessions.get(digest(token)) : undefined;
    },
    revokeTeacher(token) { sessions.delete(digest(token)); },
    issueStudent(id) {
      const expiresAt = now() + config.studentTtlMs;
      const payload = Buffer.from(JSON.stringify({ role: 'estudiante', sub: id, exp: expiresAt, nonce: randomBytes(16).toString('hex') })).toString('base64url');
      const signature = createHmac('sha256', Buffer.from(config.studentSecret, 'hex')).update(payload).digest('base64url');
      return { token: `${payload}.${signature}`, expiresAt };
    },
    student(token) {
      if (!/^[A-Za-z0-9_-]{1,800}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const [payload, signature] = token.split('.');
      const expected = createHmac('sha256', Buffer.from(config.studentSecret, 'hex')).update(payload).digest('base64url');
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (decoded.role !== 'estudiante' || !Number.isSafeInteger(decoded.sub) || decoded.sub < 1 ||
            !Number.isSafeInteger(decoded.exp) || decoded.exp <= now() || decoded.exp > now() + config.studentTtlMs) return null;
        return { id: decoded.sub, expiresAt: decoded.exp };
      } catch { return null; }
    },
  };
}

// Bounded, fixed-window, in-process limiter. Never trust forwarded headers directly.
export function rateLimit({ limit, windowMs, now = Date.now, key = req => req.ip, maxKeys = 10_000 }) {
  const buckets = new Map();
  return (req, res, next) => {
    const time = now();
    for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
    const id = key(req);
    let bucket = buckets.get(id);
    if (!bucket) {
      if (buckets.size >= maxKeys) {
        res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtalo más tarde.' });
      }
      bucket = { count: 0, until: time + windowMs };
      buckets.set(id, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
      return res.status(429).json({ error: 'Demasiados intentos. Espera antes de volver a intentar.' });
    }
    next();
  };
}
