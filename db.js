// db.js - IndexedDB helper for Olimpiade Annur Database
const DB_NAME = 'OlimpiadeAnnurDB';
const DB_VERSION = 3; // Incremented to wipe old schema and force clean upgrade

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      reject('Gagal membuka database: ' + event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Wipe old stores to prevent schema conflicts (keyPath changes)
      if (db.objectStoreNames.contains('questions')) db.deleteObjectStore('questions');
      if (db.objectStoreNames.contains('answers')) db.deleteObjectStore('answers');
      if (db.objectStoreNames.contains('results')) db.deleteObjectStore('results');

      db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('answers', { keyPath: 'id', autoIncrement: true }); 
      db.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
    };
  });
}

// Clear specific subject data
async function clearSubjectData(subject) {
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

// Clear ALL data
async function clearExamData() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    transaction.objectStore('questions').clear();
    transaction.objectStore('answers').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = (err) => reject(err);
  });
}

// Save questions & answers for a specific subject
async function saveExamData(subject, questions, answers) {
  await clearSubjectData(subject);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions', 'answers'], 'readwrite');
    const qStore = transaction.objectStore('questions');
    const aStore = transaction.objectStore('answers');

    questions.forEach((q, index) => {
      const qRecord = { ...q, subject: subject, indexId: index };
      delete qRecord.id; // Crucial: Remove hardcoded ID so autoIncrement works for multiple subjects
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

// Get all available subjects
async function getAvailableSubjects() {
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

// Get questions by subject
async function getQuestions(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['questions'], 'readonly');
    const store = transaction.objectStore('questions');
    const request = store.getAll();
    request.onsuccess = () => {
      if (subject) {
        const filtered = request.result.filter(q => q.subject === subject);
        // Ensure they are ordered by indexId
        filtered.sort((a, b) => a.indexId - b.indexId);
        resolve(filtered);
      } else {
        resolve(request.result);
      }
    };
    request.onerror = (err) => reject(err);
  });
}

// Get correct answers by subject
async function getCorrectAnswers(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['answers'], 'readonly');
    const store = transaction.objectStore('answers');
    const request = store.getAll();
    request.onsuccess = () => {
      const resultObj = {};
      const items = subject ? request.result.filter(a => a.subject === subject) : request.result;
      items.forEach(item => {
        // use indexId for answering keys instead of auto-increment id
        resultObj[`q${item.indexId}`] = item.answer;
      });
      resolve(resultObj);
    };
    request.onerror = (err) => reject(err);
  });
}

// Save student result
async function saveStudentResult(name, subject, userAnswers, score, total) {
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

// Get all results
async function getAllResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readonly');
    const store = transaction.objectStore('results');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (err) => reject(err);
  });
}

// Clear all results
async function clearAllResults() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readwrite');
    const store = transaction.objectStore('results');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (err) => reject(err);
  });
}

// Get ranking data sorted by score (highest first)
async function getRankingData(subject = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['results'], 'readonly');
    const store = transaction.objectStore('results');
    const request = store.getAll();
    request.onsuccess = () => {
      let results = request.result;
      
      // Filter by subject if provided
      if (subject) {
        results = results.filter(r => r.subject === subject);
      }
      
      // Sort by score descending
      results.sort((a, b) => b.score - a.score);
      
      // Add ranking position
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
