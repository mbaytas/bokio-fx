const TAG = "[BKX ocr]";
const log = (...args) => console.log(TAG, ...args);

log("offscreen document loaded");

let workerReady = null;

async function getWorker() {
  if (workerReady) return workerReady;

  log("Tesseract worker initializing...");
  const workerPath = chrome.runtime.getURL("lib/worker-ext.js");
  const corePath = chrome.runtime.getURL("lib/tesseract-core-simd-lstm.wasm.js");
  const langPath = chrome.runtime.getURL("lib/lang/");
  log("workerPath:", workerPath);
  log("corePath:", corePath);
  log("langPath:", langPath);

  const worker = await Tesseract.createWorker("eng", 1, {
    workerPath,
    corePath,
    langPath,
    workerBlobURL: false,
    gzip: false,
  });
  log("Tesseract worker ready");

  workerReady = worker;
  return worker;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "OCR_PROCESS") return;

  log("OCR request received, image data length:", msg.imageData?.length);

  (async () => {
    try {
      const worker = await getWorker();
      log("recognition started...");
      const { data: { text } } = await worker.recognize(msg.imageData);
      log("recognition complete, text length:", text.length);
      log("OCR text (first 200 chars):", text.substring(0, 200));
      sendResponse({ ok: true, text });
    } catch (err) {
      log("OCR error:", err.message);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true;
});

log("sending OCR_READY signal to background");
chrome.runtime.sendMessage({ type: "OCR_READY" });
