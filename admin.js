// admin.js - Admin page script for Olimpiade Annur

// Convert Mammoth HTML structure to clean lines
function htmlToLines(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  const blockTags = ['p', 'li', 'tr', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'br'];
  blockTags.forEach(tag => {
    const elements = temp.getElementsByTagName(tag);
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const nl = document.createTextNode('\n');
      el.parentNode.insertBefore(nl, el);
    }
  });

  const text = temp.textContent || temp.innerText || '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  return lines;
}

// Extract all answer keys from a single text string
function extractKeysFromText(text, answers) {
  const keyRegex = /(\d+)[\.\)]\s*([A-Ea-e])\b/g;
  let match;
  let count = 0;
  while ((match = keyRegex.exec(text)) !== null) {
    const qNum = parseInt(match[1], 10) - 1;
    const letter = match[2].toUpperCase();
    answers[`q${qNum}`] = letter;
    count++;
  }
  return count;
}

// Parses lines from Word file to separate questions and their options/answers
function parseDocxLines(lines) {
  const questions = [];
  const answers = {};
  let currentQuestion = null;
  let isKeySection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const bulkKeyHeaderMatch = line.match(/^kunci\s*jawaban\s*:?\s*$/i);
    if (bulkKeyHeaderMatch) {
      isKeySection = true;
      continue;
    }

    if (isKeySection) {
      extractKeysFromText(line, answers);
      continue;
    }

    const inlineKeyMatch = line.match(/^kunci\s*jawaban\s*[:]\s*(.+)$/i);
    const inlineAnsMatch = !inlineKeyMatch ? line.match(/^(Jawaban|Kunci)\s*[:]\s*(.+)$/i) : null;

    if (inlineKeyMatch) {
      const ansText = inlineKeyMatch[1].trim();
      if (currentQuestion) {
        const singleLetterMatch = ansText.match(/^([A-E])(?:[.\s,]|$)/i);
        answers[`q${currentQuestion.id}`] = singleLetterMatch ? singleLetterMatch[1].toUpperCase() : ansText;
      }
      continue;
    }

    if (inlineAnsMatch) {
      const ansText = inlineAnsMatch[2].trim();
      if (currentQuestion) {
        const singleLetterMatch = ansText.match(/^([A-E])(?:[.\s,]|$)/i);
        answers[`q${currentQuestion.id}`] = singleLetterMatch ? singleLetterMatch[1].toUpperCase() : ansText;
      }
      continue;
    }

    const questionMatch = line.match(/^(\d+)[\.)\s]\s*(.+)$/);
    if (questionMatch) {
      const qNum = parseInt(questionMatch[1], 10) - 1;
      let qText = questionMatch[2].trim();

      let difficulty = '';
      const diffMatch = qText.match(/^\[(Low|Medium|High|Easy|Hard|Mudah|Sedang|Sulit)\]\s*/i);
      if (diffMatch) {
        difficulty = diffMatch[1];
        qText = qText.substring(diffMatch[0].length).trim();
      }

      currentQuestion = {
        id: qNum,
        text: qText,
        type: 'free',
        options: [],
        difficulty: difficulty
      };
      questions.push(currentQuestion);
      continue;
    }

    const optionMatch = line.match(/^([A-E])[\.)\s]\s*(.*)$/i);
    if (optionMatch && currentQuestion) {
      const optLetter = optionMatch[1].toUpperCase();
      const optText = optionMatch[2].trim();
      currentQuestion.options.push({ letter: optLetter, text: optText });
      currentQuestion.type = 'multiple';
      continue;
    }

    if (currentQuestion && currentQuestion.options.length === 0) {
      currentQuestion.text += '\n' + lines[i];
    }
  }

  const normalizedQuestions = [];
  const normalizedAnswers = {};

  questions.forEach((q, idx) => {
    const oldId = q.id;
    q.id = idx; // temp id, replaced by db
    normalizedQuestions.push(q);
    const correctLetter = answers[`q${oldId}`] || answers[`q${idx}`] || '';
    normalizedAnswers[`q${idx}`] = correctLetter;
  });

  return { questions: normalizedQuestions, answers: normalizedAnswers };
}

