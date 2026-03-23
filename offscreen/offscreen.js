// offscreen.js — Offscreen document
// Handles: tab audio capture, Web Speech API recognition, translation, verification
import { translate, loadModel } from '../translation/engine.js';
import { downloadLanguagePack } from '../translation/downloader.js';
import { startVerifier, stopVerifier, pushSegment } from '../translation/verifier.js';

const LOG = (...args) => console.debug('[LinguaLive/offscreen]', ...args);

// ─── State ────────────────────────────────────────────────────────────────────

let mediaStream      = null;
let recognition      = null;
let currentSrcLang   = 'fr';
let currentTgtLang   = 'en';
let isRunning        = false;
let restartTimer     = null;

// Debounce timer for interim results (300ms)
let interimDebounce  = null;
let pendingInterim   = '';

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'OFFSCREEN_START':
      handleStart(message.payload);
      break;
    case 'OFFSCREEN_STOP':
      handleStop();
      break;
    case 'OFFSCREEN_DOWNLOAD_PACK':
      downloadLanguagePack(message.payload.key);
      break;
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function handleStart({ streamId, srcLang, tgtLang }) {
  if (isRunning) {
    LOG('Already running, restarting with new config');
    handleStop();
  }

  currentSrcLang = srcLang;
  currentTgtLang = tgtLang;
  isRunning      = true;

  LOG(`Starting capture: ${srcLang} → ${tgtLang}`);

  try {
    // Strategy 1: use the tab capture stream ID provided by background.js
    // This gives us a MediaStream for the active tab's audio
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    LOG('Tab audio stream acquired');
  } catch (err) {
    LOG('Tab capture failed, falling back to mic:', err.message);
    // Fallback: user's microphone
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (fallbackErr) {
      sendStatus('Error: could not capture audio');
      LOG('Mic fallback also failed:', fallbackErr.message);
      return;
    }
  }

  // Pre-load the translation model in a non-blocking way
  loadModel(srcLang, tgtLang).catch((err) => LOG('Model pre-load:', err.message));

  startSpeechRecognition();
  startVerifier(currentSrcLang, currentTgtLang);

  // Signal background that offscreen is operational
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
}

// ─── Stop ─────────────────────────────────────────────────────────────────────

function handleStop() {
  isRunning = false;
  clearTimeout(restartTimer);

  if (recognition) {
    recognition.onend = null; // prevent auto-restart
    recognition.stop();
    recognition = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  stopVerifier();
  LOG('Stopped');
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    LOG('Web Speech API not available');
    sendStatus('Speech recognition not supported');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang            = langToLocale(currentSrcLang);
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => LOG('Recognition started');

  recognition.onresult = (event) => {
    let finalTranscript   = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    if (finalTranscript.trim()) {
      // Batch short segments: wait for at least 3 words
      const words = finalTranscript.trim().split(/\s+/).length;
      if (words >= 3) {
        processTranscript(finalTranscript.trim(), true);
      } else {
        // Accumulate short segments
        pendingInterim += ' ' + finalTranscript.trim();
      }
    }

    if (interimTranscript.trim()) {
      pendingInterim = interimTranscript;
      clearTimeout(interimDebounce);
      // Debounce 300ms before translating interim
      interimDebounce = setTimeout(() => {
        if (pendingInterim.trim()) {
          processTranscript(pendingInterim.trim(), false);
        }
      }, 300);
    }
  };

  recognition.onerror = (event) => {
    LOG('Recognition error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      sendStatus('Microphone permission denied');
      handleStop();
    }
  };

  // Auto-restart when recognition ends (it stops after silence)
  recognition.onend = () => {
    if (!isRunning) return;
    LOG('Recognition ended — restarting in 1s');
    sendStatus('Reconnecting...');
    restartTimer = setTimeout(() => {
      if (isRunning) {
        startSpeechRecognition();
        sendStatus('Listening...');
      }
    }, 1000);
  };

  recognition.start();
}

// ─── Translation pipeline ─────────────────────────────────────────────────────

async function processTranscript(text, isFinal) {
  LOG(`Transcript (${isFinal ? 'final' : 'interim'}):`, text);

  const result = await translate(text, currentSrcLang, currentTgtLang);

  if (isFinal) {
    // Track for background verification
    pushSegment({ original: text, translated: result.text, segmentId: Date.now() });
  }

  chrome.runtime.sendMessage({
    type: 'SUBTITLE_UPDATE',
    payload: {
      translatedText: result.text,
      isFinal,
      offline: result.offline,
      modelReady: result.modelReady,
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendStatus(text) {
  chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', payload: { text } });
}

// Map language code to BCP-47 locale for Web Speech API
function langToLocale(code) {
  const map = {
    fr: 'fr-FR', es: 'es-ES', de: 'de-DE', it: 'it-IT',
    pt: 'pt-PT', nl: 'nl-NL', ru: 'ru-RU', ja: 'ja-JP',
    zh: 'zh-CN', ko: 'ko-KR', ar: 'ar-SA', pl: 'pl-PL',
    tr: 'tr-TR', sv: 'sv-SE', no: 'nb-NO', en: 'en-US',
  };
  return map[code] ?? code;
}

LOG('Offscreen document ready');
