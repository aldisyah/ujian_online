// db.js - Database helper for Olimpiade Annur
// PERBAIKAN: gambar base64 disimpan di IndexedDB store 'images' yang terpisah
// agar tidak melebihi batas 1MB dokumen Firestore dan tidak hilang saat sinkronisasi.

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

async function waitForFirebase() {
  await firebaseReadyPromise;
  return firebaseInitialized;
}

function questionsCollection() { return firebaseDb.collection('questions'); }
function answersCollection()  { return firebaseDb.collection('answers'); }
function resultsCollection()  { return firebaseDb.collection('results'); }
// ─────────────────────────────────────────────────────────────────────────────
// PENYIMPANAN GAMBAR KE FIRESTORE (collection 'question_images')
// Gambar dikompres via canvas, lalu jika masih besar dipecah ke chunks.
// ─────────────────────────────────────────────────────────────────────────────

function imagesCollection() { return firebaseDb.collection('question_images'); }

const FB_IMG_CHUNK_SIZE = 700 * 1024; // 700 KB per chunk (panjang string base64)

/** Kompres gambar base64 via canvas browser */
async function compressImageDataUri(dataUri, maxWidth = 900, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const result = canvas.toDataURL('image/jpeg', quality);
      resolve(result);
    };
    img.onerror = () => resolve(dataUri);
    img.src = dataUri;
  });
}

/** Simpan gambar ke Firestore — kompres dulu, lalu chunk jika perlu */
async function saveImageToFirestore(subject, indexId, dataUri) {
  if (!dataUri) return;
  const safeKey = `${subject.replace(/[^a-zA-Z0-9]/g, '_')}_img_${indexId}`;
  try {
    const compressed = await compressImageDataUri(dataUri, 900, 0.65);
    const bytes = compressed.length;
    if (bytes <= FB_IMG_CHUNK_SIZE) {
      // Ukuran aman — simpan langsung
      await imagesCollection().doc(safeKey).set({
        subject, indexId,
        dataUri: compressed,
        chunks: 1,
        updatedAt: Date.now()
      });
    } else {
      // Pecah ke chunks
      const totalChunks = Math.ceil(bytes / FB_IMG_CHUNK_SIZE);
      const batch = firebaseDb.batch();
      batch.set(imagesCollection().doc(safeKey), {
        subject, indexId, chunks: totalChunks, updatedAt: Date.now()
      });
      for (let c = 0; c < totalChunks; c++) {
        const chunkData = compressed.slice(c * FB_IMG_CHUNK_SIZE, (c + 1) * FB_IMG_CHUNK_SIZE);
        batch.set(imagesCollection().doc(`${safeKey}_c${c}`), {
          parentKey: safeKey, chunkIndex: c, data: chunkData
        });
      }
      await batch.commit();
    }
    // Simpan juga ke IDB lokal sebagai cache
    await saveImageToIDB(subject, indexId, compressed).catch(() => {});
  } catch (err) {
    console.warn('saveImageToFirestore gagal, fallback ke IDB:', err);
    await saveImageToIDB(subject, indexId, dataUri).catch(() => {});
  }
}

/** Ambil gambar dari Firestore (coba cache IDB dulu) */
async function getImageFromFirestore(subject, indexId) {
  // 1. Coba dari cache IDB lokal dulu (lebih cepat)
  try {
    const cached = await getImageFromIDB(subject, indexId);
    if (cached) return cached;
  } catch (_) {}

  // 2. Ambil dari Firestore
  const safeKey = `${subject.replace(/[^a-zA-Z0-9]/g, '_')}_img_${indexId}`;
  try {
    const doc = await imagesCollection().doc(safeKey).get();
    if (!doc.exists) return null;
    const data = doc.data();
    let dataUri = null;
    if (data.chunks === 1 && data.dataUri) {
      dataUri = data.dataUri;
    } else if (data.chunks > 1) {
      const parts = [];
      for (let c = 0; c < data.chunks; c++) {
        const chunkDoc = await imagesCollection().doc(`${safeKey}_c${c}`).get();
        if (chunkDoc.exists) parts.push(chunkDoc.data().data);
      }
      dataUri = parts.join('');
    }
    // Simpan ke IDB lokal sebagai cache untuk request berikutnya
    if (dataUri) await saveImageToIDB(subject, indexId, dataUri).catch(() => {});
    return dataUri;
  } catch (err) {
    console.warn('getImageFromFirestore gagal:', err);
    return null;
  }
}

