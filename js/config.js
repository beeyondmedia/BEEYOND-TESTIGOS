// =====================================================================
// Configuración de la app. Lo único que hay que editar al instalarla.
// =====================================================================

// 1) Configuración web del proyecto de Firebase "beeyond-testigos".
//    Estos valores NO son secretos: la seguridad la dan las reglas de Firestore (firestore.rules).
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDOzGnSQOTHFz4Z9KrcXvw1_YBDMpTOVpY",
  authDomain: "beeyond-testigos.firebaseapp.com",
  projectId: "beeyond-testigos",
  storageBucket: "beeyond-testigos.firebasestorage.app",
  messagingSenderId: "1044694224582",
  appId: "1:1044694224582:web:2622d13a39cd24cc2451c7",
};

// 2) Dominio de correo permitido. Debe coincidir con firestore.rules.
export const DOMINIO = "beeyondmedia.com";

// 3) Administrador principal: entra sin alta previa y da de alta al resto.
//    Si lo cambias aquí, cámbialo también en firestore.rules.
export const ADMIN_PRINCIPAL = "eliot.fabela@beeyondmedia.com";
