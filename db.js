// db.js - Database helper for Olimpiade Annur

let USE_FIREBASE_REMOTE = true;
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCybZ-o5IcsF9MEPwRd0nrRhT3YM6cqC5M",
  authDomain: "alstoreid1.firebaseapp.com",
  databaseURL: "https://alstoreid1-default-rtdb.firebaseio.com",
  projectId: "alstoreid1",
  storageBucket: "alstoreid1.firebasestorage.app",
  messagingSenderId: "848709188959",
  appId: "1:848709188959:web:1faef1758f2b4e27d38aea"
};

let firebaseInitialized = false;
let firebaseDb = null;
// Promise yang di-resolve setelah Firebase berhasil init (atau gagal)
let firebaseReadyPromise = null;
let firebaseReadyResolve = null;

if (typeof window !== 'undefined' && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
  try {
    Object.assign(FIREBASE_CONFIG, window.FIREBASE_CONFIG);
    if (typeof window.USE_FIREBASE_REMOTE !== 'undefined') {
      USE_FIREBASE_REMOTE = !!window.USE_FIREBASE_REMOTE;
    }
  } catch (err) {
    console.warn('Failed to apply firebase-config override:', err);
  }
}

// Buat promise yang bisa di-await oleh caller untuk menunggu Firebase siap
firebaseReadyPromise = new Promise((resolve) => {
  firebaseReadyResolve = resolve;
});

function initFirebase() {
  if (!USE_FIREBASE_REMOTE || firebaseInitialized) return;
  const hasPlaceholderConfig = FIREBASE_CONFIG.apiKey.startsWith('REPLACE_') || FIREBASE_CONFIG.projectId.startsWith('REPLACE_');
  if (hasPlaceholderConfig) {
    firebaseReadyResolve(false);
    return;
  }

  let attempts = 0;
  const maxAttempts = 8;
  const tryInit = () => {
    attempts++;
    try {
      if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
      firebase.initializeApp(FIREBASE_CONFIG);
      firebaseDb = firebase.firestore();
      firebaseInitialized = true;
      console.info('Firebase initialized successfully');
      firebaseReadyResolve(true);
    } catch (err) {
      if (attempts < maxAttempts) {
        setTimeout(tryInit, 600 * attempts);
      } else {
        console.warn('Firebase init failed after', maxAttempts, 'attempts:', err.message || err);
        firebaseReadyResolve(false);
      }
    }
  };
  tryInit();
}

function isFirebaseEnabled() {
  return firebaseInitialized;
}

// Tunggu sampai Firebase siap (atau gagal), lalu tentukan pakai Firebase atau IndexedDB
async function waitForFirebase() {
  await firebaseReadyPromise;
  return firebaseInitialized;
}

function questionsCollection() {
  return firebaseDb.collection('questions');
}

function answersCollection() {
  return firebaseDb.collection('answers');
}

function resultsCollection() {
  return firebaseDb.collection('results');
}

function safeDocId(subject, index, suffix = '') {
  return `${subject.replace(/[^a-zA-Z0-9]/g, '_')}_${index}${suffix}`;
}

async function saveExamData(subject, questions, answers) {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return saveExamDataFirebase(subject, questions, answers);
  return saveExamDataIndexedDB(subject, questions, answers);
}

async function clearSubjectData(subject) {
  const useFirebase = await waitForFirebase();
  const tasks = [];
  tasks.push(clearSubjectDataIndexedDB(subject).catch(e => console.warn('clearSubjectData IDB:', e)));
  if (useFirebase) tasks.push(clearSubjectDataFirebase(subject).catch(e => console.warn('clearSubjectData FB:', e)));
  return Promise.all(tasks);
}

async function clearExamData() {
  const useFirebase = await waitForFirebase();
  const tasks = [];
  tasks.push(clearExamDataIndexedDB().catch(e => console.warn('clearExamData IDB:', e)));
  if (useFirebase) tasks.push(clearExamDataFirebase().catch(e => console.warn('clearExamData FB:', e)));
  return Promise.all(tasks);
}