/** Hapus gambar satu subject dari Firestore */
async function clearImagesForSubjectFirestore(subject) {
  try {
    const snapshot = await imagesCollection().where('subject', '==', subject).get();
    if (snapshot.empty) return;
    const BATCH = 400;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = firebaseDb.batch();
      for (const doc of docs.slice(i, i + BATCH)) {
        batch.delete(doc.ref);
        const d = doc.data();
        if (d.chunks > 1) {
          for (let c = 0; c < d.chunks; c++)
            batch.delete(imagesCollection().doc(`${doc.id}_c${c}`));
        }
      }
      await batch.commit();
    }
  } catch (err) { console.warn('clearImagesForSubjectFirestore:', err); }
}

/** Hapus semua gambar dari Firestore */
async function clearAllImagesFirestore() {
  try {
    const snapshot = await imagesCollection().get();
    if (snapshot.empty) return;
    const BATCH = 400;
    const docs = snapshot.docs;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = firebaseDb.batch();
      docs.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (err) { console.warn('clearAllImagesFirestore:', err); }
}



function safeDocId(subject, index, suffix = '') {
  return `${subject.replace(/[^a-zA-Z0-9]/g, '_')}_${index}${suffix}`;
}

// ─── Kunci gambar untuk IndexedDB images store ───────────────────────────────
// Format: "subject||indexId"  (pakai separator yang tidak mungkin ada di subject)
function imageKey(subject, indexId) {
  return `${subject}||${indexId}`;
}

// ─── IndexedDB ───────────────────────────────────────────────────────────────
// Versi DB dinaikkan ke 4 agar store 'images' otomatis dibuat di browser yang
// sudah punya versi lama.

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('OlimpiadeAnnurDB', 4);
    request.onerror = (event) => reject('Gagal membuka database: ' + event.target.error);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Hapus store lama supaya schema bersih
      ['questions', 'answers', 'results', 'images'].forEach(name => {
        if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      });
      db.createObjectStore('questions', { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('answers',   { keyPath: 'id', autoIncrement: true });
      db.createObjectStore('results',   { keyPath: 'id', autoIncrement: true });
      // Store khusus gambar — key = "subject||indexId", value = data URI base64
      db.createObjectStore('images',    { keyPath: 'imgKey' });
    };
  });
}

// ── Simpan satu gambar ke IndexedDB ──
async function saveImageToIDB(subject, indexId, dataUri) {
  if (!dataUri) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images'], 'readwrite');
    tx.objectStore('images').put({ imgKey: imageKey(subject, indexId), dataUri });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// ── Ambil satu gambar dari IndexedDB ──
async function getImageFromIDB(subject, indexId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images'], 'readonly');
    const req = tx.objectStore('images').get(imageKey(subject, indexId));
    req.onsuccess = () => resolve(req.result ? req.result.dataUri : null);
    req.onerror = (e) => reject(e);
  });
}

