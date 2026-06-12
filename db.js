// db.js - Database helper for Olimpiade Annur
// This app can use Firebase Firestore to store soal and hasil secara remote.
// Jika Firebase belum dikonfigurasi, modul akan jatuh kembali ke IndexedDB lokal.

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

// Allow overriding Firebase config from a separate `firebase-config.js` file.
// If you create `firebase-config.js`, set `window.FIREBASE_CONFIG = { ... }` and
// optionally `window.USE_FIREBASE_REMOTE = true` to enable remote DB.
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

function initFirebase() {
  if (!USE_FIREBASE_REMOTE || firebaseInitialized) return;
  const hasPlaceholderConfig = FIREBASE_CONFIG.apiKey.startsWith('REPLACE_') || FIREBASE_CONFIG.projectId.startsWith('REPLACE_');
  if (hasPlaceholderConfig) return;

  // Try to initialize Firebase with retries in case SDK is still loading
  let attempts = 0;
  const maxAttempts = 6;
  const tryInit = () => {
    attempts++;
    try {
      if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
      if (!firebase.apps || !Array.isArray(firebase.apps)) {
        // compat build exposes firebase.apps as object/array; allow initialization
      }
      firebase.initializeApp(FIREBASE_CONFIG);
      firebaseDb = firebase.firestore();
      firebaseInitialized = true;

      // After successful init, attempt to sync any local data to remote
      try {
        syncLocalToFirebase().catch(err => console.warn('Sync to Firebase failed:', err));
      } catch (err) {
        console.warn('syncLocalToFirebase threw:', err);
      }
    } catch (err) {
      if (attempts < maxAttempts) {
        setTimeout(tryInit, 800 * attempts);
      } else {
        console.warn('Firebase init failed:', err.message || err);
      }
    }
  };
  tryInit();
}

function isFirebaseEnabled() {
  initFirebase();
  return firebaseInitialized;
}

// If Firebase becomes available later, upload local IndexedDB data so other devices can see it.
async function syncLocalToFirebase() {
  if (!isFirebaseEnabled()) return;
  try {
    const subjects = await getAvailableSubjectsIndexedDB();
    for (const subj of subjects) {
      const qs = await getQuestionsIndexedDB(subj);
      const ans = await getCorrectAnswersIndexedDB(subj);
      await saveExamDataFirebase(subj, qs, ans);
    }
    // Also upload results if any, but skip those created before the last admin clear
    const clearedAt = parseInt(localStorage.getItem('cleared_results_at') || '0', 10);
    const localResults = await getAllResultsIndexedDB();
    for (const r of localResults) {
      // if admin recently cleared results, skip uploading older entries
      if (clearedAt && r.createdAt && r.createdAt <= clearedAt) continue;
      await saveStudentResultFirebase(r.name, r.subject, r.answers, r.score, r.total, r.createdAt);
    }
    console.info('Local IndexedDB synced to Firebase');
  } catch (err) {
    console.warn('Error syncing local DB to Firebase:', err);
  }
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
  return `${subject.replace(/\s+/g, '_')}_${index}${suffix}`;
}

async function saveExamData(subject, questions, answers) {
  if (isFirebaseEnabled()) return saveExamDataFirebase(subject, questions, answers);
  return saveExamDataIndexedDB(subject, questions, answers);
}

async function clearSubjectData(subject) {
  // Ensure deletion occurs both locally and remotely to avoid re-syncing local copies
  const tasks = [];
  try {
    tasks.push(clearSubjectDataIndexedDB(subject));
  } catch (e) {
    console.warn('clearSubjectData: failed to clear IndexedDB', e);
  }
  if (isFirebaseEnabled()) {
    try {
      tasks.push(clearSubjectDataFirebase(subject));
    } catch (e) {
      console.warn('clearSubjectData: failed to clear Firebase', e);
    }
  }
  return Promise.all(tasks);
}

async function clearExamData() {
  // Delete all exam data both locally and remotely to avoid re-sync
  const tasks = [];
  try {
    tasks.push(clearExamDataIndexedDB());
  } catch (e) {
    console.warn('clearExamData: failed to clear IndexedDB', e);
  }
  if (isFirebaseEnabled()) {
    try {
      tasks.push(clearExamDataFirebase());
    } catch (e) {
      console.warn('clearExamData: failed to clear Firebase', e);
    }
  }
  return Promise.all(tasks);
}

async function getAvailableSubjects() {
  if (isFirebaseEnabled()) return getAvailableSubjectsFirebase();
  return getAvailableSubjectsIndexedDB();
}

async function getQuestions(subject) {
  if (isFirebaseEnabled()) return getQuestionsFirebase(subject);
  return getQuestionsIndexedDB(subject);
}

async function getCorrectAnswers(subject) {
  if (isFirebaseEnabled()) return getCorrectAnswersFirebase(subject);
  return getCorrectAnswersIndexedDB(subject);
}

async function saveStudentResult(name, subject, userAnswers, score, total) {
  if (isFirebaseEnabled()) return saveStudentResultFirebase(name, subject, userAnswers, score, total);
  return saveStudentResultIndexedDB(name, subject, userAnswers, score, total);
}

async function getAllResults() {
  if (isFirebaseEnabled()) return getAllResultsFirebase();
  return getAllResultsIndexedDB();
}

