const TAG = "[BFX bg]";
const log = (...args) => console.log(TAG, ...args);

let offscreenPromise = null;
let offscreenReadyResolve = null;

function ensureOffscreen() {
  if (offscreenPromise) return offscreenPromise;

  offscreenPromise = (async () => {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      log("offscreen document found (from previous session)");
      return;
    }

    const readySignal = new Promise((resolve) => {
      offscreenReadyResolve = resolve;
    });

    log("creating offscreen document...");
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Tesseract.js OCR processing",
    });
    log("offscreen document created, waiting for ready signal...");

    await readySignal;
    log("offscreen document ready");
  })();

  return offscreenPromise;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OCR_READY") {
    log("received OCR_READY from offscreen");
    if (offscreenReadyResolve) offscreenReadyResolve();
    return;
  }

  if (msg.type === "FETCH_RATE") {
    const { series, from, to } = msg;
    const url = `https://api.riksbank.se/swea/v1/Observations/${series}/${from}/${to}`;
    log("fetch rate:", series, from, "→", to);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        log("fetch ok:", series, data.length, "observations");
        sendResponse({ ok: true, data });
      })
      .catch((err) => {
        log("fetch error:", series, err.message);
        sendResponse({ ok: false, error: err.message });
      });

    return true;
  }

  if (msg.type === "OCR_IMAGE") {
    log("OCR_IMAGE received from content script, data length:", msg.imageData?.length);

    (async () => {
      try {
        await ensureOffscreen();
        log("forwarding image to offscreen, data length:", msg.imageData?.length);
        const result = await chrome.runtime.sendMessage({
          type: "OCR_PROCESS",
          imageData: msg.imageData,
        });
        log("OCR result received:", JSON.stringify(result)?.substring(0, 200));
        if (!result || !result.ok) {
          log("offscreen returned failure:", result?.error);
          sendResponse({ ok: false, error: result?.error || "OCR returned no result" });
          return;
        }
        log("sending OCR result back to content script, text length:", result.text?.length);
        sendResponse(result);
      } catch (err) {
        log("OCR pipeline error:", err.message);
        sendResponse({ ok: false, error: err.message });
      }
    })();

    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  log("icon clicked, tab:", tab.id, tab.url);
  chrome.tabs.sendMessage(tab.id, { type: "ICON_CLICKED" });
});
