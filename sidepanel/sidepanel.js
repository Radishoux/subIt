// sidepanel.js — Side panel UI logic
const LOG = (...args) => console.debug('[LinguaLive]', ...args);

// ─── Language definitions ─────────────────────────────────────────────────────

const LANGUAGES = [
  { code: 'fr', label: 'French',              model: 'Helsinki-NLP/opus-mt-fr-en' },
  { code: 'es', label: 'Spanish',             model: 'Helsinki-NLP/opus-mt-es-en' },
  { code: 'de', label: 'German',              model: 'Helsinki-NLP/opus-mt-de-en' },
  { code: 'it', label: 'Italian',             model: 'Helsinki-NLP/opus-mt-it-en' },
  { code: 'pt', label: 'Portuguese',          model: 'Helsinki-NLP/opus-mt-pt-en' },
  { code: 'nl', label: 'Dutch',               model: 'Helsinki-NLP/opus-mt-nl-en' },
  { code: 'ru', label: 'Russian',             model: 'Helsinki-NLP/opus-mt-ru-en' },
  { code: 'ja', label: 'Japanese',            model: 'Helsinki-NLP/opus-mt-ja-en' },
  { code: 'zh', label: 'Chinese (Simplified)',model: 'Helsinki-NLP/opus-mt-zh-en' },
  { code: 'ko', label: 'Korean',              model: 'Helsinki-NLP/opus-mt-ko-en' },
  { code: 'ar', label: 'Arabic',              model: 'Helsinki-NLP/opus-mt-ar-en' },
  { code: 'pl', label: 'Polish',              model: 'Helsinki-NLP/opus-mt-pl-en' },
  { code: 'tr', label: 'Turkish',             model: 'Helsinki-NLP/opus-mt-tr-en' },
  { code: 'sv', label: 'Swedish',             model: 'Helsinki-NLP/opus-mt-sv-en' },
  { code: 'no', label: 'Norwegian',           model: 'Helsinki-NLP/opus-mt-no-en' },
  { code: 'en', label: 'English',             model: null },
];

const FONT_SIZES = { small: '14px', medium: '18px', large: '24px', xl: '32px' };

// ─── State ────────────────────────────────────────────────────────────────────

let settings = {
  srcLang: 'fr',
  tgtLang: 'en',
  lines: 3,
  fontSize: 'medium',
  position: 'bottom',
  opacity: 0.85,
};
let isListening = false;
let downloadedPacks = [];

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const srcSelect      = document.getElementById('src-lang');
const tgtSelect      = document.getElementById('tgt-lang');
const swapBtn        = document.getElementById('swap-btn');
const listenBtn      = document.getElementById('listen-btn');
const listenLabel    = document.getElementById('listen-label');
const statusText     = document.getElementById('status-text');
const statusBadge    = document.getElementById('status-badge');
const opacitySlider  = document.getElementById('opacity-slider');
const opacityValue   = document.getElementById('opacity-value');
const packsList      = document.getElementById('packs-list');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  populateLanguageSelects();
  await loadSettings();
  renderPacks();
  applySettings();
  bindEvents();
  listenForMessages();

  LOG('Sidepanel initialized');
}

function populateLanguageSelects() {
  // Source: "Auto-detect" is already in HTML, add language options
  LANGUAGES.forEach(({ code, label }) => {
    const opt = new Option(label, code);
    srcSelect.appendChild(opt);
  });

  // Target: no auto-detect
  LANGUAGES.forEach(({ code, label }) => {
    const opt = new Option(label, code);
    tgtSelect.appendChild(opt);
  });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings', 'downloadedPacks', 'isListening']);
  if (stored.settings)       settings       = { ...settings, ...stored.settings };
  if (stored.downloadedPacks) downloadedPacks = stored.downloadedPacks;
  isListening = stored.isListening ?? false;

  if (isListening) {
    setListeningUI(true);
  }
}

function applySettings() {
  srcSelect.value        = settings.srcLang;
  tgtSelect.value        = settings.tgtLang;
  opacitySlider.value    = Math.round(settings.opacity * 100);
  opacityValue.textContent = `${Math.round(settings.opacity * 100)}%`;

  setSegmented('lines-control',    String(settings.lines));
  setSegmented('fontsize-control', settings.fontSize);
  setSegmented('position-control', settings.position);
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  srcSelect.addEventListener('change', () => {
    settings.srcLang = srcSelect.value;
    saveSettings();
    updateCurrentPack();
  });

  tgtSelect.addEventListener('change', () => {
    settings.tgtLang = tgtSelect.value;
    saveSettings();
    updateCurrentPack();
  });

  swapBtn.addEventListener('click', () => {
    if (settings.srcLang === 'auto') return;
    [settings.srcLang, settings.tgtLang] = [settings.tgtLang, settings.srcLang];
    srcSelect.value = settings.srcLang;
    tgtSelect.value = settings.tgtLang;
    saveSettings();
    updateCurrentPack();
  });

  listenBtn.addEventListener('click', toggleListening);

  opacitySlider.addEventListener('input', () => {
    const val = parseInt(opacitySlider.value, 10);
    opacityValue.textContent = `${val}%`;
    settings.opacity = val / 100;
    saveSettings();
  });

  // Segmented controls
  document.getElementById('lines-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    settings.lines = parseInt(btn.dataset.value, 10);
    setSegmented('lines-control', btn.dataset.value);
    saveSettings();
  });

  document.getElementById('fontsize-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    settings.fontSize = btn.dataset.value;
    setSegmented('fontsize-control', btn.dataset.value);
    saveSettings();
  });

  document.getElementById('position-control').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    settings.position = btn.dataset.value;
    setSegmented('position-control', btn.dataset.value);
    saveSettings();
  });
}

