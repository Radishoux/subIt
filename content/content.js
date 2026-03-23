// content/content.js — Injected into the active tab
// Creates and manages the subtitle overlay iframe, bridges messages from background

const LOG = (...args) => console.debug('[LinguaLive]', ...args);

// Guard: only inject once per page
if (!window.__linguaLiveInjected) {
  window.__linguaLiveInjected = true;
  initOverlay();
}

function initOverlay() {
  let overlayFrame = null;

  function createOverlay() {
    if (overlayFrame) return;

    overlayFrame = document.createElement('iframe');
    overlayFrame.src = chrome.runtime.getURL('overlay/overlay.html');
    overlayFrame.id  = '__lingua-live-overlay';

    // Full-width, pointer-events none so the page remains interactive
    Object.assign(overlayFrame.style, {
      position:        'fixed',
      bottom:          '0',
      left:            '0',
      width:           '100%',
      height:          '160px',
      border:          'none',
      zIndex:          '2147483647',
      pointerEvents:   'none',
      background:      'transparent',
      colorScheme:     'normal',
    });

    document.documentElement.appendChild(overlayFrame);
    LOG('Overlay iframe injected');
  }

  function removeOverlay() {
    overlayFrame?.remove();
    overlayFrame = null;
    LOG('Overlay removed');
  }

  function sendToOverlay(type, payload) {
    overlayFrame?.contentWindow?.postMessage({ type, payload }, '*');
  }

  // ── Message listener from background ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'SUBTITLE_UPDATE': {
        createOverlay(); // ensure overlay exists
        sendToOverlay('SUBTITLE_UPDATE', message.payload);
        break;
      }

      case 'SUBTITLE_CORRECTION': {
        sendToOverlay('SUBTITLE_CORRECTION', message.payload);
        break;
      }

      case 'HIDE_OVERLAY': {
        removeOverlay();
        break;
      }

      case 'SETTINGS_UPDATE': {
        sendToOverlay('SETTINGS_UPDATE', message.payload);
        break;
      }
    }
  });

  LOG('Content script ready');
}