async function clearAllResults() {
  // Ensure we clear results both locally and remotely to avoid re-sync
  const tasks = [];
  try {
    tasks.push(clearAllResultsIndexedDB());
  } catch (e) {
    console.warn('clearAllResults: failed to clear IndexedDB', e);
  }
  if (isFirebaseEnabled()) {
    try {
      tasks.push(clearAllResultsFirebase());
    } catch (e) {
      console.warn('clearAllResults: failed to clear Firebase', e);
    }
  }
  return Promise.all(tasks);
}

async function getRankingData(subject = null) {
  if (isFirebaseEnabled()) return getRankingDataFirebase(subject);
  return getRankingDataIndexedDB(subject);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('OlimpiadeAnnurDB', 3);

    request.onerror = (event) => {
      reject('Gagal membuka database: ' + event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

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

// IndexedDB fallback implementation
async function clearSubjectDataIndexedDB(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    const qStore = transaction.objectStore('questions');
    const aStore = transaction.objectStore('answers');

    const qReq = qStore.openCursor();
    qReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.subject === subject) cursor.delete();
        cursor.continue();
      }
    };

    const aReq = aStore.openCursor();
    aReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.subject === subject) cursor.delete();
        cursor.continue();
      }
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
      request.result.forEach(q => {
        if (q.subject) subjects.add(q.subject);
      });
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
      items.forEach(item => {
        resultObj[`q${item.indexId}`] = item.answer;
      });
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
      if (subject) {
        results = results.filter(r => r.subject === subject);
      }
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

// Firebase remote implementation
async function clearSubjectDataFirebase(subject) {
  try {
    const batch = firebaseDb.batch();
    const qSnapshot = await questionsCollection().where('subject', '==', subject).get();
    const aSnapshot = await answersCollection().where('subject', '==', subject).get();
    qSnapshot.forEach(doc => batch.delete(doc.ref));
    aSnapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('clearSubjectDataFirebase failed, falling back to IndexedDB:', err);
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
    console.warn('clearExamDataFirebase failed, falling back to IndexedDB:', err);
    return clearExamDataIndexedDB();
  }
}

async function saveExamDataFirebase(subject, questions, answers) {
  try {
    await clearSubjectDataFirebase(subject);
    const batch = firebaseDb.batch();

    questions.forEach((q, index) => {
      const qRef = questionsCollection().doc(safeDocId(subject, index));
      batch.set(qRef, {
        subject,
        indexId: index,
        text: q.text,
        options: q.options || [],
        type: q.type,
        difficulty: q.difficulty || '',
        // include image if present so clients can render question images
        image: q.image || null
      });

      const answerVal = (answers && answers[`q${index}`] !== undefined)
        ? answers[`q${index}`]
        : (answers && answers[index] !== undefined ? answers[index] : '');

      const aRef = answersCollection().doc(safeDocId(subject, index, '_ans'));
      batch.set(aRef, {
        subject,
        indexId: index,
        answer: answerVal
      });
    });

    await batch.commit();
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
    console.warn('getAvailableSubjectsFirebase failed, using IndexedDB:', err);
    return getAvailableSubjectsIndexedDB();
  }
}

async function getQuestionsFirebase(subject) {
  try {
    let query = questionsCollection();
    if (subject) {
      query = query.where('subject', '==', subject).orderBy('indexId');
    } else {
      query = query.orderBy('subject').orderBy('indexId');
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn('getQuestionsFirebase failed, using IndexedDB:', err);
    return getQuestionsIndexedDB(subject);
  }
}

async function getCorrectAnswersFirebase(subject) {
  try {
    let query = answersCollection();
    if (subject) {
      query = query.where('subject', '==', subject);
    }

    const snapshot = await query.get();
    const resultObj = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      resultObj[`q${data.indexId}`] = data.answer;
    });
    return resultObj;
  } catch (err) {
    console.warn('getCorrectAnswersFirebase failed, using IndexedDB:', err);
    return getCorrectAnswersIndexedDB(subject);
  }
}

async function saveStudentResultFirebase(name, subject, userAnswers, score, total, createdAt) {
  try {
    const resultRecord = {
      name: name,
      subject: subject || 'Umum',
      answers: userAnswers,
      score: score,
      total: total,
      timestamp: new Date().toLocaleString('id-ID')
    };
    if (createdAt) resultRecord.createdAt = createdAt;
    await resultsCollection().add(resultRecord);
  } catch (err) {
    console.warn('saveStudentResultFirebase failed, saving to IndexedDB instead:', err);
    return saveStudentResultIndexedDB(name, subject, userAnswers, score, total);
  }
}

async function getAllResultsFirebase() {
  try {
    const snapshot = await resultsCollection().get();
    return snapshot.docs.map(doc => doc.data());
  } catch (err) {
    console.warn('getAllResultsFirebase failed, using IndexedDB:', err);
    return getAllResultsIndexedDB();
  }
}

async function clearAllResultsFirebase() {
  try {
    const snapshot = await resultsCollection().get();
    const batch = firebaseDb.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn('clearAllResultsFirebase failed, falling back to IndexedDB:', err);
    return clearAllResultsIndexedDB();
  }
}

async function getRankingDataFirebase(subject = null) {
  let query = resultsCollection();
  if (subject) query = query.where('subject', '==', subject);
  const snapshot = await query.get();

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
}