async function getAvailableSubjects() {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getAvailableSubjectsFirebase();
  return getAvailableSubjectsIndexedDB();
}

async function getQuestions(subject) {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getQuestionsFirebase(subject);
  return getQuestionsIndexedDB(subject);
}

async function getCorrectAnswers(subject) {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getCorrectAnswersFirebase(subject);
  return getCorrectAnswersIndexedDB(subject);
}

async function saveStudentResult(name, subject, userAnswers, score, total) {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return saveStudentResultFirebase(name, subject, userAnswers, score, total);
  return saveStudentResultIndexedDB(name, subject, userAnswers, score, total);
}

async function getAllResults() {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getAllResultsFirebase();
  return getAllResultsIndexedDB();
}

async function clearAllResults() {
  const useFirebase = await waitForFirebase();
  // Hapus dari kedua storage sekaligus agar tidak ada sisa data yang ter-reload
  const tasks = [];
  tasks.push(clearAllResultsIndexedDB().catch(e => console.warn('clearAllResults IDB:', e)));
  if (useFirebase) tasks.push(clearAllResultsFirebase().catch(e => console.warn('clearAllResults FB:', e)));
  return Promise.all(tasks);
}

async function getRankingData(subject = null) {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getRankingDataFirebase(subject);
  return getRankingDataIndexedDB(subject);
}

// ─── IndexedDB ──────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('OlimpiadeAnnurDB', 3);
    request.onerror = (event) => reject('Gagal membuka database: ' + event.target.error);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (db.objectStoreNames.contains('questions')) db.deleteObjectStore('questions');
      if (db.objectStoreNames.contains('answers')) db.deleteObjectStore('answers');
      if (db.objectStoreNames.contains('results')) db.deleteObjectStore('results');
      db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('answers', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
    };
  });
}

async function clearSubjectDataIndexedDB(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    const qStore = transaction.objectStore('questions');
    const aStore = transaction.objectStore('answers');
    const qReq = qStore.openCursor();
    qReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { if (cursor.value.subject === subject) cursor.delete(); cursor.continue(); }
    };
    const aReq = aStore.openCursor();
    aReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) { if (cursor.value.subject === subject) cursor.delete(); cursor.continue(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = (err) => reject(err);
  });
}

async function clearExamDataIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    transaction.objectStore('questions').clear();
    transaction.objectStore('answers').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = (err) => reject(err);
  });
}

async function saveExamDataIndexedDB(subject, questions, answers) {
  await clearSubjectDataIndexedDB(subject);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    const qStore = transaction.objectStore('questions');
    const aStore = transaction.objectStore('answers');
    questions.forEach((q, index) => {
      const qRecord = { ...q, subject: subject, indexId: index };
      delete qRecord.id;
      qStore.put(qRecord);
      const answerVal = (answers && answers[`q${index}`] !== undefined)
        ? answers[`q${index}`]
        : (answers && answers[index] !== undefined ? answers[index] : '');
      aStore.put({ subject: subject, indexId: index, answer: answerVal });
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = (err) => reject(err);
  });
}

async function getAvailableSubjectsIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions'], 'readonly');
    const store = transaction.objectStore('questions');
    const request = store.getAll();
    request.onsuccess = () => {
      const subjects = new Set();
      request.result.forEach(q => { if (q.subject) subjects.add(q.subject); });
      resolve(Array.from(subjects));
    };
    request.onerror = (err) => reject(err);
  });
}

async function getQuestionsIndexedDB(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions'], 'readonly');
    const store = transaction.objectStore('questions');
    const request = store.getAll();
    request.onsuccess = () => {
      if (subject) {
        const filtered = request.result.filter(q => q.subject === subject);
        filtered.sort((a, b) => a.indexId - b.indexId);
        resolve(filtered);
      } else {
        resolve(request.result);
      }
    };
    request.onerror = (err) => reject(err);
  });
}

