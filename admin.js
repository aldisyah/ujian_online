// admin.js - Admin page script for Olimpiade Annur

// Convert Mammoth HTML structure to clean lines and keep image markers
function htmlToLines(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  const images = temp.getElementsByTagName('img');
  for (let i = images.length - 1; i >= 0; i--) {
    const img = images[i];
    // Beri newline sebelum dan sesudah marker agar selalu di baris sendiri
    const markerText = `\n[[IMG:${img.src}]]\n`;
    const markerNode = document.createTextNode(markerText);
    img.parentNode.insertBefore(markerNode, img);
    img.parentNode.removeChild(img);
  }

  const blockTags = ['p', 'li', 'tr', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'br'];
  blockTags.forEach(tag => {
    const elements = temp.getElementsByTagName(tag);
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      el.parentNode.insertBefore(document.createTextNode('\n'), el);
    }
  });

  const text = temp.textContent || temp.innerText || '';
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

// Extract answer keys dari teks bulk "1. A  2. B  ..."
function extractKeysFromText(text, answers) {
  const keyRegex = /(\d+)[\.\)]\s*([A-Ea-e])\b/g;
  let match;
  let count = 0;
  while ((match = keyRegex.exec(text)) !== null) {
    const qNum = parseInt(match[1], 10) - 1;
    answers[`q${qNum}`] = match[2].toUpperCase();
    count++;
  }
  return count;
}

/**
 * Ekstrak marker gambar dari dalam teks, kembalikan { text, imageUri }
 * Menangani kasus gambar embedded di tengah teks soal.
 */
function extractImgFromText(text) {
  const imgRe = /\[\[IMG:(data:[^[\]]+)\]\]/gi;
  let imageUri = null;
  const cleanText = text.replace(imgRe, (match, uri) => {
    if (!imageUri) imageUri = uri.trim();
    return '';
  }).replace(/\s{2,}/g, ' ').trim();
  return { text: cleanText, imageUri };
}

/**
 * Parser utama: mengubah array lines hasil htmlToLines() menjadi { questions, answers }
 * Mendukung dua format soal di Word:
 *   Format A (list/ol/ul) — ditangani parseDocxHtml terlebih dahulu
 *   Format B (paragraf biasa):
 *     1. Teks soal
 *     A. Pilihan A
 *     B. Pilihan B
 *     ...
 *     Kunci Jawaban: A
 */
