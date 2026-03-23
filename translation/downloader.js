// translation/downloader.js — Language pack downloader
// Triggers model download via Transformers.js and reports progress to sidepanel
const LOG = (...args) => console.debug('[LinguaLive/downloader]', ...args);

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
};

/**
 * downloadLanguagePack(key)
 * key: e.g. "fr-en"
 * Emits DOWNLOAD_PROGRESS messages to background (which forwards to sidepanel)
 */
export async function downloadLanguagePack(key) {
  const modelId = MODEL_MAP[key];
  if (!modelId) {
    LOG(`Unknown language pack: ${key}`);
    return;
  }

  LOG(`Starting download: ${modelId}`);
  emitProgress(key, 0, false);

  try {
    const { pipeline, env } = await import(
      'https://cdn.jsdelivr.net/npm/@xenova/transformers@2/dist/transformers.min.js'
    );

    env.allowRemoteModels = true;
    env.useBrowserCache   = true;

    // Transformers.js accepts a progress_callback option
    await pipeline('translation', modelId, {
      quantized: true,
      progress_callback: (progressInfo) => {
        // progressInfo: { status, file, loaded, total, progress }
        if (progressInfo.status === 'downloading') {
          const percent = Math.round(progressInfo.progress ?? 0);
          emitProgress(key, percent, false);
        } else if (progressInfo.status === 'done') {
          emitProgress(key, 100, false);
        }
      },
    });

    // Mark as downloaded in storage
    const { downloadedPacks = [] } = await chrome.storage.local.get('downloadedPacks');
    if (!downloadedPacks.includes(key)) {
      await chrome.storage.local.set({ downloadedPacks: [...downloadedPacks, key] });
    }

    emitProgress(key, 100, true);
    LOG(`Download complete: ${modelId}`);
  } catch (err) {
    LOG(`Download failed for ${key}:`, err.message);
    emitProgress(key, 0, false, true /* error */);
  }
}

function emitProgress(key, percent, done, error = false) {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    payload: { key, percent, done, error },
  });
}
