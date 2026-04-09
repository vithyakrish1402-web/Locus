import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDLHdYE-DooW-7eZ8HGsJv01CSXW5hnfeY",
  authDomain: "locus-5c6a8.firebaseapp.com",
  projectId: "locus-5c6a8",
  storageBucket: "locus-5c6a8.firebasestorage.app",
  messagingSenderId: "146325179738",
  appId: "1:146325179738:web:1f0f429750b4a662057763"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);