// Only for local tests: no network connection and no credentials.
export function createFakeDb() {
  const codes = ['espacial', 'figuras', 'memoria', 'tablas', 'fracciones', 'decimales'];
  const activities = codes.map((codigo, i) => ({ id: i + 1, codigo, titulo: codigo, nivel: i < 3 ? 'preprimaria' : 'primaria' }));
  const students = [];
  const progresses = [];
  const calls = [];
  const selectStudent = row => ({ id: row.id, nombre: row.nombre, edad: row.edad });
  async function run(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params: [...params] });
    if (normalized === 'SELECT 1') return [[{ 1: 1 }], []];
    if (normalized === 'SELECT id, codigo, titulo, nivel FROM actividades ORDER BY id') return [activities.map(row => ({ ...row })), []];
    if (normalized === 'SELECT id, nombre, edad FROM estudiantes ORDER BY nombre') {
      return [students.map(selectStudent).sort((a, b) => a.nombre.localeCompare(b.nombre)), []];
    }
    if (normalized === 'INSERT INTO estudiantes(nombre, edad) VALUES (?, ?)') {
      const id = students.length + 1;
      students.push({ id, nombre: params[0], edad: params[1] });
      return [{ insertId: id }, []];
    }
    if (normalized === 'SELECT id, nombre, edad FROM estudiantes WHERE id=?') {
      return [students.filter(row => row.id === params[0]).map(selectStudent), []];
    }
    if (normalized === 'SELECT codigo FROM actividades WHERE id=?') {
      return [activities.filter(row => row.id === params[0]).map(row => ({ codigo: row.codigo })), []];
    }
    if (normalized === 'INSERT INTO progresos (estudiante_id, actividad_id, puntaje, total) VALUES (?, ?, ?, ?)') {
      const [estudiante_id, actividad_id, puntaje, total] = params;
      if (!students.some(row => row.id === estudiante_id) || !activities.some(row => row.id === actividad_id)) {
        throw Object.assign(new Error('Fixture foreign key failure'), { code: 'ER_NO_REFERENCED_ROW_2' });
      }
      const id = progresses.length + 1;
      progresses.push({ id, estudiante_id, actividad_id, puntaje, total, fecha: new Date(1_790_000_000_000 + id).toISOString() });
      return [{ insertId: id }, []];
    }
    if (normalized.startsWith('SELECT p.id, e.nombre AS estudiante, a.titulo AS actividad,') && normalized.endsWith('ORDER BY p.fecha DESC, p.id DESC')) {
      const filtered = normalized.includes('WHERE p.estudiante_id=?')
        ? progresses.filter(row => row.estudiante_id === params[0]) : progresses;
      return [filtered.map(row => ({
        id: row.id, estudiante: students.find(s => s.id === row.estudiante_id).nombre,
        actividad: activities.find(a => a.id === row.actividad_id).titulo,
        puntaje: row.puntaje, total: row.total, fecha: row.fecha, estudiante_id: row.estudiante_id,
      })).sort((a, b) => b.id - a.id), []];
    }
    throw new Error(`Unexpected SQL in isolated test: ${normalized}`);
  }
  return { query: run, execute: run, activities, students, progresses, calls };
}