async function getCorrectAnswersIndexedDB(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['answers'], 'readonly');
    const store = transaction.objectStore('answers');
    const request = store.getAll();
    request.onsuccess = () => {
      const resultObj = {};
      const items = subject ? request.result.filter(a => a.subject === subject) : request.result;
      items.forEach(item => { resultObj[`q${item.indexId}`] = item.answer; });
      resolve(resultObj);
    };
    request.onerror = (err) => reject(err);
  });
}

async function saveStudentResultIndexedDB(name, subject, userAnswers, score, total) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readwrite');
    const store = transaction.objectStore('results');
    const now = Date.now();
    const resultRecord = {
      name: name,
      subject: subject || 'Umum',
      answers: userAnswers,
      score: score,
      total: total,
      timestamp: new Date().toLocaleString('id-ID'),
      createdAt: now
    };
    const request = store.add(resultRecord);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (err) => reject(err);
  });
}

async function getAllResultsIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readonly');
    const store = transaction.objectStore('results');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (err) => reject(err);
  });
}

async function clearAllResultsIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readwrite');
    const store = transaction.objectStore('results');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (err) => reject(err);
  });
}

async function getRankingDataIndexedDB(subject = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readonly');
    const store = transaction.objectStore('results');
    const request = store.getAll();
    request.onsuccess = () => {
      let results = request.result;
      if (subject) results = results.filter(r => r.subject === subject);
      results.sort((a, b) => b.score - a.score);
      const ranking = results.map((result, index) => ({
        rank: index + 1,
        name: result.name,
        subject: result.subject,
        score: result.score,
        total: result.total,
        percentage: Math.round((result.score / 100) * 100),
        timestamp: result.timestamp
      }));
      resolve(ranking);
    };
    request.onerror = (err) => reject(err);
  });
}

// ─── Firebase ───────────────────────────────────────────────────────────────

async function clearSubjectDataFirebase(subject) {
  try {
    const batch = firebaseDb.batch();
    const qSnapshot = await questionsCollection().where('subject', '==', subject).get();
    const aSnapshot = await answersCollection().where('subject', '==', subject).get();
    qSnapshot.forEach(doc => batch.delete(doc.ref));
    aSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('clearSubjectDataFirebase failed:', err);
    return clearSubjectDataIndexedDB(subject);
  }
}

async function clearExamDataFirebase() {
  try {
    const batch = firebaseDb.batch();
    const qSnapshot = await questionsCollection().get();
    const aSnapshot = await answersCollection().get();
    qSnapshot.forEach(doc => batch.delete(doc.ref));
    aSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('clearExamDataFirebase failed:', err);
    return clearExamDataIndexedDB();
  }
}

async function saveExamDataFirebase(subject, questions, answers) {
  try {
    await clearSubjectDataFirebase(subject);

    // Firestore batch limit = 500 operasi; split jika soal banyak
    const BATCH_SIZE = 200;
    for (let start = 0; start < questions.length; start += BATCH_SIZE) {
      const batch = firebaseDb.batch();
      const chunk = questions.slice(start, start + BATCH_SIZE);
      chunk.forEach((q, i) => {
        const index = start + i;
        const qRef = questionsCollection().doc(safeDocId(subject, index));
        batch.set(qRef, {
          subject,
          indexId: index,
          text: q.text,
          options: q.options || [],
          type: q.type,
          difficulty: q.difficulty || '',
          image: q.image || null
        });
        const answerVal = (answers && answers[`q${index}`] !== undefined)
          ? answers[`q${index}`]
          : (answers && answers[index] !== undefined ? answers[index] : '');
        const aRef = answersCollection().doc(safeDocId(subject, index, '_ans'));
        batch.set(aRef, { subject, indexId: index, answer: answerVal });
      });
      await batch.commit();
    }
  } catch (err) {
    console.warn('saveExamDataFirebase failed, saving to IndexedDB instead:', err);
    return saveExamDataIndexedDB(subject, questions, answers);
  }
}