function parseDocxLines(lines) {
  const questions = [];
  const answers = {};
  let currentQuestion = null;
  let pendingImage = null;
  let isKeySection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // --- Gambar inline (baris murni marker, setelah newline dipisah di htmlToLines) ---
    const imgMatch = line.match(/^\[\[IMG:(data:[^[\]]+)\]\]$/i);
    if (imgMatch) {
      const uri = imgMatch[1].trim();
      if (currentQuestion && !currentQuestion.image) currentQuestion.image = uri;
      else if (!currentQuestion) pendingImage = uri;
      continue;
    }

    // --- Blok kunci jawaban (bulk) ---
    if (/^kunci\s*jawaban\s*:?\s*$/i.test(line)) {
      isKeySection = true;
      continue;
    }
    if (isKeySection) {
      // Baris seperti "1. A   2. B   3. C ..."
      const extracted = extractKeysFromText(line, answers);
      // Jika tidak ada pattern nomor, mungkin sudah keluar dari seksi ini
      if (extracted === 0 && /^\d/.test(line)) isKeySection = false;
      else continue;
    }

    // --- Kunci jawaban inline per soal ---
    const inlineKeyMatch = line.match(/^kunci\s*jawaban\s*[:\s]+(.+)$/i);
    if (inlineKeyMatch) {
      if (currentQuestion) {
        const ansText = inlineKeyMatch[1].trim();
        const m = ansText.match(/^([A-E])(?:[.\s,]|$)/i);
        answers[`q${currentQuestion.id}`] = m ? m[1].toUpperCase() : ansText.toUpperCase();
      }
      continue;
    }
    const inlineJawaban = line.match(/^(?:Jawaban|Kunci)\s*[:\s]+(.+)$/i);
    if (inlineJawaban) {
      if (currentQuestion) {
        const ansText = inlineJawaban[1].trim();
        const m = ansText.match(/^([A-E])(?:[.\s,]|$)/i);
        answers[`q${currentQuestion.id}`] = m ? m[1].toUpperCase() : ansText.toUpperCase();
      }
      continue;
    }

    // --- Nomor soal: "1." atau "1)" atau "1 " ---
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

      // Bersihkan marker gambar yang mungkin ikut dalam teks soal
      const qExtracted = extractImgFromText(qText);
      qText = qExtracted.text;
      const qInlineImg = qExtracted.imageUri;

      currentQuestion = {
        id: qNum,
        text: qText,
        type: 'free',
        options: [],
        difficulty: difficulty,
        image: qInlineImg || pendingImage || null
      };
      pendingImage = null;
      questions.push(currentQuestion);
      continue;
    }

    // --- Pilihan jawaban: "A." "B)" "A " ---
    const optionMatch = line.match(/^([A-E])[\.)\s]\s*(.+)$/i);
    if (optionMatch && currentQuestion) {
      const optLetter = optionMatch[1].toUpperCase();
      const optText = optionMatch[2].trim();
      // Hindari duplikat huruf
      if (!currentQuestion.options.find(o => o.letter === optLetter)) {
        currentQuestion.options.push({ letter: optLetter, text: optText });
        currentQuestion.type = 'multiple';
      }
      continue;
    }

    // --- Lanjutan teks soal (baris tanpa pola khusus) ---
    if (currentQuestion && currentQuestion.options.length === 0) {
      const contExtracted = extractImgFromText(line);
      if (contExtracted.imageUri && !currentQuestion.image) {
        currentQuestion.image = contExtracted.imageUri;
      }
      if (contExtracted.text) {
        currentQuestion.text += ' ' + contExtracted.text;
      }
    }
  }

  // Normalisasi id soal (0-based berurutan)
  const normalizedQuestions = [];
  const normalizedAnswers = {};
  questions.forEach((q, idx) => {
    const oldId = q.id;
    q.id = idx;
    normalizedQuestions.push(q);
    normalizedAnswers[`q${idx}`] = answers[`q${oldId}`] || answers[`q${idx}`] || '';
  });

  return { questions: normalizedQuestions, answers: normalizedAnswers };
}

/**
 * Parser alternatif untuk dokumen Word yang menggunakan <ol>/<ul> list
 */
function parseDocxHtml(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  const questions = [];
  let questionIndex = 0;

  function normalizeText(text) { return text.replace(/\s+/g, ' ').trim(); }

  function extractImage(node) {
    const img = node.querySelector('img');
    return img ? img.src : null;
  }

  function parseNestedOptions(node) {
    const options = [];
    Array.from(node.children).forEach(child => {
      if (child.tagName === 'OL' || child.tagName === 'UL') {
        Array.from(child.children).forEach(li => {
          if (li.tagName === 'LI') {
            const text = normalizeText(li.textContent || '');
            if (text) options.push(text);
          }
        });
      }
    });
    return options;
  }

  function extractDirectText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('ol, ul').forEach(list => list.remove());
    return normalizeText(clone.textContent || '');
  }

  const lists = temp.querySelectorAll('ol, ul');
  let foundListQuestions = false;
  lists.forEach(list => {
    if (list.closest('li')) return;
    Array.from(list.children).forEach(li => {
      if (li.tagName !== 'LI') return;
      const text = extractDirectText(li);
      if (!text) return;

      const options = parseNestedOptions(li).map((optText, optIndex) => ({
        letter: String.fromCharCode(65 + optIndex),
        text: optText
      }));

      questions.push({
        id: questionIndex,
        text: text,
        type: options.length > 0 ? 'multiple' : 'free',
        options: options,
        image: extractImage(li),
        difficulty: ''
      });
      questionIndex++;
      foundListQuestions = true;
    });
  });

  if (!foundListQuestions) return null;

  // Ekstrak kunci jawaban dari teks HTML
  const lines = htmlToLines(html);
  const answers = {};
  let isKeySection = false;
  for (const line of lines) {
    if (!line) continue;
    if (/^kunci\s*jawaban\s*:?\s*$/i.test(line)) { isKeySection = true; continue; }
    if (isKeySection) { extractKeysFromText(line, answers); continue; }
    const m1 = line.match(/^kunci\s*jawaban\s*[:]\s*(.+)$/i);
    const m2 = !m1 ? line.match(/^(?:Jawaban|Kunci)\s*[:]\s*(.+)$/i) : null;
    if (m1 || m2) {
      const ansText = (m1 ? m1[1] : m2[2]).trim();
      const sl = ansText.match(/^([A-E])(?:[.\s,]|$)/i);
      if (sl) answers[`q${Object.keys(answers).length}`] = sl[1].toUpperCase();
    }
  }

  return { questions, answers };
}

