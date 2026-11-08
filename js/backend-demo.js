// Modo demostración (?demo): mismo comportamiento sin Firebase, guardado solo en este navegador.
import { ADMIN_PRINCIPAL } from './config.js';

const KEY = 'beeyond-testigos-demo';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { campanas: {}, usuarios: {} }; } catch { return { campanas: {}, usuarios: {} }; } };
const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ } };
let state = read();
let listener = null;
let user = null;

export const name = 'demo';
export function init(onUser) { listener = onUser; onUser(user); }
export async function signIn() { user = { email: ADMIN_PRINCIPAL, name: 'Demostración', verified: true }; listener(user); }
export async function logOut() { user = null; listener(null); }
export async function getAccess() { return { rol: 'admin', activo: true }; }
export async function listCampaigns() { return Object.keys(state.campanas).sort(); }
export async function loadCampaign(cid) { return structuredClone(state.campanas[cid] || {}); }
export async function updateCampaign(cid, fn) {
  const { next, value } = fn(structuredClone(state.campanas[cid] || {}));
  state.campanas[cid] = { equivalencias: next.equivalencias || [], numeracion: next.numeracion || [], seleccion: next.seleccion || [], loteFirma: next.loteFirma || '' };
  write(state);
  return value;
}
export async function listUsers() { return Object.entries(state.usuarios).map(([email, d]) => ({ email, ...d })); }
export async function saveUser(correo, data) { state.usuarios[correo.toLowerCase()] = { ...(state.usuarios[correo] || {}), ...data }; write(state); }
