// app.js - Student exam logic for Ujian Olimpiade Annur (Premium Version)

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
  
  // Dashboard elements
  const statSubjects = $('#stat-subjects');
  const statFinished = $('#stat-finished');
  const statAvg = $('#stat-avg');
  const examsGrid = $('#exams-grid');
  
  // CBT elements
  const examForm = $('#exam-form');
  const btnPrev = $('#btn-prev');
  const btnNext = $('#btn-next');
  const btnMark = $('#btn-mark'); // Ragu-ragu button
  const submitBtn = $('#submit-btn');
  const cbtSubjectName = $('#cbt-subject-name');
  
  // State variables for CBT
  let currentSubject = '';
  let currentQuestionIndex = 0;
  let questionsData = [];
  let userAnswers = {};
  let markedQuestions = new Set();
  let timerInterval = null;
  let timeRemaining = 90 * 60; // 90 minutes
  let progressChartInstance = null;
  let ringChartInstance = null;
  
  // 1. Initialize Application
  const savedName = sessionStorage.getItem('studentName');
  if (savedName) {
    studentNameInput.value = savedName;
    loadDashboard(savedName);
  } else {
    show(nameSection);
  }

  // 2. Login Event
  loginBtn.addEventListener('click', () => {
    const name = studentNameInput.value.trim();
    if (!name) {
      alert('Mohon masukkan nama Anda terlebih dahulu.');
      return;
    }
    sessionStorage.setItem('studentName', name);
    loadDashboard(name);
  });

  logoutBtn.addEventListener('click', () => {
    if (!confirm('Anda yakin ingin logout?')) return;
    sessionStorage.removeItem('studentName');
    hide(globalNav);
    hide(dashboardSection);
    hide(examSection);
    hide(resultSection);
    studentNameInput.value = '';
    show(nameSection);
  });

  // 3. Load Dashboard
  async function loadDashboard(name) {
    navStudentName.textContent = name;
    const greetingNameEl = document.getElementById('greeting-name');
    if (greetingNameEl) greetingNameEl.textContent = name;
    show(globalNav);
    hide(nameSection);
    hide(examSection);
    hide(resultSection);
    show(dashboardSection);

    try {
      const subjects = await getAvailableSubjects();
      const allResults = await getAllResults();
      const studentResults = allResults.filter(r => r.name.toLowerCase() === name.toLowerCase());

      // Update Stats
      statSubjects.textContent = subjects.length;
      statFinished.textContent = studentResults.length;
      
      let totalScore = 0;
      studentResults.forEach(r => totalScore += r.score);
      const avg = studentResults.length > 0 ? Math.round(totalScore / studentResults.length) : 0;
      statAvg.textContent = avg;

      // Render Available Exams
      examsGrid.innerHTML = '';
      if (subjects.length === 0) {
        examsGrid.innerHTML = '<p class="text-muted">Belum ada ujian yang tersedia.</p>';
      } else {
        subjects.forEach(subj => {
          const card = document.createElement('div');
          card.className = 'exam-card';
            const alreadyTaken = studentResults.some(r => (r.subject || '').toLowerCase() === (subj || '').toLowerCase());
            card.innerHTML = `
              <div class="exam-info">
                <h4>${subj}</h4>
                <p><i class="fa-solid fa-clock"></i> 90 Menit • <i class="fa-solid fa-file-lines"></i> Pilihan Ganda & Esai</p>
              </div>
              ${alreadyTaken ? `<button class="btn btn-outline" disabled>Sudah Mengerjakan</button>` : `<button class="btn btn-primary start-exam-btn" data-subject="${subj}">Mulai Kerjakan</button>`}
            `;
          examsGrid.appendChild(card);
        });
      }

      // Render Chart
      renderProgressChart(studentResults);

    } catch (err) {
      console.error('Error loading dashboard:', err);
    }
  }

  function renderProgressChart(results) {
    const ctx = document.getElementById('progressChart').getContext('2d');
    if (progressChartInstance) {
      progressChartInstance.destroy();
    }

    if (results.length === 0) {
      document.getElementById('progressChart').style.display = 'none';
      const chartWrapper = document.querySelector('.chart-wrapper');
      let msg = chartWrapper.querySelector('.empty-chart-msg');
      if(!msg) {
        msg = document.createElement('p');
        msg.className = 'empty-chart-msg text-muted';
        msg.style.position = 'absolute';
        msg.style.top = '50%';
        msg.style.left = '50%';
        msg.style.transform = 'translate(-50%, -50%)';
        msg.textContent = 'Belum ada riwayat nilai untuk menampilkan grafik.';
        chartWrapper.appendChild(msg);
      }
      return;
    }

    document.getElementById('progressChart').style.display = 'block';
    const msg = document.querySelector('.empty-chart-msg');
    if(msg) msg.remove();

    const labels = results.map((r, i) => `Ujian ${i+1}`);
    const dataPoints = results.map(r => r.score);

    progressChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Nilai Ujian',
          data: dataPoints,
          borderColor: '#0066CC',
          backgroundColor: 'rgba(0, 102, 204, 0.1)',
          borderWidth: 3,
          tension: 0.3,
          fill: true,
          pointBackgroundColor: '#F2A900',
          pointRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
  }

  // 4. Exam Start Delegation
  examsGrid.addEventListener('click', async (e) => {
    if (e.target.classList.contains('start-exam-btn')) {
      const subject = e.target.getAttribute('data-subject');
      const confirmStart = confirm(`Anda akan memulai ujian untuk mata pelajaran: ${subject}. Waktu Anda 90 menit. Siap?`);
      if (confirmStart) {
        await startExam(subject);
      }
    }
  });

  async function startExam(subject) {
    // Prevent starting if student already has a result for this subject
    const studentName = sessionStorage.getItem('studentName') || '';
    const allResults = await getAllResults();
    const hasTaken = allResults.some(r => r.name.toLowerCase() === studentName.toLowerCase() && (r.subject || '').toLowerCase() === (subject || '').toLowerCase());
    if (hasTaken) {
      alert('Anda sudah pernah mengerjakan mata pelajaran ini. Anda tidak dapat mengulang.');
      return false;
    }

    currentSubject = subject;
    cbtSubjectName.textContent = subject;

    hide(globalNav); // Hide nav for focus
    hide(dashboardSection);

    const questionsLoaded = await renderExamQuestions(subject);
    if (questionsLoaded) {
      show(examSection);
      timeRemaining = 90 * 60;
      startTimer();
      showQuestion(0);
    } else {
      show(globalNav);
      show(dashboardSection);
    }
  }

  function startTimer() {
    const timerEl = $('#time-remaining');
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeRemaining--;
      if (timeRemaining <= 0) {
        clearInterval(timerInterval);
        submitExam(true);
        return;
      }
      const h = Math.floor(timeRemaining / 3600).toString().padStart(2, '0');
      const m = Math.floor((timeRemaining % 3600) / 60).toString().padStart(2, '0');
      const s = (timeRemaining % 60).toString().padStart(2, '0');
      timerEl.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  // 5. CBT Navigation & Logic
  btnPrev.addEventListener('click', (e) => { e.preventDefault(); if (currentQuestionIndex > 0) showQuestion(currentQuestionIndex - 1); });
  btnNext.addEventListener('click', (e) => { e.preventDefault(); if (currentQuestionIndex < questionsData.length - 1) showQuestion(currentQuestionIndex + 1); });
  
  btnMark.addEventListener('click', (e) => {
    e.preventDefault();
    const qId = `q${questionsData[currentQuestionIndex].indexId}`;
    if (markedQuestions.has(qId)) {
      markedQuestions.delete(qId);
    } else {
      markedQuestions.add(qId);
    }
    updateGridUI();
  });

  function showQuestion(index) {
    currentQuestionIndex = index;
    $('#current-q-num').textContent = currentQuestionIndex + 1;
    
    document.querySelectorAll('.question-box').forEach((box, idx) => {
      if (idx === currentQuestionIndex) show(box);
      else hide(box);
    });

    updateGridUI();

    btnPrev.disabled = currentQuestionIndex === 0;
    if (currentQuestionIndex === questionsData.length - 1) {
      hide(btnNext); show(submitBtn);
    } else {
      show(btnNext); hide(submitBtn);
    }
  }

  function updateGridUI() {
    document.querySelectorAll('.q-btn').forEach((btn, idx) => {
      const qId = `q${questionsData[idx].indexId}`;
      btn.className = 'q-btn'; // reset
      if (idx === currentQuestionIndex) btn.classList.add('active');
      if (markedQuestions.has(qId)) btn.classList.add('doubt');
      else if (userAnswers[qId]) btn.classList.add('answered');
    });
  }

  examForm.addEventListener('change', (e) => {
    if (e.target.type === 'radio' || e.target.tagName === 'TEXTAREA') {
      const name = e.target.name;
      userAnswers[name] = e.target.value.trim();
      
      if (e.target.type === 'radio') {
        const optionsList = e.target.closest('.options-list');
        optionsList.querySelectorAll('.option-label').forEach(item => item.classList.remove('selected'));
        e.target.closest('.option-label').classList.add('selected');
      }
      
      // Auto-remove mark if answered (optional UX choice)
      markedQuestions.delete(name);
      updateGridUI();
    }
  });

  examForm.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') {
      const name = e.target.name;
      userAnswers[name] = e.target.value.trim();
      if(userAnswers[name].length > 0) {
         markedQuestions.delete(name);
      }
      updateGridUI();
    }
  });

  // Render Questions into CBT
  async function renderExamQuestions(subject) {
    try {
      questionsData = await getQuestions(subject);
      examForm.innerHTML = '';
      const grid = $('#question-grid');
      grid.innerHTML = '';
      userAnswers = {};
      markedQuestions.clear();

      if (questionsData.length === 0) return false;

      questionsData.forEach((q, index) => {
        // Grid Button
        const gridBtn = document.createElement('button');
        gridBtn.className = 'q-btn';
        gridBtn.textContent = index + 1;
        gridBtn.addEventListener('click', () => showQuestion(index));
        grid.appendChild(gridBtn);

        // Question Box
        const qBox = document.createElement('div');
        qBox.className = 'question-box hidden';
        
        const qTitle = document.createElement('div');
        qTitle.className = 'question-block';
        qTitle.innerHTML = formatQuestionText(q.text);
        qBox.appendChild(qTitle);

        if (q.type === 'multiple' && q.options && q.options.length > 0) {
          const optionsList = document.createElement('div');
          optionsList.className = 'options-list';
          q.options.forEach(opt => {
            const optionItem = document.createElement('label');
            optionItem.className = 'option-label';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `q${q.indexId}`;
            radio.value = opt.letter;
            const optionText = document.createElement('span');
            optionText.textContent = `${opt.letter}. ${opt.text}`;
            optionItem.appendChild(radio);
            optionItem.appendChild(optionText);
            optionsList.appendChild(optionItem);
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
      console.error(error);
      return false;
    }
  }

  // 6. Submission & Results
  submitBtn.addEventListener('click', (e) => { e.preventDefault(); submitExam(false); });

  async function submitExam(isForced) {
    let unansweredCount = 0;
    questionsData.forEach(q => { if (!userAnswers[`q${q.indexId}`]) unansweredCount++; });

    if (!isForced) {
      if (unansweredCount > 0) {
        if (!confirm(`Masih ada ${unansweredCount} soal yang belum dijawab. Yakin ingin mengumpulkan?`)) return;
      } else {
        if (!confirm('Anda sudah menjawab semua soal! Yakin ingin mengumpulkan?')) return;
      }
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
        else if (correctAns === userAns) correctCount++;
      });

      let wrongCount = totalQuestions - correctCount - emptyCount;
      const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
      const studentName = sessionStorage.getItem('studentName') || 'Siswa';

      await saveStudentResult(studentName, currentSubject, userAnswers, score, totalQuestions);

      // Setup Results UI
      hide(examSection);
      show(globalNav);
      show(resultSection);

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

      // Draw Ring Chart
      const ctx = document.getElementById('scoreRingChart').getContext('2d');
      if (ringChartInstance) ringChartInstance.destroy();
      ringChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Benar', 'Salah', 'Kosong'],
          datasets: [{
            data: [correctCount, wrongCount, emptyCount],
            backgroundColor: ['#2E7D32', '#D32F2F', '#E2E8F0'],
            borderWidth: 0
          }]
        },
        options: {
          cutout: '80%',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } }
        }
      });

      // Populate History Table
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
          <td>${r.score >= 60 ? '<span class="badge bg-green" style="font-size:0.75rem; padding:4px 8px;">Lulus</span>' : '<span class="badge bg-red" style="background:#D32F2F; color:white; font-size:0.75rem; padding:4px 8px; border-radius:4px;">Gagal</span>'}</td>
        `;
        tbody.appendChild(tr);
      });

    } catch (error) {
      console.error(error);
      alert('Gagal mengevaluasi ujian.');
    }
  }

  $('#back-dashboard-btn').addEventListener('click', () => {
    const name = sessionStorage.getItem('studentName');
    if (name) {
      loadDashboard(name);
    } else {
      hide(resultSection);
      hide(globalNav);
      show(nameSection);
    }
  });

});

function formatQuestionText(text) {
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
