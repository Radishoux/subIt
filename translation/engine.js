// translation/engine.js — Offline translation using @xenova/transformers (WASM)
// Loads Helsinki-NLP/opus-mt models from Hugging Face cache (IndexedDB/Cache API)
const LOG = (...args) => console.debug('[LinguaLive/engine]', ...args);

// Singleton pipeline map: "fr-en" → pipeline instance
const pipelines = new Map();
const loadingPromises = new Map();

// Inactivity unload: unload a pipeline after 5 minutes of no use
const INACTIVITY_MS = 5 * 60 * 1000;
const inactivityTimers = new Map();

// ─── Model name lookup ───────────────────────────────────────────────────────

const MODEL_MAP = {
  'fr-en': 'Helsinki-NLP/opus-mt-fr-en',
  'es-en': 'Helsinki-NLP/opus-mt-es-en',
  'de-en': 'Helsinki-NLP/opus-mt-de-en',
  'it-en': 'Helsinki-NLP/opus-mt-it-en',
  'pt-en': 'Helsinki-NLP/opus-mt-pt-en',
  'nl-en': 'Helsinki-NLP/opus-mt-nl-en',
  'ru-en': 'Helsinki-NLP/opus-mt-ru-en',
  'ja-en': 'Helsinki-NLP/opus-mt-ja-en',
  'zh-en': 'Helsinki-NLP/opus-mt-zh-en',
  'ko-en': 'Helsinki-NLP/opus-mt-ko-en',
  'ar-en': 'Helsinki-NLP/opus-mt-ar-en',
  'pl-en': 'Helsinki-NLP/opus-mt-pl-en',
  'tr-en': 'Helsinki-NLP/opus-mt-tr-en',
  'sv-en': 'Helsinki-NLP/opus-mt-sv-en',
  'no-en': 'Helsinki-NLP/opus-mt-no-en',
  // Reverse direction (en → X) — add as needed
  'en-fr': 'Helsinki-NLP/opus-mt-en-fr',
  'en-es': 'Helsinki-NLP/opus-mt-en-es',
  'en-de': 'Helsinki-NLP/opus-mt-en-de',
};

// ─── Lazy Transformers.js import ─────────────────────────────────────────────

let _transformers = null;

async function getTransformers() {
  if (_transformers) return _transformers;
  // Dynamically import so it only loads when actually needed
  // @xenova/transformers is bundled as an ES module
  _transformers = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2/dist/transformers.min.js');
  // Use local cache (browser Cache API / IndexedDB) — avoid re-downloading
  _transformers.env.allowRemoteModels  = true;
  _transformers.env.useBrowserCache    = true;
  _transformers.env.useCustomCache     = false;
  return _transformers;
}

// ─── Load model ───────────────────────────────────────────────────────────────

export async function loadModel(srcLang, tgtLang) {
  const key      = `${srcLang}-${tgtLang}`;
  const modelId  = MODEL_MAP[key];

  if (!modelId) {
    LOG(`No model for pair: ${key}`);
    return null;
  }

  if (pipelines.has(key)) return pipelines.get(key);
  if (loadingPromises.has(key)) return loadingPromises.get(key);

  LOG(`Loading model: ${modelId}`);

  const promise = (async () => {
    const { pipeline } = await getTransformers();
    const pipe = await pipeline('translation', modelId, {
      // Run in a Worker thread to avoid blocking the main offscreen thread
      // Transformers.js handles this via its own Worker internally
      quantized: true, // use int8 quantized models (much smaller/faster)
    });
    pipelines.set(key, pipe);
    loadingPromises.delete(key);
    resetInactivityTimer(key);
    LOG(`Model loaded: ${modelId}`);
    return pipe;
  })();

  loadingPromises.set(key, promise);
  return promise;
}

// ─── Translate ────────────────────────────────────────────────────────────────

/**
 * translate(text, srcLang, tgtLang) → { text, offline, modelReady }
 *
 * Returns immediately with a [offline model not ready] flag if the model
 * isn't loaded yet, so the caller can still display something.
 */
export async function translate(text, srcLang, tgtLang) {
  if (!text?.trim()) return { text: '', offline: true, modelReady: false };

  const key  = `${srcLang}-${tgtLang}`;
  const pipe = pipelines.get(key);

  if (!pipe) {
    // Model not ready — trigger load in background, return stub
    loadModel(srcLang, tgtLang).catch((err) => LOG('Background load error:', err.message));
    return {
      text: `${text} [offline model not ready]`,
      offline: true,
      modelReady: false,
    };
  }

  resetInactivityTimer(key);

  try {
    const output = await pipe(text);
    const translated = output?.[0]?.translation_text ?? text;
    LOG(`Translated: "${text}" → "${translated}"`);
    return { text: translated, offline: true, modelReady: true };
  } catch (err) {
    LOG('Translation error:', err.message);
    return { text, offline: true, modelReady: false };
  }
}

// ─── Inactivity unloading ────────────────────────────────────────────────────

function resetInactivityTimer(key) {
  clearTimeout(inactivityTimers.get(key));
  const timer = setTimeout(() => {
    LOG(`Unloading model due to inactivity: ${key}`);
    pipelines.delete(key);
    inactivityTimers.delete(key);
  }, INACTIVITY_MS);
  inactivityTimers.set(key, timer);
}
