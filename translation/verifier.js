// translation/verifier.js — Background online verification
// Every 5 seconds, checks the last N offline translations against a free online API.
// Non-blocking: corrections are sent asynchronously and never delay subtitle display.
const LOG = (...args) => console.debug('[LinguaLive/verifier]', ...args);

const VERIFY_INTERVAL_MS = 5000;
const BATCH_SIZE         = 3;
const SIMILARITY_THRESHOLD = 0.7;

let verifierTimer  = null;
let srcLang        = 'fr';
let tgtLang        = 'en';
const segmentQueue = []; // { original, translated, segmentId, verified }

// ─── Public API ───────────────────────────────────────────────────────────────

export function startVerifier(src, tgt) {
  srcLang = src;
  tgtLang = tgt;
  stopVerifier();
  verifierTimer = setInterval(runVerification, VERIFY_INTERVAL_MS);
  LOG('Verifier started');
}

export function stopVerifier() {
  clearInterval(verifierTimer);
  verifierTimer = null;
}

export function pushSegment(segment) {
  segmentQueue.push({ ...segment, verified: false });
  // Keep queue bounded
  if (segmentQueue.length > 20) segmentQueue.shift();
}

// ─── Verification run ────────────────────────────────────────────────────────

async function runVerification() {
  // Pick up to BATCH_SIZE unverified segments
  const pending = segmentQueue
    .filter((s) => !s.verified)
    .slice(-BATCH_SIZE);

  if (pending.length === 0) return;

  LOG(`Verifying ${pending.length} segment(s)`);

  // Try MyMemory API (free, no key required for basic use)
  // Rate limit: ~100 req/day for anonymous; batching helps
  const text = pending.map((s) => s.original).join(' | ');

  try {
    const onlineTranslations = await fetchMyMemory(text, srcLang, tgtLang);
    if (!onlineTranslations) return;

    // Split by separator and compare each
    const parts = onlineTranslations.split(' | ');
    pending.forEach((seg, i) => {
      const online = parts[i]?.trim();
      if (!online) return;

      seg.verified = true;

      const sim = stringSimilarity(seg.translated, online);
      LOG(`Segment similarity: ${sim.toFixed(2)} | offline: "${seg.translated}" | online: "${online}"`);

      if (sim < SIMILARITY_THRESHOLD) {
        // Correction found — send to background → content → overlay
        const offset = segmentQueue.length - 1 - segmentQueue.indexOf(seg);
        chrome.runtime.sendMessage({
          type: 'SUBTITLE_CORRECTION',
          payload: {
            segmentId:     seg.segmentId,
            correctedText: online,
            segmentOffset: offset,
          },
        });
      }
    });
  } catch (err) {
    // Silently skip — online verification is best-effort
    LOG('Verification API error (skipping):', err.message);
  }
}

// ─── Online API ───────────────────────────────────────────────────────────────

async function fetchMyMemory(text, src, tgt) {
  // MyMemory API: https://api.mymemory.translated.net/get
  // No API key required for up to 100 words/day (anonymous)
  const langPair = `${src}|${tgt}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);

  const data = await response.json();
  if (data.responseStatus !== 200) {
    // Fallback to LibreTranslate if MyMemory quota exceeded
    return fetchLibreTranslate(text, src, tgt);
  }

  return data.responseData?.translatedText ?? null;
}

async function fetchLibreTranslate(text, src, tgt) {
  // LibreTranslate public instance — free, no key for basic requests
  const response = await fetch('https://libretranslate.com/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: src, target: tgt, format: 'text' }),
    signal: AbortSignal.timeout(4000),
  });

  if (!response.ok) throw new Error(`LibreTranslate HTTP ${response.status}`);
  const data = await response.json();
  return data.translatedText ?? null;
}

// ─── String similarity (Dice coefficient) ───────────────────────────────────

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;

  const bigrams = (str) => {
    const set = new Map();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let intersection = 0;

  for (const [bg, count] of aGrams) {
    const bCount = bGrams.get(bg) ?? 0;
    intersection += Math.min(count, bCount);
  }

  const total = (a.length - 1) + (b.length - 1);
  return total === 0 ? 0 : (2 * intersection) / total;
}
