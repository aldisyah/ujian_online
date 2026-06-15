// app.js - Student exam logic for Ujian Olimpiade Annur

const $ = selector => document.querySelector(selector);
const show = el => { if (el) el.classList.remove('hidden'); };
const hide = el => { if (el) el.classList.add('hidden'); };

document.addEventListener('DOMContentLoaded', async () => {
  const globalNav = $('#global-nav');
  const nameSection = $('#name-section');
  const dashboardSection = $('#dashboard-section');
  const examSection = $('#exam-section');
  const resultSection = $('#result-section');

  const loginBtn = $('#login-btn');
  const studentNameInput = $('#student-name');
  const navStudentName = $('#nav-student-name');
  const logoutBtn = $('#logout-btn');

  const statSubjects = $('#stat-subjects');
  const statFinished = $('#stat-finished');
  const statAvg = $('#stat-avg');
  const examsGrid = $('#exams-grid');

  const examForm = $('#exam-form');
  const btnPrev = $('#btn-prev');
  const btnNext = $('#btn-next');
  const btnMark = $('#btn-mark');
  const submitBtn = $('#submit-btn');
  const cbtSubjectName = $('#cbt-subject-name');

  let currentSubject = '';
  let currentQuestionIndex = 0;
  let questionsData = [];
  let userAnswers = {};
  let markedQuestions = new Set();
  let timerInterval = null;
  let timeRemaining = 45 * 60;
  let progressChartInstance = null;
  let ringChartInstance = null;

  // Tampilkan loading sementara menunggu Firebase siap
  function showLoading(msg) {
    examsGrid.innerHTML = `<p class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> ${msg}</p>`;
  }

  async function checkAndResumeOrLoadDashboard(name) {
    const activeStateStr = localStorage.getItem(`activeExam_${name}`);
    if (activeStateStr) {
      try {
        const state = JSON.parse(activeStateStr);
        await resumeExam(state.subject, state);
      } catch (e) {
        console.error('Failed to parse active exam state', e);
        loadDashboard(name);
      }
    } else {
      loadDashboard(name);
    }
  }

  // 1. Initialize: tunggu Firebase ready sebelum render dashboard
  const savedName = sessionStorage.getItem('studentName');
  if (savedName) {
    studentNameInput.value = savedName;
    show(globalNav);
    hide(nameSection);
    show(dashboardSection);
    showLoading('Menghubungkan ke server...');
    // waitForFirebase didefinisikan di db.js
    await waitForFirebase();
    checkAndResumeOrLoadDashboard(savedName);
  } else {
    show(nameSection);
  }

  // 2. Login
  loginBtn.addEventListener('click', async () => {
    const name = studentNameInput.value.trim();
    if (!name) { alert('Mohon masukkan nama Anda terlebih dahulu.'); return; }
    sessionStorage.setItem('studentName', name);
    show(globalNav);
    hide(nameSection);
    show(dashboardSection);
    showLoading('Menghubungkan ke server...');
    await waitForFirebase();
    checkAndResumeOrLoadDashboard(name);
  });

  // Enter key di input nama
  studentNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', () => {
    if (!confirm('Anda yakin ingin logout?')) return;
    sessionStorage.removeItem('studentName');
    hide(globalNav); hide(dashboardSection); hide(examSection); hide(resultSection);
    studentNameInput.value = '';
    show(nameSection);
  });

  // 3. Load Dashboard
  async function loadDashboard(name) {
    navStudentName.textContent = name;
    const greetingNameEl = document.getElementById('greeting-name');
    if (greetingNameEl) greetingNameEl.textContent = name;
    show(globalNav);
    hide(nameSection); hide(examSection); hide(resultSection);
    show(dashboardSection);

    try {
      const subjects = await getAvailableSubjects();
      const allResults = await getAllResults();
      const studentResults = allResults.filter(r => r.name.toLowerCase() === name.toLowerCase());

      statSubjects.textContent = subjects.length;
      statFinished.textContent = studentResults.length;
      const totalScore = studentResults.reduce((sum, r) => sum + r.score, 0);
      statAvg.textContent = studentResults.length > 0 ? Math.round(totalScore / studentResults.length) : 0;

      examsGrid.innerHTML = '';
      if (subjects.length === 0) {
        examsGrid.innerHTML = '<p class="text-muted">Belum ada ujian yang tersedia.</p>';
      } else {
        subjects.forEach(subj => {
          const card = document.createElement('div');
          card.className = 'exam-card';
          const alreadyTaken = studentResults.some(r =>
            (r.subject || '').toLowerCase() === (subj || '').toLowerCase()
          );
          card.innerHTML = `
            <div class="exam-info">
              <h4>${subj}</h4>
              <p><i class="fa-solid fa-clock"></i> 45 Menit &nbsp;•&nbsp; <i class="fa-solid fa-file-lines"></i> Pilihan Ganda &amp; Esai</p>
            </div>
            ${alreadyTaken
              ? `<button class="btn btn-outline" disabled>✅ Sudah Mengerjakan</button>`
              : `<button class="btn btn-primary start-exam-btn" data-subject="${subj}">Mulai Kerjakan</button>`
            }
          `;
          examsGrid.appendChild(card);
        });
      }

      renderProgressChart(studentResults);
    } catch (err) {
      console.error('Error loading dashboard:', err);
      examsGrid.innerHTML = '<p class="text-muted">Gagal memuat data. Coba refresh halaman.</p>';
    }
  }

  function renderProgressChart(results) {
    const canvas = document.getElementById('progressChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (progressChartInstance) { progressChartInstance.destroy(); progressChartInstance = null; }

    if (results.length === 0) {
      canvas.style.display = 'none';
      const wrapper = document.querySelector('.chart-wrapper');
      if (wrapper && !wrapper.querySelector('.empty-chart-msg')) {
        const msg = document.createElement('p');
        msg.className = 'empty-chart-msg text-muted';
        msg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)';
        msg.textContent = 'Belum ada riwayat nilai.';
        wrapper.appendChild(msg);
      }
      return;
    }

    canvas.style.display = 'block';
    const oldMsg = document.querySelector('.empty-chart-msg');
    if (oldMsg) oldMsg.remove();

    progressChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: results.map((r, i) => `Ujian ${i + 1}`),
        datasets: [{
          label: 'Nilai Ujian',
          data: results.map(r => r.score),
          borderColor: '#0066CC',
          backgroundColor: 'rgba(0,102,204,0.1)',
          borderWidth: 3, tension: 0.3, fill: true,
          pointBackgroundColor: '#F2A900', pointRadius: 5
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }

  // 4. Start Exam
  examsGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.start-exam-btn');
    if (!btn) return;
    const subject = btn.getAttribute('data-subject');
    if (confirm(`Anda akan memulai ujian: ${subject}\nWaktu: 90 menit. Siap?`)) {
      await startExam(subject);
    }
  });

  async function startExam(subject) {
    const studentName = sessionStorage.getItem('studentName') || '';

    // Cek apakah sudah pernah mengerjakan
    const allResults = await getAllResults();
    const hasTaken = allResults.some(r =>
      r.name.toLowerCase() === studentName.toLowerCase() &&
      (r.subject || '').toLowerCase() === (subject || '').toLowerCase()
    );
    if (hasTaken) {
      alert('Anda sudah pernah mengerjakan mata pelajaran ini.');
      return;
    }

    currentSubject = subject;
    cbtSubjectName.textContent = subject;

    hide(globalNav); hide(dashboardSection);
    examForm.innerHTML = '<p style="text-align:center;padding:2rem"><i class="fa-solid fa-spinner fa-spin"></i> Memuat soal...</p>';
    show(examSection);

    const ok = await renderExamQuestions(subject);
    if (ok) {
      timeRemaining = 45 * 60;
      startTimer();
      showQuestion(0);
      saveExamState();
    } else {
      alert('Gagal memuat soal untuk mata pelajaran ini. Silakan hubungi admin.');
      hide(examSection);
      show(globalNav); show(dashboardSection);
    }
  }

  function saveExamState() {
    const studentName = sessionStorage.getItem('studentName') || '';
    if (!studentName || !currentSubject) return;
    const state = {
      subject: currentSubject,
      timeRemaining,
      userAnswers,
      markedQuestions: Array.from(markedQuestions),
      currentQuestionIndex
    };
    localStorage.setItem(`activeExam_${studentName}`, JSON.stringify(state));
  }

  function clearExamState() {
    const studentName = sessionStorage.getItem('studentName') || '';
    localStorage.removeItem(`activeExam_${studentName}`);
  }

  async function resumeExam(subject, state) {
    currentSubject = subject;
    cbtSubjectName.textContent = subject;

    hide(globalNav); hide(dashboardSection);
    examForm.innerHTML = '<p style="text-align:center;padding:2rem"><i class="fa-solid fa-spinner fa-spin"></i> Melanjutkan ujian...</p>';
    show(examSection);

    const ok = await renderExamQuestions(subject);
    if (ok) {
      timeRemaining = state.timeRemaining || (45 * 60);
      userAnswers = state.userAnswers || {};
      markedQuestions = new Set(state.markedQuestions || []);
      
      // Restore checked DOM states for rendering
      Object.keys(userAnswers).forEach(qName => {
        const val = userAnswers[qName];
        const input = document.querySelector(`[name="${qName}"]`);
        if (input) {
          if (input.type === 'radio') {
            const radioToSelect = document.querySelector(`input[name="${qName}"][value="${val}"]`);
            if (radioToSelect) {
              radioToSelect.checked = true;
              radioToSelect.closest('.option-label').classList.add('selected');
            }
          } else if (input.tagName === 'TEXTAREA') {
            input.value = val;
          }
        }
      });

      startTimer();
      showQuestion(state.currentQuestionIndex || 0);
    } else {
      alert('Gagal memuat soal untuk melanjutkan ujian.');
      clearExamState();
      hide(examSection);
      show(globalNav); show(dashboardSection);
      loadDashboard(sessionStorage.getItem('studentName'));
    }
  }

  function startTimer() {
    const timerEl = $('#time-remaining');
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeRemaining--;
      if (timeRemaining <= 0) { clearInterval(timerInterval); submitExam(true); return; }
      const h = Math.floor(timeRemaining / 3600).toString().padStart(2, '0');
      const m = Math.floor((timeRemaining % 3600) / 60).toString().padStart(2, '0');
      const s = (timeRemaining % 60).toString().padStart(2, '0');
      timerEl.textContent = `${h}:${m}:${s}`;
      saveExamState();
    }, 1000);
  }

  // 5. CBT Navigation
  btnPrev.addEventListener('click', (e) => { e.preventDefault(); if (currentQuestionIndex > 0) showQuestion(currentQuestionIndex - 1); });
  btnNext.addEventListener('click', (e) => { e.preventDefault(); if (currentQuestionIndex < questionsData.length - 1) showQuestion(currentQuestionIndex + 1); });

  btnMark.addEventListener('click', (e) => {
    e.preventDefault();
    if (!questionsData[currentQuestionIndex]) return;
    const qId = `q${questionsData[currentQuestionIndex].indexId}`;
    if (markedQuestions.has(qId)) markedQuestions.delete(qId);
    else markedQuestions.add(qId);
    updateGridUI();
    saveExamState();
  });

  function showQuestion(index) {
    currentQuestionIndex = index;
    $('#current-q-num').textContent = index + 1;
    document.querySelectorAll('.question-box').forEach((box, idx) => {
      if (idx === index) show(box); else hide(box);
    });
    updateGridUI();
    btnPrev.disabled = index === 0;
    if (index === questionsData.length - 1) { hide(btnNext); show(submitBtn); }
    else { show(btnNext); hide(submitBtn); }
    saveExamState();
  }

  function updateGridUI() {
    document.querySelectorAll('.q-btn').forEach((btn, idx) => {
      const q = questionsData[idx];
      if (!q) return;
      const qId = `q${q.indexId}`;
      btn.className = 'q-btn';
      if (idx === currentQuestionIndex) btn.classList.add('active');
      if (markedQuestions.has(qId)) btn.classList.add('doubt');
      else if (userAnswers[qId]) btn.classList.add('answered');
    });
  }

  examForm.addEventListener('change', (e) => {
    if (e.target.type === 'radio') {
      const name = e.target.name;
      userAnswers[name] = e.target.value.trim();
      e.target.closest('.options-list').querySelectorAll('.option-label').forEach(lbl => lbl.classList.remove('selected'));
      e.target.closest('.option-label').classList.add('selected');
      markedQuestions.delete(name);
      updateGridUI();
      saveExamState();
    }
  });

  examForm.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') {
      const name = e.target.name;
      userAnswers[name] = e.target.value.trim();
      if (userAnswers[name].length > 0) markedQuestions.delete(name);
      updateGridUI();
      saveExamState();
    }
  });

  // Render soal ke CBT
  async function renderExamQuestions(subject) {
    try {
      questionsData = await getQuestions(subject);
      examForm.innerHTML = '';
      const grid = $('#question-grid');
      grid.innerHTML = '';
      userAnswers = {};
      markedQuestions.clear();

      if (!questionsData || questionsData.length === 0) {
        console.warn('Tidak ada soal untuk subject:', subject);
        return false;
      }

      questionsData.forEach((q, index) => {
        // Tombol navigasi grid
        const gridBtn = document.createElement('button');
        gridBtn.type = 'button';
        gridBtn.className = 'q-btn';
        gridBtn.textContent = index + 1;
        gridBtn.addEventListener('click', () => showQuestion(index));
        grid.appendChild(gridBtn);

        // Kotak soal
        const qBox = document.createElement('div');
        qBox.className = 'question-box hidden';

        const qTitle = document.createElement('div');
        qTitle.className = 'question-block';
        qTitle.innerHTML = formatQuestionText(q.text);
        qBox.appendChild(qTitle);

        if (q.image) {
          const wrapper = document.createElement('div');
          wrapper.className = 'question-image-wrapper';
          const loadingMsg = document.createElement('p');
          loadingMsg.className = 'img-loading-msg';
          loadingMsg.textContent = '⏳ Memuat gambar...';
          wrapper.appendChild(loadingMsg);
          const img = document.createElement('img');
          img.alt = `Gambar Soal ${index + 1}`;
          img.className = 'question-image';
          img.style.display = 'none';
          img.onload = () => {
            loadingMsg.remove();
            img.style.display = 'block';
          };
          img.onerror = () => {
            loadingMsg.textContent = '⚠️ Gambar tidak dapat dimuat.';
          };
          img.src = q.image;
          wrapper.appendChild(img);
          qBox.appendChild(wrapper);
        }

        if (q.type === 'multiple' && q.options && q.options.length > 0) {
          const optionsList = document.createElement('div');
          optionsList.className = 'options-list';
          q.options.forEach(opt => {
            const label = document.createElement('label');
            label.className = 'option-label';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `q${q.indexId}`;
            radio.value = opt.letter;
            const span = document.createElement('span');
            span.textContent = `${opt.letter}. ${opt.text}`;
            label.appendChild(radio);
            label.appendChild(span);
            optionsList.appendChild(label);
          });
          qBox.appendChild(optionsList);
        } else {
          const textarea = document.createElement('textarea');
          textarea.name = `q${q.indexId}`;
          textarea.className = 'form-control mt-3';
          textarea.rows = 5;
          textarea.placeholder = 'Ketik jawaban Anda di sini...';
          qBox.appendChild(textarea);
        }

        examForm.appendChild(qBox);
      });

      return true;
    } catch (error) {
      console.error('renderExamQuestions error:', error);
      return false;
    }
  }

  // 6. Submit
  submitBtn.addEventListener('click', (e) => { e.preventDefault(); submitExam(false); });

  async function submitExam(isForced) {
    const unansweredCount = questionsData.filter(q => !userAnswers[`q${q.indexId}`]).length;
    if (!isForced) {
      const msg = unansweredCount > 0
        ? `Masih ada ${unansweredCount} soal yang belum dijawab. Yakin ingin mengumpulkan?`
        : 'Anda sudah menjawab semua soal! Yakin ingin mengumpulkan?';
      if (!confirm(msg)) return;
    }
    clearInterval(timerInterval);
    submitBtn.textContent = 'Menyimpan...';
    submitBtn.disabled = true;
    await evaluateAndShowResults();
  }

  async function evaluateAndShowResults() {
    try {
      const correctAnswers = await getCorrectAnswers(currentSubject);
      let correctCount = 0;
      let emptyCount = 0;
      const totalQuestions = questionsData.length;

      questionsData.forEach(q => {
        const qKey = `q${q.indexId}`;
        const userAns = (userAnswers[qKey] || '').trim().toLowerCase();
        const correctAns = (correctAnswers[qKey] || '').trim().toLowerCase();
        if (!userAns) emptyCount++;
        else if (correctAns && correctAns === userAns) correctCount++;
      });

      const wrongCount = totalQuestions - correctCount - emptyCount;
      const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
      const studentName = sessionStorage.getItem('studentName') || 'Siswa';

      await saveStudentResult(studentName, currentSubject, userAnswers, score, totalQuestions);
      clearExamState();

      hide(examSection); show(globalNav); show(resultSection);

      $('#final-score-text').textContent = score;
      $('#result-correct').textContent = correctCount;
      $('#result-wrong').textContent = wrongCount;
      $('#result-empty').textContent = emptyCount;
      $('#result-total').textContent = totalQuestions;

      let feedback = '';
      if (score === 100) feedback = '🏆 Luar Biasa! Nilai Sempurna!';
      else if (score >= 80) feedback = '🌟 Hebat! Hasil yang sangat baik.';
      else if (score >= 60) feedback = '👍 Cukup Bagus! Terus tingkatkan belajar Anda.';
      else feedback = '💪 Jangan menyerah, jadikan ini sebagai pengalaman belajar!';
      $('#score-feedback').textContent = feedback;

      const ctx = document.getElementById('scoreRingChart').getContext('2d');
      if (ringChartInstance) { ringChartInstance.destroy(); ringChartInstance = null; }
      ringChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Benar', 'Salah', 'Kosong'],
          datasets: [{ data: [correctCount, wrongCount, emptyCount], backgroundColor: ['#2E7D32', '#D32F2F', '#E2E8F0'], borderWidth: 0 }]
        },
        options: { cutout: '80%', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      const allResults = await getAllResults();
      const studentHistory = allResults.filter(r => r.name.toLowerCase() === studentName.toLowerCase());
      const tbody = $('#studentHistoryTable tbody');
      tbody.innerHTML = '';
      studentHistory.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${r.timestamp.split(' ')[0]}</td>
          <td>${r.subject}</td>
          <td><strong>${r.score}</strong></td>
          <td>${r.score >= 60
            ? '<span class="badge bg-green" style="font-size:.75rem;padding:4px 8px;">Lulus</span>'
            : '<span class="badge bg-red" style="background:#D32F2F;color:white;font-size:.75rem;padding:4px 8px;border-radius:4px;">Gagal</span>'
          }</td>
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error('evaluateAndShowResults error:', error);
      alert('Gagal mengevaluasi ujian. Silakan coba lagi.');
      submitBtn.textContent = '🎉 Selesai Ujian';
      submitBtn.disabled = false;
    }
  }

  $('#back-dashboard-btn').addEventListener('click', () => {
    const name = sessionStorage.getItem('studentName');
    if (name) loadDashboard(name);
    else { hide(resultSection); hide(globalNav); show(nameSection); }
  });
});

function formatQuestionText(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let resultHtml = '';
  let inCodeBlock = false;
  lines.forEach(line => {
    const isCodeLine = /^\s*(?:[a-zA-Z_]\w*\s*=|\bprint\b|\bif\b|\belif\b|\belse\b|\bfor\b|\bwhile\b)/.test(line) || line.startsWith('   ') || line.startsWith('\t');
    if (isCodeLine) {
      if (!inCodeBlock) { resultHtml += '<pre class="code-block"><code>'; inCodeBlock = true; }
      resultHtml += escapeHtml(line) + '\n';
    } else {
      if (inCodeBlock) { resultHtml += '</code></pre>'; inCodeBlock = false; }
      if (line.trim().length > 0) resultHtml += `<p class="question-text-line">${escapeHtml(line)}</p>`;
    }
  });
  if (inCodeBlock) resultHtml += '</code></pre>';
  return resultHtml;
}

function escapeHtml(string) {
  return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}