// db.js - Database helper for Olimpiade Annur
// This app can use Firebase Firestore to store soal and hasil secara remote.
// Jika Firebase belum dikonfigurasi, modul akan jatuh kembali ke IndexedDB lokal.

const USE_FIREBASE_REMOTE = true;
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

function initFirebase() {
  if (!USE_FIREBASE_REMOTE || firebaseInitialized) return;
  const hasPlaceholderConfig = FIREBASE_CONFIG.apiKey.startsWith('REPLACE_') || FIREBASE_CONFIG.projectId.startsWith('REPLACE_');
  if (hasPlaceholderConfig || typeof firebase === 'undefined' || !firebase.apps) return;

  firebase.initializeApp(FIREBASE_CONFIG);
  firebaseDb = firebase.firestore();
  firebaseInitialized = true;
}

function isFirebaseEnabled() {
  initFirebase();
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
  return `${subject.replace(/\s+/g, '_')}_${index}${suffix}`;
}

async function saveExamData(subject, questions, answers) {
  if (isFirebaseEnabled()) return saveExamDataFirebase(subject, questions, answers);
  return saveExamDataIndexedDB(subject, questions, answers);
}

async function clearSubjectData(subject) {
  if (isFirebaseEnabled()) return clearSubjectDataFirebase(subject);
  return clearSubjectDataIndexedDB(subject);
}

async function clearExamData() {
  if (isFirebaseEnabled()) return clearExamDataFirebase();
  return clearExamDataIndexedDB();
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
  if (isFirebaseEnabled()) return clearAllResultsFirebase();
  return clearAllResultsIndexedDB();
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
    const resultRecord = {
      name: name,
      subject: subject || 'Umum',
      answers: userAnswers,
      score: score,
      total: total,
      timestamp: new Date().toLocaleString('id-ID')
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
  const batch = firebaseDb.batch();
  const qSnapshot = await questionsCollection().where('subject', '==', subject).get();
  const aSnapshot = await answersCollection().where('subject', '==', subject).get();
  qSnapshot.forEach(doc => batch.delete(doc.ref));
  aSnapshot.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

async function clearExamDataFirebase() {
  const batch = firebaseDb.batch();
  const qSnapshot = await questionsCollection().get();
  const aSnapshot = await answersCollection().get();
  qSnapshot.forEach(doc => batch.delete(doc.ref));
  aSnapshot.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
}

async function saveExamDataFirebase(subject, questions, answers) {
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
      difficulty: q.difficulty || ''
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
}

async function getAvailableSubjectsFirebase() {
  const snapshot = await questionsCollection().get();
  const subjects = new Set();
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.subject) subjects.add(data.subject);
  });
  return Array.from(subjects);
}

async function getQuestionsFirebase(subject) {
  let query = questionsCollection();
  if (subject) {
    query = query.where('subject', '==', subject).orderBy('indexId');
  } else {
    query = query.orderBy('subject').orderBy('indexId');
  }

  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getCorrectAnswersFirebase(subject) {
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
}

async function saveStudentResultFirebase(name, subject, userAnswers, score, total) {
  const resultRecord = {
    name: name,
    subject: subject || 'Umum',
    answers: userAnswers,
    score: score,
    total: total,
    timestamp: new Date().toLocaleString('id-ID')
  };
  await resultsCollection().add(resultRecord);
}

async function getAllResultsFirebase() {
  const snapshot = await resultsCollection().get();
  return snapshot.docs.map(doc => doc.data());
}

async function clearAllResultsFirebase() {
  const snapshot = await resultsCollection().get();
  const batch = firebaseDb.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
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
