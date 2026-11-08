// Backend real: Firebase Authentication (Google) + Cloud Firestore.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG, DOMINIO, ADMIN_PRINCIPAL } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const email = () => (auth.currentUser?.email || '').toLowerCase();
const CAMPOS = ['equivalencias', 'numeracion', 'seleccion', 'loteFirma'];

export const name = 'firebase';

export function init(onUser) {
  onAuthStateChanged(auth, user => onUser(user ? { email: user.email.toLowerCase(), name: user.displayName || user.email, verified: user.emailVerified } : null));
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: DOMINIO, prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}

export const logOut = () => signOut(auth);

// Devuelve {rol, activo} o null. El administrador principal crea su propia alta la primera vez.
export async function getAccess() {
  const ref = doc(db, 'usuarios', email());
  let snap;
  try { snap = await getDoc(ref); } catch (e) { if (e.code === 'permission-denied') return null; throw e; }
  if (snap.exists()) return snap.data();
  if (email() === ADMIN_PRINCIPAL) {
    const data = { rol: 'admin', activo: true, alta: serverTimestamp(), altaPor: email(), actualizado: serverTimestamp(), actualizadoPor: email() };
    await setDoc(ref, data);
    return data;
  }
  return null;
}

export async function listCampaigns() {
  const snap = await getDocs(collection(db, 'campanas'));
  return snap.docs.map(d => d.id).sort();
}

export async function loadCampaign(cid) {
  const snap = await getDoc(doc(db, 'campanas', cid));
  return snap.exists() ? snap.data() : {};
}

// fn(datosActuales) -> { next, value }. Se ejecuta en transacción: si otra persona guardó
// al mismo tiempo, Firestore reintenta con los datos más recientes (no se pierde numeración).
export async function updateCampaign(cid, fn) {
  return runTransaction(db, async tx => {
    const ref = doc(db, 'campanas', cid);
    const snap = await tx.get(ref);
    const { next, value } = fn(snap.exists() ? snap.data() : {});
    const data = Object.fromEntries(CAMPOS.map(k => [k, next[k] ?? (k === 'loteFirma' ? '' : [])]));
    if (JSON.stringify(data).length > 950000) throw new Error('La campaña supera el tamaño máximo de Firestore (1 MB). Usa un identificador de campaña nuevo para el siguiente plan.');
    tx.set(ref, { ...data, actualizado: serverTimestamp(), actualizadoPor: email() });
    return value;
  });
}

export async function listUsers() {
  const snap = await getDocs(collection(db, 'usuarios'));
  return snap.docs.map(d => ({ email: d.id, ...d.data() })).sort((a, b) => a.email.localeCompare(b.email));
}

export async function saveUser(correo, { rol, activo }, isNew) {
  const data = { rol, activo, actualizado: serverTimestamp(), actualizadoPor: email() };
  if (isNew) Object.assign(data, { alta: serverTimestamp(), altaPor: email() });
  await setDoc(doc(db, 'usuarios', correo.toLowerCase()), data, { merge: true });
}