async function toggleListening() {
  if (isListening) {
    setStatusText('Stopping...');
    await chrome.runtime.sendMessage({ type: 'STOP_LISTENING' });
    setListeningUI(false);
    setStatusText('Ready');
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      setStatusText('No active tab found');
      return;
    }

    setStatusText('Starting...');
    const response = await chrome.runtime.sendMessage({
      type: 'START_LISTENING',
      payload: {
        srcLang: settings.srcLang,
        tgtLang: settings.tgtLang,
        tabId: tab.id,
      },
    });

    if (response?.success) {
      setListeningUI(true);
      setStatusText('Listening...');
    } else {
      setStatusText(`Error: ${response?.error ?? 'Unknown error'}`);
      setStatus('error', 'Error');
    }
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setListeningUI(active) {
  isListening = active;
  listenBtn.classList.toggle('active', active);
  listenLabel.textContent = active ? 'Stop Listening' : 'Start Listening';
  setStatus(active ? 'listening' : 'idle', active ? 'Listening' : 'Idle');
}

function setStatus(type, label) {
  statusBadge.className = `status-badge ${type}`;
  statusBadge.textContent = label;
}

function setStatusText(text) {
  statusText.textContent = text;
}

function setSegmented(containerId, value) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === value);
  });
}

// ─── Language Packs ───────────────────────────────────────────────────────────

function renderPacks() {
  packsList.innerHTML = '';
  const pairs = LANGUAGES.filter((l) => l.code !== 'en').map((l) => ({
    srcCode: l.code,
    srcLabel: l.label,
    key: `${l.code}-en`,
  }));

  pairs.forEach(({ srcCode, srcLabel, key }) => {
    const isReady   = downloadedPacks.includes(key);
    const isCurrent = settings.srcLang === srcCode && settings.tgtLang === 'en';

    const li = document.createElement('li');
    li.className = `pack-item${isCurrent ? ' current' : ''}`;
    li.dataset.key = key;

    li.innerHTML = `
      <div>
        <div class="pack-name">${srcLabel} ↔ English</div>
        <div class="pack-status ${isReady ? 'ready' : ''}">${isReady ? '✓ Ready' : 'Not downloaded'}</div>
      </div>
      ${isReady
        ? ''
        : `<button class="pack-download-btn" data-key="${key}">Download</button>`
      }
    `;

    if (!isReady) {
      li.querySelector('.pack-download-btn').addEventListener('click', () => startDownload(key));
    }

    packsList.appendChild(li);
  });
}

function updateCurrentPack() {
  packsList.querySelectorAll('.pack-item').forEach((li) => {
    const [src] = li.dataset.key.split('-');
    li.classList.toggle('current', src === settings.srcLang && settings.tgtLang === 'en');
  });
}

function startDownload(key) {
  chrome.runtime.sendMessage({ type: 'DOWNLOAD_PACK', payload: { key } });
  updatePackStatus(key, 'Downloading...', false, 0);
}

function updatePackStatus(key, statusMsg, isReady, percent) {
  const li = packsList.querySelector(`[data-key="${key}"]`);
  if (!li) return;

  const statusEl = li.querySelector('.pack-status');
  if (statusEl) statusEl.textContent = isReady ? '✓ Ready' : statusMsg;
  if (statusEl) statusEl.className = `pack-status${isReady ? ' ready' : ''}`;

  // Show/hide progress bar
  let progressWrap = li.querySelector('.progress-bar-wrap');
  if (!isReady && percent > 0) {
    if (!progressWrap) {
      progressWrap = document.createElement('div');
      progressWrap.className = 'progress-bar-wrap';
      progressWrap.innerHTML = `<div class="progress-bar-fill" style="width:${percent}%"></div>`;
      li.appendChild(progressWrap);
    } else {
      progressWrap.querySelector('.progress-bar-fill').style.width = `${percent}%`;
    }
  } else if (isReady && progressWrap) {
    progressWrap.remove();
    li.querySelector('.pack-download-btn')?.remove();
  }
}

// ─── Incoming messages ────────────────────────────────────────────────────────

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'DOWNLOAD_PROGRESS': {
        const { key, percent, done } = message.payload;
        if (done) {
          downloadedPacks = [...new Set([...downloadedPacks, key])];
          updatePackStatus(key, '✓ Ready', true, 100);
          chrome.storage.local.set({ downloadedPacks });
        } else {
          updatePackStatus(key, `Downloading ${percent}%`, false, percent);
        }
        break;
      }

      case 'SUBTITLE_UPDATE': {
        // Could show live transcript in panel if desired
        break;
      }

      case 'STATUS_UPDATE': {
        setStatusText(message.payload.text);
        break;
      }
    }
  });
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function saveSettings() {
  await chrome.storage.local.set({ settings });
  // Push updated settings to active overlay
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATE', payload: settings }).catch(() => {});
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
init();
