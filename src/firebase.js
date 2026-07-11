import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";

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

export async function saveCatch(entry) {
  const docRef = await addDoc(collection(db, "catches"), entry);
  return docRef.id;
}

export async function loadCatches() {
  const q = query(collection(db, "catches"), orderBy("timestamp", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function getSavedGuideName() {
  return localStorage.getItem("mtd-guide-name") || "";
}

export function saveGuideName(name) {
  localStorage.setItem("mtd-guide-name", name);
}
