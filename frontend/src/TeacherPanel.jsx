import { useEffect, useRef, useState } from 'react';
import { request } from './api';

export default function TeacherPanel({ onBack, onStudentAccess }) {
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState('');
  const [students, setStudents] = useState([]);
  const [reports, setReports] = useState([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const mounted = useRef(false);
  const currentSession = useRef(null);
  const operation = useRef(0);
  const requestBusy = useRef(false);

  function clearSession(message = '') {
    operation.current += 1;
    currentSession.current = null;
    setSession(null);
    setStudents([]);
    setReports([]);
    setFilter('');
    setPassword('');
    setLoading(false);
    setError(message);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
      const previous = currentSession.current;
      currentSession.current = null;
      if (previous) request('/api/docentes/logout', { method: 'POST', token: previous.token }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      const previous = currentSession.current;
      clearSession('Tu sesión venció. Ingresa nuevamente para consultar los resultados.');
      if (previous) request('/api/docentes/logout', { method: 'POST', token: previous.token }).catch(() => {});
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= retryUntil) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryUntil]);

  useEffect(() => {
    if (!session) return;
    async function verifySession() {
      if (document.visibilityState === 'hidden') return;
      const activeSession = currentSession.current;
      if (!activeSession) return;
      if (activeSession.expiresAt <= Date.now()) {
        clearSession('Tu sesión venció. Ingresa nuevamente.');
        return;
      }
      try {
        await request('/api/docentes/sesion', { token: activeSession.token });
      } catch (failure) {
        if (mounted.current && currentSession.current === activeSession && failure.status === 401) {
          clearSession('Tu sesión ya no es válida. Ingresa nuevamente.');
        }
      }
    }
    window.addEventListener('focus', verifySession);
    document.addEventListener('visibilitychange', verifySession);
    return () => {
      window.removeEventListener('focus', verifySession);
      document.removeEventListener('visibilitychange', verifySession);
    };
  }, [session]);

  async function loadReports(activeSession = currentSession.current) {
    if (!activeSession) return;
    const id = ++operation.current;
    setLoading(true);
    setError('');
    try {
      const [newStudents, newReports] = await Promise.all([
        request('/api/docentes/estudiantes', { token: activeSession.token }),
        request('/api/docentes/progresos', { token: activeSession.token }),
      ]);
      if (!mounted.current || id !== operation.current || currentSession.current !== activeSession) return;
      setStudents(newStudents);
      setReports(newReports);
    } catch (failure) {
      if (!mounted.current || id !== operation.current || currentSession.current !== activeSession) return;
      if (failure.status === 401) clearSession('Tu sesión ya no es válida. Ingresa nuevamente.');
      else setError(failure.message);
    } finally {
      if (mounted.current && id === operation.current) setLoading(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    if (requestBusy.current || retryUntil > Date.now()) return;
    requestBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const nextSession = await request('/api/docentes/login', {
        method: 'POST', body: JSON.stringify({ password }),
      });
      setPassword('');
      if (!mounted.current) {
        await request('/api/docentes/logout', { method: 'POST', token: nextSession.token }).catch(() => {});
        return;
      }
      currentSession.current = nextSession;
      setSession(nextSession);
      setRetryUntil(0);
      await loadReports(nextSession);
    } catch (failure) {
      if (!mounted.current) return;
      setPassword('');
      if (failure.status === 429) {
        setClock(Date.now());
        setRetryUntil(Date.now() + Math.max(1, failure.retryAfter || 60) * 1000);
      }
      setError(failure.message);
    } finally {
      requestBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function logout() {
    const previous = currentSession.current;
    clearSession();
    if (!previous) return;
    setBusy(true);
    try {
      await request('/api/docentes/logout', { method: 'POST', token: previous.token });
    } catch (failure) {
      if (mounted.current && failure.status !== 401) {
        setError('Se borró la sesión de este navegador. No se pudo confirmar el cierre en el servidor; el acceso caducará automáticamente.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function enableStudent() {
    const activeSession = currentSession.current;
    if (!filter || !activeSession || requestBusy.current) return;
    requestBusy.current = true;
    setBusy(true);
    setError('');
    try {
      const profile = await request(`/api/docentes/estudiantes/${filter}/acceso`, {
        method: 'POST', token: activeSession.token,
      });
      if (!mounted.current || currentSession.current !== activeSession) return;
      // No entregar el dispositivo al alumno mientras exista una sesión docente activa.
      await request('/api/docentes/logout', { method: 'POST', token: activeSession.token });
      if (!mounted.current || currentSession.current !== activeSession) return;
      clearSession();
      onStudentAccess(profile);
    } catch (failure) {
      if (!mounted.current || currentSession.current !== activeSession) return;
      if (failure.status === 401) clearSession('Tu sesión venció. Ingresa nuevamente.');
      else setError('No se pudo habilitar el acceso y cerrar la sesión docente. Inténtalo de nuevo.');
    } finally {
      requestBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const waitSeconds = Math.max(0, Math.ceil((retryUntil - clock) / 1000));
  const visibleReports = reports.filter(row => !filter || String(row.estudiante_id) === filter);

  if (!session) return <section className="panel small teacher-login">
    <button className="back" onClick={onBack}>← Volver</button>
    <h1>👩‍🏫 Acceso docente</h1>
    <p>Ingresa la contraseña docente para consultar estudiantes y resultados.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    <form onSubmit={login}>
      <label>Contraseña docente
        <input type="password" name="password" autoComplete="current-password" required
          maxLength={256} value={password} onChange={event => setPassword(event.target.value)}
          disabled={busy} autoFocus />
      </label>
      <button className="primary" disabled={busy || waitSeconds > 0}>
        {busy ? 'Comprobando…' : waitSeconds > 0 ? `Intenta de nuevo en ${waitSeconds} s` : 'Iniciar sesión'}
      </button>
    </form>
    <p className="help-text">Los estudiantes pueden jugar sin esta contraseña. La sesión docente se cierra al salir del panel o recargar la página.</p>
  </section>;

  return <section className="teacher-panel">
    <div className="teacher-heading">
      <div><h1>📊 Panel de docentes</h1><p>Resultados guardados de tus estudiantes.</p></div>
      <button className="back" disabled={busy} onClick={logout}>Cerrar sesión</button>
    </div>
    <p className="session-note">Sesión hasta las {new Date(session.expiresAt).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}. Cierra sesión antes de compartir el dispositivo.</p>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="filter">
      <label>Filtrar por estudiante
        <select value={filter} disabled={busy || loading} onChange={event => setFilter(event.target.value)}>
          <option value="">Todos los estudiantes</option>
          {students.map(profile => <option key={profile.id} value={profile.id}>{profile.nombre} (#{profile.id})</option>)}
        </select>
      </label>
      <button disabled={busy || loading} onClick={() => loadReports()}>↻ Actualizar</button>
    </div>
    {loading ? <p role="status">Cargando resultados…</p> : <div className="table-wrap">
      <table><thead><tr><th>Estudiante</th><th>Actividad</th><th>Puntaje</th><th>Fecha</th></tr></thead>
        <tbody>{visibleReports.map(row => <tr key={row.id}><td>{row.estudiante}</td><td>{row.actividad}</td>
          <td>{row.puntaje}/{row.total}</td><td>{new Date(row.fecha).toLocaleString('es-GT')}</td></tr>)}</tbody>
      </table>
      {visibleReports.length === 0 && <p className="empty">Todavía no hay resultados para mostrar.</p>}
    </div>}
    <div className="panel student-access">
      <h2>Continuar con un estudiante existente</h2>
      <p>Selecciona al estudiante en el filtro para habilitar su acceso en este dispositivo y conservar su historial. Se cerrará tu sesión docente antes de empezar a jugar.</p>
      <button className="primary" disabled={!filter || busy || loading} onClick={enableStudent}>
        {busy ? 'Preparando acceso…' : 'Habilitar estudiante y cerrar sesión'}
      </button>
    </div>
  </section>;
}
