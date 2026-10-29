import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { readProfiles, saveProfiles, validProfile } from './studentProfiles';
import { emoji, generate, newCards } from './games';
import TeacherPanel from './TeacherPanel';
import './App.css';

export default function App() {
  const [page, setPage] = useState('inicio');
  const [profiles, setProfiles] = useState(readProfiles);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState('');
  const [student, setStudent] = useState(null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [level, setLevel] = useState('preprimaria');
  const [activity, setActivity] = useState(null);
  const [question, setQuestion] = useState(null);
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const choosingStudent = useRef(false);
  const memoryTimer = useRef(null);
  const mounted = useRef(false);

  async function loadActivities() {
    setActivitiesLoading(true);
    setActivitiesError('');
    try {
      const result = await request('/api/actividades');
      if (mounted.current) setActivities(result);
    } catch (failure) {
      if (mounted.current) setActivitiesError('No se pudieron cargar los juegos. ' + failure.message);
    } finally {
      if (mounted.current) setActivitiesLoading(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    loadActivities();
    return () => {
      mounted.current = false;
      clearTimeout(memoryTimer.current);
    };
  }, []);

  function navigate(nextPage) {
    setError('');
    setPage(nextPage);
  }

  function updateProfiles(nextProfiles) {
    const remaining = nextProfiles.filter(validProfile).slice(-50);
    setProfiles(remaining);
    setStorageNotice(saveProfiles(remaining) ? '' : 'Puedes jugar durante esta visita, pero este navegador no permite recordar tu acceso.');
  }

  function rememberStudent(profile) {
    updateProfiles([...profiles.filter(item => item.id !== profile.id), profile]);
    setStudent(profile);
    setName('');
    setAge('');
    navigate('niveles');
  }

  function forgetStudent(id) {
    updateProfiles(profiles.filter(profile => profile.id !== id));
    if (student?.id === id) setStudent(null);
    setError('');
  }

  async function register(event) {
    event.preventDefault();
    if (choosingStudent.current) return;
    choosingStudent.current = true;
    setBusy(true);
    setError('');
    try {
      const profile = await request('/api/estudiantes', {
        method: 'POST', body: JSON.stringify({ nombre: name, edad: Number(age) }),
      });
      if (mounted.current) rememberStudent(profile);
    } catch (failure) {
      if (mounted.current) setError(failure.message);
    } finally {
      choosingStudent.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function selectStudent(profile) {
    if (choosingStudent.current) return;
    choosingStudent.current = true;
    setBusy(true);
    setError('');
    try {
      const confirmed = await request('/api/mi-estudiante', { token: profile.token });
      if (mounted.current) rememberStudent({ ...profile, ...confirmed });
    } catch (failure) {
      if (!mounted.current) return;
      if (failure.status === 401 || failure.status === 404) {
        forgetStudent(profile.id);
        setError('Este acceso venció o dejó de ser válido. Pide a tu docente que lo habilite de nuevo para conservar tus resultados.');
      } else setError(failure.message);
    } finally {
      choosingStudent.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function start(selectedActivity) {
    if (!student || !validProfile(student)) {
      if (student) forgetStudent(student.id);
      navigate('registro');
      setError('Tu acceso venció. Pide ayuda a tu docente para continuar con el mismo historial.');
      return;
    }
    clearTimeout(memoryTimer.current);
    setActivity(selectedActivity);
    setIndex(0);
    setScore(0);
    setFeedback(null);
    setCards(newCards());
    setFlipped([]);
    setMatched([]);
    setSaved(false);
    setQuestion(generate(selectedActivity.codigo === 'memoria' ? 'figuras' : selectedActivity.codigo));
    navigate('juego');
  }

  function answer(value) {
    if (feedback || busy) return;
    const correct = value === question.answer;
    setScore(previous => previous + (correct ? 1 : 0));
    setFeedback(correct ? '¡Muy bien! 🎉' : `La respuesta era ${question.answer}`);
  }

  async function next() {
    if (index === 4) {
      await finish(score);
      return;
    }
    setIndex(previous => previous + 1);
    setQuestion(generate(activity.codigo));
    setFeedback(null);
  }

  async function finish(finalScore) {
    if (saving.current || saved) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await request('/api/progresos', {
        method: 'POST', token: student.token,
        body: JSON.stringify({ estudiante_id: student.id, actividad_id: activity.id,
          puntaje: finalScore, total: activity.codigo === 'memoria' ? 4 : 5 }),
      });
      if (mounted.current) {
        setSaved(true);
        navigate('resultado');
      }
    } catch (failure) {
      if (mounted.current) setError(failure.status === 401
        ? 'Tu acceso dejó de ser válido. El resultado aún no se guardó. Pide ayuda a tu docente para habilitar tu acceso.'
        : 'No se pudo confirmar el guardado. Comprueba la conexión y vuelve a pulsar Guardar resultado.');
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function flip(indexToFlip) {
    if (flipped.includes(indexToFlip) || matched.includes(indexToFlip) || flipped.length >= 2 || busy) return;
    const nextFlipped = [...flipped, indexToFlip];
    setFlipped(nextFlipped);
    if (nextFlipped.length !== 2) return;
    const correct = cards[nextFlipped[0]].symbol === cards[nextFlipped[1]].symbol;
    if (correct) {
      const nextMatched = [...matched, ...nextFlipped];
      setMatched(nextMatched);
      setScore(nextMatched.length / 2);
      setFlipped([]);
      if (nextMatched.length === 8) finish(4);
    } else {
      setBusy(true);
      memoryTimer.current = setTimeout(() => {
        setFlipped([]);
        setBusy(false);
      }, 800);
    }
  }

  const availableProfiles = profiles.filter(validProfile);

  return <div className="app">
    <header>
      <button className="brand" disabled={busy} onClick={() => navigate('inicio')}>🌈 Explora y Aprende</button>
      <nav aria-label="Navegación principal">
        <button disabled={busy} onClick={() => navigate('inicio')}>Inicio</button>
        <button disabled={busy} onClick={() => navigate('docentes')}>👩‍🏫 Docentes</button>
      </nav>
    </header>
    <main>
      {error && <div className="alert" role="alert">⚠️ {error}</div>}
      {storageNotice && page !== 'docentes' && <p className="notice" role="status">{storageNotice}</p>}
      {page === 'inicio' && <section className="hero">
        <span className="mascot">🚀🪐🌟</span>
        <div className="hero-badges"><span>✨ Explora</span><span>🎨 Descubre</span><span>🏆 Aprende</span></div>
        <h1>¡Aprender es una aventura!</h1>
        <p>Un universo de juegos y desafíos para pequeños exploradores. ¡Cada respuesta es una nueva estrella!</p>
        <button className="primary" onClick={() => navigate(student ? 'niveles' : 'registro')}>¡Comenzar a jugar! →</button>
        <div className="features"><span>🎨 Aprende jugando</span><span>🏆 Gana puntos</span><span>📈 Sigue tu progreso</span></div>
        <div className="home-showcase">
          <div className="showcase-item"><span className="showcase-icon">🧸</span><div><b>Preprimaria</b><small>Figuras, espacios y memoria</small></div></div>
          <div className="showcase-item"><span className="showcase-icon">🧮</span><div><b>Primaria</b><small>Multiplica y resuelve desafíos</small></div></div>
          <div className="showcase-item"><span className="showcase-icon">🌟</span><div><b>Tus logros</b><small>Gana estrellas y observa tu avance</small></div></div>
        </div>
      </section>}
      {page === 'registro' && <section className="panel small">
        <h1>👋 ¡Hola, explorador!</h1>
        <p>Cuéntanos quién eres para guardar tus estrellas.</p>
        <form onSubmit={register}>
          <label>Tu nombre<input required maxLength={100} value={name} disabled={busy}
            onChange={event => setName(event.target.value)} placeholder="Escribe tu nombre" autoComplete="given-name" /></label>
          <label>Tu edad<input type="number" required min="3" max="18" value={age} disabled={busy}
            onChange={event => setAge(event.target.value)} placeholder="¿Cuántos años tienes?" /></label>
          <button disabled={busy} className="primary">{busy ? 'Preparando tu acceso…' : '¡Continuar! →'}</button>
        </form>
        {availableProfiles.length > 0 && <div className="remembered-students">
          <h2>¿Ya jugaste en este dispositivo?</h2>
          <p>Elige tu nombre para continuar.</p>
          <ul>{availableProfiles.map(profile => <li key={profile.id}>
            <button className="profile-button" disabled={busy} onClick={() => selectStudent(profile)}>
              {profile.nombre} ({profile.edad} años)
            </button>
            <button className="forget-button" disabled={busy} onClick={() => forgetStudent(profile.id)}
              aria-label={`Olvidar acceso de ${profile.nombre} en este dispositivo`}>Olvidar</button>
          </li>)}</ul>
          <p className="help-text">«Olvidar» quita el acceso de este dispositivo. Tus resultados guardados se conservan.</p>
        </div>}
        <p className="help-text">Solo aparecen los accesos guardados aquí. Si ya tenías resultados y no encuentras tu nombre, pide a tu docente que habilite tu acceso en este dispositivo.</p>
      </section>}
      {page === 'niveles' && <section>
        <button className="back" onClick={() => navigate('registro')}>Cambiar estudiante</button>
        <h1>¡Hola, {student?.nombre}! 👋</h1><p>Elige tu nivel para empezar la aventura.</p>
        <div className="cards">
          <button className="tile" onClick={() => { setLevel('preprimaria'); navigate('catalogo'); }}><span>🧸</span><h2>Preprimaria</h2><p>Espacios, figuras y memoria</p></button>
          <button className="tile" onClick={() => { setLevel('primaria'); navigate('catalogo'); }}><span>📚</span><h2>Primaria</h2><p>Multiplicaciones, fracciones y decimales</p></button>
        </div>
      </section>}
      {page === 'catalogo' && <section>
        <button className="back" onClick={() => navigate('niveles')}>← Volver a niveles</button>
        <h1>{level === 'preprimaria' ? '🧸 Preprimaria' : '📚 Primaria'}</h1><p>Selecciona una actividad para jugar.</p>
        {activitiesLoading && <p role="status">Cargando juegos…</p>}
        {activitiesError && <div className="alert" role="alert">{activitiesError} <button onClick={loadActivities}>Reintentar</button></div>}
        <div className="cards">{activities.filter(item => item.nivel === level).map(item =>
          <button className="tile" key={item.id} onClick={() => start(item)}><span>{emoji[item.codigo]}</span><h2>{item.titulo}</h2><p>¡Jugar ahora! →</p></button>)}</div>
      </section>}
      {page === 'juego' && <section className="panel game">
        <button className="back" disabled={busy} onClick={() => navigate('catalogo')}>← Salir del juego</button>
        <h2>{emoji[activity?.codigo]} {activity?.titulo}</h2>
        {activity?.codigo === 'memoria' ? <>
          <p>Encuentra los cuatro pares de animales.</p><p>⭐ Pares encontrados: {matched.length / 2} de 4</p>
          <div className="memory">{cards.map((card, cardIndex) => <button key={card.id}
            disabled={busy || matched.includes(cardIndex)} className={'memory-card ' + (matched.includes(cardIndex) ? 'matched' : '')}
            aria-label={flipped.includes(cardIndex) || matched.includes(cardIndex) ? card.symbol : `Tarjeta ${cardIndex + 1}`}
            onClick={() => flip(cardIndex)}>{flipped.includes(cardIndex) || matched.includes(cardIndex) ? card.symbol : '❔'}</button>)}</div>
          {matched.length === 8 && !saved && <button className="primary" disabled={busy} onClick={() => finish(4)}>
            {busy ? 'Guardando resultado…' : 'Guardar resultado'}
          </button>}
        </> : <>
          <div className="progress"><div style={{ width: `${(index + 1) * 20}%` }} /></div>
          <p>Pregunta {index + 1} de 5 · ⭐ {score} puntos</p><h1 className="question">{question?.q}</h1>
          <div className="options">{question?.options.map(option => <button disabled={!!feedback || busy} key={option} onClick={() => answer(option)}>{option}</button>)}</div>
          {feedback && <div className="feedback" role="status"><strong>{feedback}</strong>
            <button className="primary" disabled={busy} onClick={next}>{busy ? 'Guardando resultado…' : index === 4 ? 'Guardar resultado' : 'Siguiente →'}</button>
          </div>}
        </>}
      </section>}
      {page === 'resultado' && <section className="hero">
        <span className="mascot">🏆🎊</span><h1>¡Excelente trabajo, {student?.nombre}!</h1>
        <p>Completaste {activity?.titulo}.</p><div className="result">⭐ {score} / {activity?.codigo === 'memoria' ? 4 : 5}</div>
        <p>Tu resultado se guardó en la base de datos.</p><button className="primary" onClick={() => navigate('catalogo')}>Jugar otra actividad →</button>
      </section>}
      {page === 'docentes' && <TeacherPanel onBack={() => navigate('inicio')} onStudentAccess={rememberStudent} />}
    </main>
    <footer>🌈 Explora y Aprende · Proyecto de Desarrollo Web 2026</footer>
  </div>;
}