// ── Hapus semua gambar satu mata pelajaran dari IndexedDB ──
async function clearImagesForSubjectIDB(subject) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images'], 'readwrite');
    const store = tx.objectStore('images');
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.imgKey.startsWith(subject + '||')) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// ── Hapus semua gambar dari IndexedDB ──
async function clearAllImagesIDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images'], 'readwrite');
    tx.objectStore('images').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function saveExamData(subject, questions, answers) {
  const useFirebase = await waitForFirebase();

  // 1. Pisahkan gambar dari metadata soal
  const questionsWithoutImage = questions.map((q) => {
    const { image, ...rest } = q;
    return { ...rest, hasImage: !!image };
  });

  if (useFirebase) {
    // 2a. Firebase: simpan gambar ke Firestore collection 'question_images'
    //     (dikompres + di-chunk jika perlu) + simpan IDB sebagai cache
    await clearImagesForSubjectFirestore(subject).catch(() => {});
    await clearImagesForSubjectIDB(subject).catch(() => {});
    const imgSavePromises = [];
    for (let i = 0; i < questions.length; i++) {
      if (questions[i].image) {
        imgSavePromises.push(saveImageToFirestore(subject, i, questions[i].image));
      }
    }
    await Promise.all(imgSavePromises);
    return saveExamDataFirebase(subject, questionsWithoutImage, answers);
  } else {
    // 2b. Offline: simpan ke IDB dengan gambar lengkap
    await clearImagesForSubjectIDB(subject).catch(() => {});
    for (let i = 0; i < questions.length; i++) {
      if (questions[i].image) {
        await saveImageToIDB(subject, i, questions[i].image).catch(() => {});
      }
    }
    return saveExamDataIndexedDB(subject, questions, answers);
  }
}

async function clearSubjectData(subject) {
  const useFirebase = await waitForFirebase();
  const tasks = [];
  tasks.push(clearSubjectDataIndexedDB(subject).catch(e => console.warn('clearSubjectData IDB:', e)));
  tasks.push(clearImagesForSubjectIDB(subject).catch(e => console.warn('clearImages IDB:', e)));
  if (useFirebase) {
    tasks.push(clearSubjectDataFirebase(subject).catch(e => console.warn('clearSubjectData FB:', e)));
    tasks.push(clearImagesForSubjectFirestore(subject).catch(e => console.warn('clearImages FB:', e)));
  }
  return Promise.all(tasks);
}

async function clearExamData() {
  const useFirebase = await waitForFirebase();
  const tasks = [];
  tasks.push(clearExamDataIndexedDB().catch(e => console.warn('clearExamData IDB:', e)));
  tasks.push(clearAllImagesIDB().catch(e => console.warn('clearImages IDB:', e)));
  if (useFirebase) {
    tasks.push(clearExamDataFirebase().catch(e => console.warn('clearExamData FB:', e)));
    tasks.push(clearAllImagesFirestore().catch(e => console.warn('clearImages FB:', e)));
  }
  return Promise.all(tasks);
}

async function getAvailableSubjects() {
  const useFirebase = await waitForFirebase();
  if (useFirebase) return getAvailableSubjectsFirebase();
  return getAvailableSubjectsIndexedDB();
}

// getQuestions: setelah mengambil soal, inject kembali gambar dari IDB lokal
async function getQuestions(subject) {
  const useFirebase = await waitForFirebase();
  let questions;
  if (useFirebase) {
    questions = await getQuestionsFirebase(subject);
  } else {
    questions = await getQuestionsIndexedDB(subject);
  }

  // Inject gambar: gunakan Firestore (jika Firebase aktif) atau IDB lokal
  const fbActive = await waitForFirebase();
  for (const q of questions) {
    const subj = q.subject || subject;
    const idx  = (typeof q.indexId !== 'undefined') ? q.indexId : 0;
    if (q.hasImage || q.image) {
      let img = null;
      if (fbActive) {
        img = await getImageFromFirestore(subj, idx);
      }
      if (!img) {
        img = await getImageFromIDB(subj, idx).catch(() => null);
      }
      if (img) q.image = img;
    }
  }

  return questions;
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

// ─── IndexedDB implementations ───────────────────────────────────────────────

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

// ─── Firebase implementations ────────────────────────────────────────────────

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
          text: q.text || '',
          options: q.options || [],
          type: q.type || 'free',
          difficulty: q.difficulty || '',
          // PENTING: Tidak simpan field image ke Firestore.
          // hasImage = true berarti gambar ada di IDB lokal.
          hasImage: q.hasImage || false,
          image: null
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