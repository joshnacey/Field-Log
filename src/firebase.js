import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  query,
  orderBy,
} from "firebase/firestore";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBwDmaWlQzPQOlY0xvfpVCtUqR81ho--es",
  authDomain: "mend-the-drift.firebaseapp.com",
  projectId: "mend-the-drift",
  storageBucket: "mend-the-drift.firebasestorage.app",
  messagingSenderId: "911022269714",
  appId: "1:911022269714:web:5e75806282965c6a137fcb",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Keeps the guide signed in across app opens and phone restarts.
setPersistence(auth, browserLocalPersistence).catch(() => {});

// The crew's shared signup code. Change this to rotate access.
export const SIGNUP_CODE = "MENDTHEDRIFT";

/* ---------- auth ---------- */

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signUp(email, password, name, code) {
  if ((code || "").trim().toUpperCase() !== SIGNUP_CODE) {
    throw new Error("bad-code");
  }
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const displayName = (name || "").trim();
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOut() {
  await fbSignOut(auth);
}

// Turns Firebase's error codes into plain language.
export function authErrorMessage(err) {
  const code = err?.code || err?.message || "";
  if (code === "bad-code") return "That signup code isn't right. Check with whoever gave you the app.";
  if (code.includes("email-already-in-use")) return "An account already exists for that email. Try signing in instead.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email address.";
  if (code.includes("weak-password")) return "Password needs to be at least 6 characters.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Email or password doesn't match. Try again.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a minute and try again.";
  if (code.includes("network")) return "Network problem — check your connection.";
  return "Something went wrong. Try again.";
}

/* ---------- catches (shared across all guides) ---------- */

export async function saveCatch(entry) {
  const docRef = await addDoc(collection(db, "catches"), entry);
  return docRef.id;
}

export async function loadCatches() {
  const q = query(collection(db, "catches"), orderBy("timestamp", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateCatch(id, entry) {
  await updateDoc(doc(db, "catches", id), entry);
}

export async function deleteCatch(id) {
  await deleteDoc(doc(db, "catches", id));
}

/* ---------- AARs (private to the guide who wrote them) ---------- */

export async function saveAAR(entry) {
  const docRef = await addDoc(collection(db, "aars"), entry);
  return docRef.id;
}

// Loads this guide's AARs by account id, with a name fallback for older entries.
export async function loadAARs(uid, name) {
  const q = query(collection(db, "aars"), orderBy("timestamp", "desc"));
  const snapshot = await getDocs(q);
  const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  const n = (name || "").trim().toLowerCase();
  return all.filter((e) => {
    if (uid && e.uid) return e.uid === uid;
    if (n) return (e.guide || "").trim().toLowerCase() === n;
    return false;
  });
}

export async function deleteAAR(id) {
  await deleteDoc(doc(db, "aars", id));
}