async function getAvailableSubjectsFirebase() {
  try {
    const snapshot = await questionsCollection().get();
    const subjects = new Set();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.subject) subjects.add(data.subject);
    });
    return Array.from(subjects);
  } catch (err) {
    console.warn('getAvailableSubjectsFirebase failed:', err);
    return getAvailableSubjectsIndexedDB();
  }
}

async function getQuestionsFirebase(subject) {
  try {
    let docs;
    if (subject) {
      // PENTING: hapus .orderBy() agar tidak perlu composite index di Firestore
      // Urutkan di sisi client setelah fetch
      const snapshot = await questionsCollection().where('subject', '==', subject).get();
      docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a, b) => (a.indexId || 0) - (b.indexId || 0));
    } else {
      const snapshot = await questionsCollection().get();
      docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a, b) => {
        if (a.subject === b.subject) return (a.indexId || 0) - (b.indexId || 0);
        return String(a.subject).localeCompare(String(b.subject));
      });
    }
    return docs;
  } catch (err) {
    console.warn('getQuestionsFirebase failed:', err);
    return getQuestionsIndexedDB(subject);
  }
}

async function getCorrectAnswersFirebase(subject) {
  try {
    let snapshot;
    if (subject) {
      snapshot = await answersCollection().where('subject', '==', subject).get();
    } else {
      snapshot = await answersCollection().get();
    }
    const resultObj = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      resultObj[`q${data.indexId}`] = data.answer;
    });
    return resultObj;
  } catch (err) {
    console.warn('getCorrectAnswersFirebase failed:', err);
    return getCorrectAnswersIndexedDB(subject);
  }
}

async function saveStudentResultFirebase(name, subject, userAnswers, score, total) {
  try {
    const resultRecord = {
      name: name,
      subject: subject || 'Umum',
      answers: userAnswers,
      score: score,
      total: total,
      timestamp: new Date().toLocaleString('id-ID'),
      createdAt: Date.now()
    };
    await resultsCollection().add(resultRecord);
  } catch (err) {
    console.warn('saveStudentResultFirebase failed:', err);
    return saveStudentResultIndexedDB(name, subject, userAnswers, score, total);
  }
}

async function getAllResultsFirebase() {
  try {
    const snapshot = await resultsCollection().get();
    return snapshot.docs.map(doc => ({ _fbId: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn('getAllResultsFirebase failed:', err);
    return getAllResultsIndexedDB();
  }
}

async function clearAllResultsFirebase() {
  try {
    const snapshot = await resultsCollection().get();
    if (snapshot.empty) return;
    // Hapus dalam batch (maks 500)
    const BATCH_SIZE = 400;
    const docs = snapshot.docs;
    for (let start = 0; start < docs.length; start += BATCH_SIZE) {
      const batch = firebaseDb.batch();
      docs.slice(start, start + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  } catch (err) {
    console.warn('clearAllResultsFirebase failed:', err);
    return clearAllResultsIndexedDB();
  }
}

async function getRankingDataFirebase(subject = null) {
  try {
    let snapshot;
    if (subject) {
      snapshot = await resultsCollection().where('subject', '==', subject).get();
    } else {
      snapshot = await resultsCollection().get();
    }
    const results = snapshot.docs.map(doc => doc.data());
    results.sort((a, b) => b.score - a.score);
    return results.map((result, index) => ({
      rank: index + 1,
      name: result.name,
      subject: result.subject,
      score: result.score,
      total: result.total,
      percentage: Math.round((result.score / 100) * 100),
      timestamp: result.timestamp
    }));
  } catch (err) {
    console.warn('getRankingDataFirebase failed:', err);
    return getRankingDataIndexedDB(subject);
  }
}

// Jalankan init Firebase
initFirebase();