// ─── Render & UI ─────────────────────────────────────────────────────────────

async function loadResultsTable() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody) return;
  try {
    const results = await getAllResults();
    if (results.length === 0) {
      resultsBody.innerHTML = `<tr><td colspan="6" class="empty-state text-center py-4">📭 Belum ada siswa yang mengerjakan ujian.</td></tr>`;
      return;
    }
    resultsBody.innerHTML = '';
    results.forEach((res, index) => {
      const tr = document.createElement('tr');
      let answerDetails = '';
      if (res.answers) {
        answerDetails = Object.keys(res.answers).map(k => `${k.replace('q', 'Soal ')}: ${res.answers[k]}`).join(', ');
      }
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td class="student-name">${res.name}</td>
        <td><span class="badge badge-info" style="background:#17a2b8;color:#fff;padding:.2rem .5rem;border-radius:4px;">${res.subject || '-'}</span></td>
        <td><span class="badge score-badge">${res.score} / 100</span></td>
        <td>${res.timestamp}</td>
        <td class="details-column" title="${answerDetails}">${answerDetails.length > 50 ? answerDetails.substring(0, 50) + '...' : answerDetails || '-'}</td>
      `;
      resultsBody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error loading results:', error);
  }
}

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
    if (subjects.includes(currentVal)) filterSubject.value = currentVal;
  } catch (error) {
    console.error('Error loading filter subjects:', error);
  }
}

async function loadQuestionsPreview() {
  const container = document.getElementById('questionsPreview');
  const filterSubject = document.getElementById('filterSubject');
  if (!container) return;
  try {
    const selectedSubject = filterSubject ? filterSubject.value : '';
    const questions = await getQuestions(selectedSubject || null);
    const correctAnswers = await getCorrectAnswers(selectedSubject || null);

    if (questions.length === 0) {
      container.innerHTML = `<p class="empty-state">📂 Belum ada soal di database.</p>`;
      return;
    }
    container.innerHTML = '';
    questions.forEach((q) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'q-preview-item';
      const correctAns = correctAnswers[`q${q.indexId}`] || '-';
      let optionsHtml = '';
      if (q.type === 'multiple' && q.options && q.options.length > 0) {
        optionsHtml = `<ul class="q-preview-options">` +
          q.options.map(opt => `<li><strong>${opt.letter}:</strong> ${opt.text}</li>`).join('') +
          `</ul>`;
      }
      const imageHtml = q.image ? `<div class="q-preview-image"><img src="${q.image}" alt="Gambar Soal ${q.indexId + 1}" /></div>` : '';
      const subjBadge = `<span class="badge" style="background:#6c757d;color:#fff;font-size:.7rem;padding:.15rem .5rem;border-radius:4px;margin-right:5px;">${q.subject}</span>`;
      const diffBadge = q.difficulty ? `<span class="badge badge-diff-${q.difficulty.toLowerCase()}">${q.difficulty}</span>` : '';
      qDiv.innerHTML = `
        <div class="q-preview-title">
          <strong>${q.indexId + 1}.</strong> ${subjBadge} ${q.text}
          <span class="badge ${q.type === 'multiple' ? 'badge-mc' : 'badge-free'}">${q.type}</span> ${diffBadge}
        </div>
        ${imageHtml}
        ${optionsHtml}
        <div class="q-preview-key"><strong>Kunci Jawaban:</strong> <span class="key-value">${correctAns}</span></div>
      `;
      container.appendChild(qDiv);
    });
  } catch (error) {
    console.error('Error loading questions preview:', error);
  }
}

async function exportResultsToCSV() {
  try {
    const results = await getAllResults();
    if (results.length === 0) { alert('Tidak ada data hasil ujian untuk diekspor.'); return; }
    const csvRows = [['No', 'Nama Siswa', 'Mata Pelajaran', 'Nilai', 'Total Soal', 'Tanggal Pengerjaan', 'Detail Jawaban']];
    results.forEach((res, index) => {
      let answerDetails = res.answers
        ? Object.keys(res.answers).map(k => `${k.replace('q', 'Soal ')}: ${res.answers[k]}`).join('; ')
        : '';
      csvRows.push([index + 1, res.name, res.subject || 'Umum', res.score, res.total, res.timestamp, answerDetails]);
    });
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" +
      csvRows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', `Hasil_Olimpiade_Annur_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) { console.error('Error exporting CSV:', error); }
}

async function loadRankingTable() {
  const rankingBody = document.getElementById('rankingBody');
  const filterRankingSubject = document.getElementById('filterRankingSubject');
  if (!rankingBody) return;
  try {
    const selectedSubject = filterRankingSubject ? filterRankingSubject.value : '';
    const ranking = await getRankingData(selectedSubject || null);
    if (ranking.length === 0) {
      rankingBody.innerHTML = `<tr><td colspan="6" class="empty-state text-center py-4">📭 Belum ada data ranking.</td></tr>`;
      return;
    }
    rankingBody.innerHTML = '';
    ranking.forEach((item) => {
      const tr = document.createElement('tr');
      const medalEmoji = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : '▪️';
      tr.innerHTML = `
        <td style="text-align:center;font-weight:bold;font-size:1.1em;">${medalEmoji} ${item.rank}</td>
        <td class="student-name"><strong>${item.name}</strong></td>
        <td><span class="badge badge-info" style="background:#17a2b8;color:#fff;padding:.2rem .5rem;border-radius:4px;">${item.subject || 'Umum'}</span></td>
        <td style="text-align:center;"><span class="badge score-badge">${item.score}</span></td>
        <td style="text-align:center;"><span class="percentage-badge">${item.percentage}%</span></td>
        <td>${item.timestamp}</td>
      `;
      rankingBody.appendChild(tr);
    });
  } catch (error) { console.error('Error loading ranking:', error); }
}

async function loadRankingSubjectFilter() {
  const filterRankingSubject = document.getElementById('filterRankingSubject');
  if (!filterRankingSubject) return;
  try {
    const subjects = await getAvailableSubjects();
    const currentVal = filterRankingSubject.value;
    filterRankingSubject.innerHTML = '<option value="">-- Semua Mapel --</option>';
    subjects.forEach(subj => {
      filterRankingSubject.innerHTML += `<option value="${subj}">${subj}</option>`;
    });
    if (subjects.includes(currentVal)) filterRankingSubject.value = currentVal;
  } catch (error) { console.error('Error loading ranking subjects:', error); }
}

// ─── DOMContentLoaded ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  protectAdminPage();

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
  const logoutBtn = document.getElementById('logoutBtn');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Apakah Anda yakin ingin logout?')) {
        logoutAdmin();
        window.location.href = 'admin-login.html';
      }
    });
  }

  menuItems.forEach(menu => {
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      menuItems.forEach(m => m.classList.remove('active'));
      tabPanes.forEach(t => t.classList.remove('active'));
      menu.classList.add('active');
      document.getElementById(menu.getAttribute('data-target')).classList.add('active');
    });
  });

  loadSubjectFilter();
  loadResultsTable();
  loadQuestionsPreview();
  loadRankingSubjectFilter();
  loadRankingTable();

  if (filterSubject) filterSubject.addEventListener('change', loadQuestionsPreview);

  const filterRankingSubject = document.getElementById('filterRankingSubject');
  if (filterRankingSubject) filterRankingSubject.addEventListener('change', loadRankingTable);

  const exportPdfRankingBtn = document.getElementById('exportPdfRankingBtn');
  if (exportPdfRankingBtn) {
    exportPdfRankingBtn.addEventListener('click', async () => {
      try {
        const selectedSubject = filterRankingSubject ? filterRankingSubject.value : '';
        
        exportPdfRankingBtn.disabled = true;
        exportPdfRankingBtn.textContent = '⏳ Memproses...';

        let allResults = await getAllResults();
        if (selectedSubject) {
          allResults = allResults.filter(r => r.subject === selectedSubject);
        }
        
        if (allResults.length === 0) {
          alert('Tidak ada data ranking untuk diekspor.');
          exportPdfRankingBtn.disabled = false;
          exportPdfRankingBtn.textContent = '⬇️ Ekspor PDF';
          return;
        }

        const subjects = [...new Set(allResults.map(r => r.subject))];
        const correctAnswersBySubject = {};
        for (const subj of subjects) {
          correctAnswersBySubject[subj] = await getCorrectAnswers(subj);
        }

        const dataRows = allResults.map(res => {
          const correctAns = correctAnswersBySubject[res.subject] || {};
          let correctCount = 0;
          let emptyCount = 0;
          const userAns = res.answers || {};
          
          for (let i = 0; i < res.total; i++) {
             const key = `q${i}`;
             const uA = (userAns[key] || '').trim().toLowerCase();
             const cA = (correctAns[key] || '').trim().toLowerCase();
             if (!uA) emptyCount++;
             else if (cA && cA === uA) correctCount++;
          }

          return {
            ...res,
            correctCount,
            wrongCount: res.total - correctCount
          };
        });

        dataRows.sort((a, b) => b.score - a.score);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const tableBody = dataRows.map((r, index) => {
          const [date, ...timeArr] = r.timestamp.replace(',', '').split(' ');
          const time = timeArr.join(' ');
          return [
            index + 1,
            r.name,
            r.score,
            date,
            time,
            r.correctCount,
            r.wrongCount
          ];
        });

        const title = selectedSubject ? `Ranking Siswa - ${selectedSubject}` : 'Ranking Siswa - Semua Mapel';
        
        doc.text(title, 14, 15);
        
        doc.autoTable({
          startY: 20,
          head: [['No', 'Nama', 'Nilai', 'Tanggal', 'Waktu', 'Benar', 'Salah']],
          body: tableBody,
        });

        const safeSubject = (selectedSubject || 'Semua').replace(/\\s+/g, '_');
        doc.save(`Ranking_Siswa_${safeSubject}_${new Date().toISOString().slice(0, 10)}.pdf`);
        
        exportPdfRankingBtn.disabled = false;
        exportPdfRankingBtn.textContent = '⬇️ Ekspor PDF';
      } catch (error) {
        console.error('Error exporting PDF:', error);
        alert('Terjadi kesalahan saat mengekspor PDF.');
        exportPdfRankingBtn.disabled = false;
        exportPdfRankingBtn.textContent = '⬇️ Ekspor PDF';
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (file) { fileDisplay.textContent = file.name; fileDisplay.classList.add('selected'); }
      else { fileDisplay.textContent = 'Belum ada file terpilih'; fileDisplay.classList.remove('selected'); }
    });
  }

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
        mammoth.convertToHtml({
          arrayBuffer: event.target.result,
          convertImage: mammoth.images.inline(function(element) {
            return element.read('base64').then(function(imageBuffer) {
              return { src: `data:${element.contentType};base64,${imageBuffer}` };
            });
          })
        }).then(async (result) => {
          const html = result.value;

          // Coba parser HTML (format list) dulu, fallback ke parser lines (format paragraf)
          let parsed = parseDocxHtml(html);
          if (!parsed || !parsed.questions || parsed.questions.length === 0) {
            const lines = htmlToLines(html);
            parsed = parseDocxLines(lines);
          }

          const { questions, answers } = parsed || { questions: [], answers: {} };

          if (questions.length === 0) {
            statusDiv.innerHTML = `
              ⚠️ Tidak ditemukan soal. Pastikan format file benar:<br>
              <small>• Format paragraf: <b>1. Teks soal</b> → <b>A. Pilihan</b> → <b>Kunci Jawaban: A</b></small><br>
              <small>• Format list: gunakan Numbered List di Word</small>
            `;
            statusDiv.className = 'status-msg error';
            return;
          }

          const answerCount = Object.values(answers).filter(v => v).length;
          let statusMessage = '';
          let statusClass = 'success';

          if (answerCount < questions.length) {
            statusMessage = `Peringatan: ${answerCount} dari ${questions.length} soal memiliki kunci jawaban. `;
            statusClass = 'warning';
          }

          await saveExamData(subject, questions, answers);

          statusDiv.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${statusMessage}Berhasil mengunggah <strong>${questions.length} soal</strong> untuk mapel <strong>${subject}</strong>.`;
          statusDiv.className = `status-msg ${statusClass}`;

          await loadSubjectFilter();
          if (filterSubject) filterSubject.value = subject;
          await loadQuestionsPreview();

          fileInput.value = '';
          fileDisplay.textContent = 'Belum ada file terpilih';
          fileDisplay.classList.remove('selected');

        }).catch(err => {
          console.error(err);
          statusDiv.textContent = 'Error parsing .docx: ' + err.message;
          statusDiv.className = 'status-msg error';
        });
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (exportBtn) exportBtn.addEventListener('click', exportResultsToCSV);

  if (clearResultsBtn) {
    clearResultsBtn.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin menghapus semua data hasil pengerjaan siswa?')) {
        clearResultsBtn.disabled = true;
        clearResultsBtn.textContent = '⏳ Menghapus...';
        try {
          await clearAllResults();
          await loadResultsTable();
          await loadRankingTable();
        } finally {
          clearResultsBtn.disabled = false;
          clearResultsBtn.innerHTML = '🗑️ Hapus Semua';
        }
      }
    });
  }

  if (clearQuestionsBtn) {
    clearQuestionsBtn.addEventListener('click', async () => {
      const selectedSubject = filterSubject ? filterSubject.value : '';
      const msg = selectedSubject
        ? `Apakah Anda yakin ingin menghapus soal untuk mapel ${selectedSubject}?`
        : 'Apakah Anda yakin ingin menghapus SEMUA soal dari semua mapel?';
      if (confirm(msg)) {
        clearQuestionsBtn.disabled = true;
        try {
          if (selectedSubject) {
            await clearSubjectData(selectedSubject);
            statusDiv.innerHTML = `<i class="fa-solid fa-trash"></i> Soal mapel ${selectedSubject} dihapus.`;
          } else {
            await clearExamData();
            statusDiv.innerHTML = `<i class="fa-solid fa-trash"></i> Semua soal dan kunci jawaban telah dihapus.`;
          }
          statusDiv.className = 'status-msg warning';
          await loadSubjectFilter();
          await loadQuestionsPreview();
        } finally {
          clearQuestionsBtn.disabled = false;
        }
      }
    });
  }
});