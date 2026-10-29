import { API } from './api';

// Únicamente accesos individuales de alumnos. La sesión docente nunca se guarda aquí.
const STORAGE_KEY = `explora.estudiantes.v1:${API}`;

export function validProfile(profile) {
  return profile && Number.isSafeInteger(profile.id) && profile.id > 0
    && typeof profile.nombre === 'string' && profile.nombre.length <= 100
    && Number.isInteger(profile.edad) && profile.edad >= 3 && profile.edad <= 18
    && typeof profile.token === 'string' && profile.token.length > 0 && profile.token.length <= 2048
    && Number.isFinite(profile.expiresAt) && profile.expiresAt > Date.now();
}

export function readProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(profiles) ? profiles.filter(validProfile).slice(-50) : [];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.filter(validProfile).slice(-50)));
    return true;
  } catch {
    return false;
  }
}
