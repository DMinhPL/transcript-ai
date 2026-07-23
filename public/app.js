const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const dropzone = document.getElementById('dropzone');
const dropzoneLabel = document.getElementById('dropzoneLabel');
const fileInput = document.getElementById('fileInput');
const recordBtn = document.getElementById('recordBtn');
const recordTimer = document.getElementById('recordTimer');
const recordedPreview = document.getElementById('recordedPreview');
const languageSelect = document.getElementById('language');
const transcribeBtn = document.getElementById('transcribeBtn');
const statusEl = document.getElementById('status');
const resultPanel = document.getElementById('result-panel');
const segmentsEl = document.getElementById('segments');
const downloadLinksEl = document.getElementById('downloadLinks');

let activeTab = 'upload';
let selectedFile = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordTimerInterval = null;
let recordSeconds = 0;

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
    tabContents.forEach((c) =>
      c.classList.toggle('active', c.id === `tab-${activeTab}`),
    );
    updateTranscribeButton();
  });
});

// --- Upload tab ---
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', () =>
  dropzone.classList.remove('dragover'),
);
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    setSelectedFile(e.dataTransfer.files[0]);
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) setSelectedFile(fileInput.files[0]);
});

function setSelectedFile(file) {
  selectedFile = file;
  dropzoneLabel.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  updateTranscribeButton();
}

// --- Record tab ---
recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(recordTimerInterval);
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      selectedFile = new File([blob], 'recording.webm', { type: 'audio/webm' });
      recordedPreview.src = URL.createObjectURL(blob);
      recordedPreview.hidden = false;
      recordBtn.textContent = 'Start recording';
      recordBtn.classList.remove('recording');
      updateTranscribeButton();
    };
    mediaRecorder.start();
    recordSeconds = 0;
    recordTimer.textContent = '00:00';
    recordTimerInterval = setInterval(() => {
      recordSeconds++;
      const m = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const s = String(recordSeconds % 60).padStart(2, '0');
      recordTimer.textContent = `${m}:${s}`;
    }, 1000);
    recordBtn.textContent = 'Stop recording';
    recordBtn.classList.add('recording');
  } catch (err) {
    showStatus(`Microphone access failed: ${err.message}`, true);
  }
});

function updateTranscribeButton() {
  transcribeBtn.disabled = !selectedFile;
}

function showStatus(message, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

transcribeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  transcribeBtn.disabled = true;
  resultPanel.hidden = true;
  showStatus(
    'Uploading and transcribing… this can take a while for long recordings.',
  );

  const formData = new FormData();
  formData.append('media', selectedFile);
  formData.append('language', languageSelect.value);

  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed.');
    console.log('Transcription result:', data);
    renderResult(data);
    showStatus(`Done. Detected language: ${data.language}`);
  } catch (err) {
    showStatus(err.message, true);
  } finally {
    transcribeBtn.disabled = false;
  }
});

function renderResult(data) {
  segmentsEl.innerHTML = '';
  for (const seg of data.segments) {
    const row = document.createElement('div');
    row.className = 'segment';
    row.innerHTML = `
      <span class="timestamp">${formatTime(seg.start)}</span>
      <span class="text"></span>
    `;
    row.querySelector('.text').textContent = seg.text;
    segmentsEl.appendChild(row);
  }

  downloadLinksEl.innerHTML = '';
  for (const [format, url] of Object.entries(data.downloads)) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = `Download .${format}`;
    downloadLinksEl.appendChild(a);
  }

  resultPanel.hidden = false;
}
