// background.js — Service Worker
// Orchestrates tab capture, message routing, and offscreen document lifecycle

const LOG = (...args) => console.debug('[LinguaLive]', ...args);

// Track offscreen document state
// MV3 only allows one offscreen document at a time
let offscreenReady = false;

// ─── Side Panel ──────────────────────────────────────────────────────────────

// Open side panel when toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ─── Offscreen Document ───────────────────────────────────────────────────────

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen/offscreen.html')],
  });

  if (existingContexts.length > 0) {
    LOG('Offscreen document already exists');
    return;
  }

  // Only one offscreen document is allowed in MV3
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Audio capture and speech recognition for real-time translation',
  });

  LOG('Offscreen document created');
}

async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
    LOG('Offscreen document closed');
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  LOG('Message received:', message.type);

  switch (message.type) {
    case 'START_LISTENING': {
      handleStartListening(message.payload).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: err.message ?? String(err) });
      });
      return true; // keep channel open for async response
    }

    case 'STOP_LISTENING': {
      handleStopListening().then(() => sendResponse({ success: true })).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true;
    }

    case 'TRANSCRIPT': {
      // Comes from offscreen.js → forward translation to content script
      handleTranscript(message.payload);
      break;
    }

    case 'SUBTITLE_UPDATE': {
      // Comes from offscreen after translation — forward to content script
      forwardToActiveTab(message);
      break;
    }

    case 'SUBTITLE_CORRECTION': {
      // Background verification found a correction — forward to content script
      forwardToActiveTab(message);
      break;
    }

    case 'DOWNLOAD_PROGRESS': {
      // Comes from offscreen downloader — forward to sidepanel
      forwardToSidePanel(message);
      break;
    }

    case 'DOWNLOAD_PACK': {
      // sidepanel requests a download — forward to offscreen
      ensureOffscreenDocument().then(() => {
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_DOWNLOAD_PACK', payload: message.payload });
      });
      break;
    }

    case 'OFFSCREEN_READY': {
      offscreenReady = true;
      LOG('Offscreen document signaled ready');
      break;
    }
  }
});

async function handleStartListening({ srcLang, tgtLang, tabId }) {
  try {
    await ensureOffscreenDocument();

    // Inject content script to host the overlay
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });

    // Pass tabId to offscreen doc so it can call getMediaStreamId itself,
    // immediately before getUserMedia — avoids the stream ID expiring in transit
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START',
      payload: { tabId, srcLang, tgtLang },
    });

    // Update storage
    await chrome.storage.local.set({ isListening: true, activeTabId: tabId });

    LOG('Listening started on tab', tabId);
    return { success: true };
  } catch (err) {
    LOG('Start listening error:', err);
    throw err;
  }
}

async function handleStopListening() {
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  await chrome.storage.local.set({ isListening: false });

  // Notify content script to hide overlay
  const { activeTabId } = await chrome.storage.local.get('activeTabId');
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'HIDE_OVERLAY' }).catch(() => {});
  }

  LOG('Listening stopped');
}

async function forwardToActiveTab(message) {
  const { activeTabId } = await chrome.storage.local.get('activeTabId');
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, message).catch((err) => {
      LOG('Could not forward to tab:', err.message);
    });
  }
}

function forwardToSidePanel(message) {
  // Send to all extension contexts (side panel will receive it)
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

// Keep service worker alive via periodic alarm
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    LOG('Keep-alive ping');
  }
});

LOG('Background service worker started');
