import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { emitKeypressEvents } from 'node:readline';
import dotenv from 'dotenv';
import { hashPassword } from '../src/security.js';

const target = fileURLToPath(new URL('../.env.auth', import.meta.url));

function hiddenInput(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Ejecuta este comando directamente en una terminal interactiva.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelado; no se guardaron cambios.')); return; }
      if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); return; }
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\u0000-\u001f\u007f]/.test(text)) value += text;
    }
    process.stdin.on('keypress', onKey);
  });
}

try {
  emitKeypressEvents(process.stdin);
  let previous = {};
  let exists = false;
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('El archivo .env.auth debe ser un archivo regular.');
    previous = dotenv.parse(await readFile(target));
    exists = true;
    if (!/^[a-f0-9]{64}$/.test(previous.STUDENT_TOKEN_SECRET || '')) throw new Error('El secreto estudiantil existente no es válido. Revisa .env.auth de forma privada antes de continuar.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Configurar acceso docente. La contraseña no se muestra ni se guarda como texto.');
  console.log('Usa una frase única de al menos 12 caracteres. No la envíes por chat.');
  let password = await hiddenInput('Nueva contraseña: ');
  let confirmation = await hiddenInput('Repite la contraseña: ');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden. No se guardaron cambios.');
  const encoded = await hashPassword(password);
  password = confirmation = '';
  const secret = previous.STUDENT_TOKEN_SECRET || randomBytes(32).toString('hex');
  const content = `# PRIVADO: no compartir, no subir a GitHub.\nDOCENTE_PASSWORD_HASH='${encoded}'\nSTUDENT_TOKEN_SECRET='${secret}'\n`;
  await writeFile(target, content, { encoding: 'utf8', mode: 0o600, flag: exists ? 'w' : 'wx' });
  if (process.platform !== 'win32') await chmod(target, 0o600);
  console.log('Listo: backend/.env.auth contiene el hash y el secreto. No se imprimieron.');
  console.log('Reinicia el backend. En Alwaysdata configura ambos valores en Ambiente de forma privada.');
  console.log('Si estas variables ya existen en .env o en el entorno del servidor, tienen prioridad: actualízalas allí.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
