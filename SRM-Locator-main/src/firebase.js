import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';

// A public Firebase *client* config (it ships in every web build), not a secret. The
// VITE_FIREBASE_* variables override it; without them the build still signs in.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDLHdYE-DooW-7eZ8HGsJv01CSXW5hnfeY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "locus-5c6a8.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "locus-5c6a8",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "locus-5c6a8.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "146325179738",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:146325179738:web:1f0f429750b4a662057763"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);