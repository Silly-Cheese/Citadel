import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWL5OZQaOUnXatsdJGdpvwkv-iXdas0eA",
  authDomain: "citadel-8bf1b.firebaseapp.com",
  projectId: "citadel-8bf1b",
  storageBucket: "citadel-8bf1b.firebasestorage.app",
  messagingSenderId: "6873639380",
  appId: "1:6873639380:web:7e143a807bbebe4048ce41"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  runTransaction,
  where
};
