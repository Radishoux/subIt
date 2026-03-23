// overlay.js — runs inside the overlay iframe
const LOG = (...args) => console.debug('[LinguaLive/overlay]', ...args);

const container   = document.getElementById('overlay-container');
const linesEl     = document.getElementById('subtitle-lines');
const langBadge   = document.getElementById('lang-badge');
const verifiedEl  = document.getElementById('verified-flash');

// ─── State ────────────────────────────────────────────────────────────────────

let settings = {
  lines: 3,
  fontSize: 'medium',
  position: 'bottom',
  opacity: 0.85,
};

// Ring buffer of final segments
const segmentBuffer = [];
let interimText = '';
let verifiedTimer = null;

// ─── Subtitle rendering ───────────────────────────────────────────────────────

function renderLines() {
  // Show last N final segments + optional interim
  const maxLines = settings.lines;
  const finals   = segmentBuffer.slice(-maxLines);

  linesEl.innerHTML = '';
  finals.forEach((text, i) => {
    const div = document.createElement('div');
    div.className = 'subtitle-line';
    div.textContent = text;
    linesEl.appendChild(div);
    // Trigger transition
    requestAnimationFrame(() => div.classList.add('visible'));
  });

  // Interim line (last slot if room, or appended)
  if (interimText) {
    const div = document.createElement('div');
    div.className = 'subtitle-line interim visible';
    div.textContent = interimText;
    linesEl.appendChild(div);
  }
}

function pushFinalSegment(text) {
  if (!text?.trim()) return;
  segmentBuffer.push(text);
  // Keep buffer bounded
  if (segmentBuffer.length > 20) segmentBuffer.shift();
  interimText = '';
  renderLines();
}

function setInterim(text) {
  interimText = text;
  renderLines();
}

function applySettings(s) {
  settings = { ...settings, ...s };

  // Opacity
  container.style.background = `rgba(0,0,0,${settings.opacity})`;

  // Position
  container.classList.toggle('position-top', settings.position === 'top');
  if (settings.position === 'top') {
    container.style.bottom = 'unset';
    container.style.top    = '0';
  } else {
    container.style.top    = 'unset';
    container.style.bottom = '0';
  }

  // Font size class
  container.className = container.className
    .replace(/font-\w+/g, '')
    .trim();
  container.classList.add(`font-${settings.fontSize}`);
}

function flashVerified() {
  verifiedEl.classList.add('show');
  clearTimeout(verifiedTimer);
  verifiedTimer = setTimeout(() => verifiedEl.classList.remove('show'), 2000);
}

// ─── Message listener ─────────────────────────────────────────────────────────

window.addEventListener('message', (event) => {
  const { type, payload } = event.data ?? {};

  switch (type) {
    case 'SUBTITLE_UPDATE': {
      if (payload.isFinal) {
        pushFinalSegment(payload.translatedText);
      } else {
        setInterim(payload.translatedText);
      }
      break;
    }

    case 'SUBTITLE_CORRECTION': {
      const idx = segmentBuffer.length - 1 - (payload.segmentOffset ?? 0);
      if (idx >= 0 && payload.correctedText) {
        segmentBuffer[idx] = payload.correctedText;
        renderLines();
        flashVerified();
      }
      break;
    }

    case 'SETTINGS_UPDATE': {
      applySettings(payload);

      // Update lang badge
      if (payload.srcLang && payload.tgtLang) {
        langBadge.textContent = `${payload.srcLang.toUpperCase()} → ${payload.tgtLang.toUpperCase()}`;
      }
      break;
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

applySettings(settings);
LOG('Overlay ready');
