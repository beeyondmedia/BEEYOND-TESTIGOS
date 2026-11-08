// =====================================================================
// Configuración de la app. Lo único que hay que editar al instalarla.
// =====================================================================

// 1) Configuración web del proyecto de Firebase "Beeyond Testigos" (ID beeyond-testigos-9f3e2).
//    Estos valores NO son secretos: la seguridad la dan las reglas de Firestore (firestore.rules).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBmAuXwyrTOcxPVugzrsbxARH5XHbeY_w8",
  authDomain: "beeyond-testigos-9f3e2.firebaseapp.com",
  projectId: "beeyond-testigos-9f3e2",
  storageBucket: "beeyond-testigos-9f3e2.firebasestorage.app",
  messagingSenderId: "1095460810318",
  appId: "1:1095460810318:web:697d34019ce00c2f0add1f",
};

// 2) Dominio de correo permitido. Debe coincidir con firestore.rules.
export const DOMINIO = "beeyondmedia.com";

// 3) Administrador principal: entra sin alta previa y da de alta al resto.
//    Si lo cambias aquí, cámbialo también en firestore.rules.
export const ADMIN_PRINCIPAL = "eliot.fabela@beeyondmedia.com";