// Render student results in the dashboard table
async function loadResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody) return;

  try {
    const results = await getAllResults();
    if (results.length === 0) {
      resultsBody.innerHTML = `<tr><td colspan="6" class="empty-state text-center py-4"><i class="fa-solid fa-inbox text-muted fa-2x mb-2 d-block"></i> Belum ada siswa yang mengerjakan ujian.</td></tr>`;
      return;
    }

    resultsBody.innerHTML = '';
    results.forEach((res, index) => {
      const tr = document.createElement('tr');
      const nilai = res.score;
      
      let answerDetails = '';
      if (res.answers) {
        answerDetails = Object.keys(res.answers).map(key => {
          return `${key.replace('q', 'Soal ')}: ${res.answers[key]}`;
        }).join(', ');
      }

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="student-name">${res.name}</td>
        <td><span class="badge badge-info" style="background:#17a2b8; color:#fff; padding:0.2rem 0.5rem; border-radius:4px;">${res.subject || '-'}</span></td>
        <td><span class="badge score-badge">${nilai} / 100</span></td>
        <td>${res.timestamp}</td>
        <td class="details-column" title="${answerDetails}">${(answerDetails.length > 50 ? answerDetails.substring(0, 50) + '...' : answerDetails) || '-'}</td>
      `;
      resultsBody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error loading results:', error);
  }
}

// Load subjects into filter dropdown
async function loadSubjectFilter() {
  const filterSubject = document.getElementById('filterSubject');
  if (!filterSubject) return;

  try {
    const subjects = await getAvailableSubjects();
    const currentVal = filterSubject.value;
    
    filterSubject.innerHTML = '<option value="">-- Semua Mapel --</option>';
    subjects.forEach(subj => {
      filterSubject.innerHTML += `<option value="${subj}">${subj}</option>`;
    });
    
    if (subjects.includes(currentVal)) {
      filterSubject.value = currentVal;
    }
  } catch (error) {
    console.error('Error loading filter subjects:', error);
  }
}

// Render questions and keys inside the admin dashboard
async function loadQuestionsPreview() {
  const container = document.getElementById('questionsPreview');
  const filterSubject = document.getElementById('filterSubject');
  if (!container) return;

  try {
    const selectedSubject = filterSubject ? filterSubject.value : '';
    const questions = await getQuestions(selectedSubject || null);
    const correctAnswers = await getCorrectAnswers(selectedSubject || null);

    if (questions.length === 0) {
      container.innerHTML = `<p class="empty-state"><i class="fa-solid fa-folder-open text-muted fa-3x mb-2 d-block"></i>Belum ada soal ujian di database.</p>`;
      return;
    }

    container.innerHTML = '';
    questions.forEach((q, idx) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'q-preview-item';
      
      const correctAns = correctAnswers[`q${q.indexId}`] || '-';
      
      let optionsHtml = '';
      if (q.type === 'multiple' && q.options) {
        optionsHtml = `<ul class="q-preview-options">` + 
          q.options.map(opt => `<li><strong>${opt.letter}:</strong> ${opt.text}</li>`).join('') +
          `</ul>`;
      }

      let diffBadge = '';
      if (q.difficulty) {
        const diffClass = q.difficulty.toLowerCase();
        diffBadge = `<span class="badge badge-diff-${diffClass}">${q.difficulty}</span>`;
      }
      
      let subjBadge = `<span class="badge" style="background:#6c757d; color:#fff; font-size:0.7rem; padding:0.15rem 0.5rem; border-radius:4px; margin-right:5px;">${q.subject}</span>`;

      qDiv.innerHTML = `
        <div class="q-preview-title">
          <strong>${q.indexId + 1}.</strong> ${subjBadge} ${q.text} <span class="badge ${q.type === 'multiple' ? 'badge-mc' : 'badge-free'}">${q.type}</span> ${diffBadge}
        </div>
        ${optionsHtml}
        <div class="q-preview-key">
          <strong>Kunci Jawaban:</strong> <span class="key-value">${correctAns}</span>
        </div>
      `;
      container.appendChild(qDiv);
    });
  } catch (error) {
    console.error('Error loading questions preview:', error);
  }
}

// Trigger CSV download of results
async function exportResultsToCSV() {
  try {
    const results = await getAllResults();
    if (results.length === 0) {
      alert('Tidak ada data hasil ujian untuk diekspor.');
      return;
    }

    const csvRows = [];
    csvRows.push(['No', 'Nama Siswa', 'Mata Pelajaran', 'Nilai', 'Total Soal', 'Tanggal Pengerjaan', 'Detail Jawaban']);

    results.forEach((res, index) => {
      let answerDetails = '';
      if (res.answers) {
        answerDetails = Object.keys(res.answers).map(key => {
          return `${key.replace('q', 'Soal ')}: ${res.answers[key]}`;
        }).join('; ');
      }
      csvRows.push([
        index + 1,
        res.name,
        res.subject || 'Umum',
        res.score,
        res.total,
        res.timestamp,
        answerDetails
      ]);
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + csvRows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Hasil_Olimpiade_Annur_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Error exporting CSV:', error);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const subjectInput = document.getElementById('subjectInput');
  const fileDisplay = document.getElementById('file-name-display');
  const processBtn = document.getElementById('processBtn');
  const statusDiv = document.getElementById('status');
  const exportBtn = document.getElementById('exportBtn');
  const clearResultsBtn = document.getElementById('clearResultsBtn');
  const clearQuestionsBtn = document.getElementById('clearQuestionsBtn');
  const filterSubject = document.getElementById('filterSubject');
  const menuItems = document.querySelectorAll('.menu-item[data-target]');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Tab Switching Logic
  menuItems.forEach(menu => {
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      // Remove active from all
      menuItems.forEach(m => m.classList.remove('active'));
      tabPanes.forEach(t => t.classList.remove('active'));
      
      // Add active to clicked
      menu.classList.add('active');
      const targetId = menu.getAttribute('data-target');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // Load initial data
  loadSubjectFilter();
  loadResultsTable();
  loadQuestionsPreview();

  // Filter change
  if (filterSubject) {
    filterSubject.addEventListener('change', () => {
      loadQuestionsPreview();
    });
  }

  // Show file name on select
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) {
        fileDisplay.textContent = file.name;
        fileDisplay.classList.add('selected');
      } else {
        fileDisplay.textContent = 'Belum ada file terpilih';
        fileDisplay.classList.remove('selected');
      }
    });
  }

  // Process and save questions
  if (processBtn) {
    processBtn.addEventListener('click', () => {
      const subject = subjectInput.value.trim();
      const file = fileInput.files[0];
      
      if (!subject) {
        statusDiv.textContent = 'Silakan isi nama Mata Pelajaran.';
        statusDiv.className = 'status-msg error';
        subjectInput.focus();
        return;
      }
      
      if (!file) {
        statusDiv.textContent = 'Silakan pilih file Word (.docx) terlebih dahulu.';
        statusDiv.className = 'status-msg error';
        return;
      }

      statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sedang membaca dan memproses dokumen...';
      statusDiv.className = 'status-msg processing';

      const reader = new FileReader();
      reader.onload = function(event) {
        const arrayBuffer = event.target.result;
        
        mammoth.convertToHtml({ arrayBuffer: arrayBuffer })
          .then(async (result) => {
            const html = result.value;
            const lines = htmlToLines(html);
            const { questions, answers } = parseDocxLines(lines);

            if (questions.length === 0) {
              statusDiv.textContent = 'Tidak ditemukan soal di dalam dokumen. Pastikan format file benar.';
              statusDiv.className = 'status-msg error';
              return;
            }

            let statusMessage = '';
            let statusClass = 'success';

            if (questions.length !== Object.keys(answers).length) {
              statusMessage = `Peringatan: Jumlah soal (${questions.length}) tidak sama dengan jumlah jawaban (${Object.keys(answers).length}). `;
              statusClass = 'warning';
            }

            // Save to IndexedDB with subject
            await saveExamData(subject, questions, answers);
            statusDiv.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${statusMessage} Berhasil mengunggah ${questions.length} soal untuk mapel <strong>${subject}</strong>.`;
            statusDiv.className = `status-msg ${statusClass}`;
            
            // Reload filters and views
            await loadSubjectFilter();
            if (filterSubject) filterSubject.value = subject;
            loadQuestionsPreview();
            
            // Clear inputs
            fileInput.value = '';
            fileDisplay.textContent = 'Belum ada file terpilih';
            fileDisplay.classList.remove('selected');
          })
          .catch(err => {
            console.error(err);
            statusDiv.textContent = 'Error parsing .docx: ' + err.message;
            statusDiv.className = 'status-msg error';
          });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportResultsToCSV);
  }

  if (clearResultsBtn) {
    clearResultsBtn.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin menghapus semua data hasil pengerjaan siswa?')) {
        await clearAllResults();
        loadResultsTable();
      }
    });
  }

  if (clearQuestionsBtn) {
    clearQuestionsBtn.addEventListener('click', async () => {
      const selectedSubject = filterSubject ? filterSubject.value : '';
      let msg = selectedSubject 
        ? `Apakah Anda yakin ingin menghapus soal untuk mapel ${selectedSubject}?` 
        : 'Apakah Anda yakin ingin menghapus SEMUA soal dari semua mapel?';
        
      if (confirm(msg)) {
        if (selectedSubject) {
          await clearSubjectData(selectedSubject);
          statusDiv.innerHTML = `<i class="fa-solid fa-trash"></i> Soal mapel ${selectedSubject} dihapus.`;
        } else {
          await clearExamData();
          statusDiv.innerHTML = `<i class="fa-solid fa-trash"></i> Semua soal dan kunci jawaban telah dihapus.`;
        }
        statusDiv.className = 'status-msg warning';
        await loadSubjectFilter();
        loadQuestionsPreview();
      }
    });
  }
});
