import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

import firebaseConfigJson from '../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigJson.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfigJson.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfigJson.measurementId,
};

const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || firebaseConfigJson.firestoreDatabaseId;

const isAlreadyInitialized = getApps().length > 0;
const app = isAlreadyInitialized ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firestoreDatabaseId);

let authInstance;
try {
  // Use browserLocalPersistence to avoid IndexedDB issues in iframes/HMR
  if (!isAlreadyInitialized) {
     authInstance = initializeAuth(app, {
       persistence: browserLocalPersistence,
       popupRedirectResolver: browserPopupRedirectResolver
     });
  } else {
     authInstance = getAuth(app);
  }
} catch (error) {
  // fallback if already initialized
  authInstance = getAuth(app);
}

export const auth = authInstance;



