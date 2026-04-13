// Bokio FX — Foreign Currency → SEK Converter

(function () {
  "use strict";

  const TAG = "[BFX]";
  const log = (...args) => console.log(TAG, ...args);

  const CURRENCIES = {
    EUR: { series: "SEKEURPMI", symbol: "€",  name: "Euro" },
    USD: { series: "SEKUSDPMI", symbol: "$",  name: "US Dollar" },
    GBP: { series: "SEKGBPPMI", symbol: "£",  name: "British Pound" },
    TRY: { series: "SEKTRYPMI", symbol: "₺",  name: "Turkish Lira" },
    NOK: { series: "SEKNOKPMI", symbol: "",   name: "Norwegian Krone" },
    DKK: { series: "SEKDKKPMI", symbol: "",   name: "Danish Krone" },
    CHF: { series: "SEKCHFPMI", symbol: "",   name: "Swiss Franc" },
    JPY: { series: "SEKJPYPMI", symbol: "¥",  name: "Japanese Yen" },
    CAD: { series: "SEKCADPMI", symbol: "",   name: "Canadian Dollar" },
    AUD: { series: "SEKAUDPMI", symbol: "",   name: "Australian Dollar" },
    NZD: { series: "SEKNZDPMI", symbol: "",   name: "New Zealand Dollar" },
    PLN: { series: "SEKPLNPMI", symbol: "",   name: "Polish Zloty" },
    CZK: { series: "SEKCZKPMI", symbol: "",   name: "Czech Koruna" },
    HUF: { series: "SEKHUFPMI", symbol: "",   name: "Hungarian Forint" },
    CNY: { series: "SEKCNYPMI", symbol: "",   name: "Chinese Yuan" },
    HKD: { series: "SEKHKDPMI", symbol: "",   name: "Hong Kong Dollar" },
    INR: { series: "SEKINRPMI", symbol: "₹",  name: "Indian Rupee" },
    KRW: { series: "SEKKRWPMI", symbol: "₩",  name: "South Korean Won" },
    SGD: { series: "SEKSGDPMI", symbol: "",   name: "Singapore Dollar" },
    THB: { series: "SEKTHBPMI", symbol: "",   name: "Thai Baht" },
    MXN: { series: "SEKMXNPMI", symbol: "",   name: "Mexican Peso" },
    ZAR: { series: "SEKZARPMI", symbol: "",   name: "South African Rand" },
    BRL: { series: "SEKBRLPMI", symbol: "R$", name: "Brazilian Real" },
    ISK: { series: "SEKISKPMI", symbol: "",   name: "Icelandic Krona" },
  };

  const SYMBOL_TO_CODE = {};
  for (const [code, info] of Object.entries(CURRENCIES)) {
    if (info.symbol) SYMBOL_TO_CODE[info.symbol] = code;
  }

  const EU_COUNTRIES = new Set([
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic",
    "czechia", "denmark", "estonia", "finland", "france", "germany", "greece",
    "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg",
    "malta", "netherlands", "poland", "portugal", "romania", "slovakia",
    "slovenia", "spain",
  ]);
  const SWEDEN_NAMES = new Set(["sweden", "sverige"]);

  function detectSellerRegion(ocrText) {
    if (!ocrText) return null;
    const text = ocrText.toLowerCase();
    const countryPattern = /\b(?:austria|belgium|bulgaria|croatia|cyprus|czech\s*republic|czechia|denmark|estonia|finland|france|germany|greece|hungary|ireland|italy|latvia|lithuania|luxembourg|malta|netherlands|holland|poland|portugal|romania|slovakia|slovenia|spain|sweden|sverige|united\s*states|united\s*kingdom|great\s*britain|england|scotland|wales|norway|switzerland|japan|china|canada|australia|new\s*zealand|brazil|mexico|india|south\s*korea|singapore|thailand|south\s*africa|iceland|turkey|türkiye|hong\s*kong|taiwan)\b/gi;
    const found = [];
    let m;
    while ((m = countryPattern.exec(text)) !== null) {
      found.push(m[0].trim().toLowerCase());
    }
    log("countries found in OCR text:", found);

    const foreign = found.filter((c) => !SWEDEN_NAMES.has(c));
    if (foreign.length === 0) {
      if (found.length > 0) {
        log("only Sweden found — domestic invoice");
        return "Sverige";
      }
      log("no country detected in OCR text");
      return null;
    }

    const country = foreign[0];
    log("seller country detected:", country);
    if (EU_COUNTRIES.has(country) || (country === "holland")) {
      return "Från EU-land";
    }
    return "Från icke EU-land";
  }

  function getCurrentSellerCountry() {
    const toggle = document.querySelector('[data-testid="MultiSelect_ToggleButton"]');
    if (!toggle) return null;
    return toggle.textContent.trim();
  }

  const rateCache = {};
  let containerEl = null;
  let toastEl = null;
  let lastState = "";
  let hasRun = false;
  let suppressed = false;
  let converting = false;

  let activeCurrency = null;
  let activeRegion = null;
  let convertToast = null;
  let convertId = 0;
  let amountApplied = false;
  let regionCleanup = null;

  // ── Toast container ─────────────────────────────────────────────

  function getContainer() {
    if (containerEl && containerEl.parentElement) return containerEl;
    containerEl = document.createElement("div");
    containerEl.className = "bfx-toast-container";
    containerEl.setAttribute("role", "status");
    containerEl.setAttribute("aria-live", "polite");
    document.body.appendChild(containerEl);
    return containerEl;
  }

  function dismissToast(animate) {
    if (!toastEl) return;
    log("dismiss toast", animate !== false ? "(animate)" : "(instant)");
    if (regionCleanup) { regionCleanup(); regionCleanup = null; }
    convertToast = null;
    amountApplied = false;
    prevRateText = "";
    prevResultText = "";
    if (animate !== false) {
      toastEl.classList.add("bfx-toast-dismiss");
      const el = toastEl;
      setTimeout(() => el.remove(), 400);
    } else {
      toastEl.remove();
    }
    toastEl = null;
  }

  function showToast(html, opts = {}) {
    log("show toast", opts.error ? "(error)" : "");
    dismissToast(false);
    const container = getContainer();
    const stale = container.querySelectorAll(".bfx-toast");
    if (stale.length) log("removing", stale.length, "stale toast(s)");
    for (const el of stale) el.remove();

    toastEl = document.createElement("div");
    toastEl.className = "bfx-toast" + (opts.error ? " bfx-toast-error" : "");
    toastEl.innerHTML = html;

    const closeBtn = toastEl.querySelector(".bfx-toast-close");
    if (closeBtn) closeBtn.addEventListener("click", () => dismissToast(true));

    container.appendChild(toastEl);
    return toastEl;
  }

  // ── Riksbanken API (via background worker) ──────────────────────

  function fetchRate(currency, dateStr) {
    return new Promise((resolve, reject) => {
      const info = CURRENCIES[currency];
      if (!info) return reject(new Error(`Unknown currency: ${currency}`));

      const cacheKey = `${currency}_${dateStr}`;
      if (rateCache[cacheKey]) {
        log("rate cache hit:", cacheKey, rateCache[cacheKey]);
        return resolve(rateCache[cacheKey]);
      }

      const to = new Date(dateStr);
      const from = new Date(to);
      from.setDate(from.getDate() - 10);
      const fmt = (d) => d.toISOString().slice(0, 10);

      log("fetch rate:", currency, "series:", info.series, "range:", fmt(from), "→", fmt(to));
      chrome.runtime.sendMessage(
        { type: "FETCH_RATE", series: info.series, from: fmt(from), to: fmt(to) },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response || !response.ok) {
            return reject(new Error(response?.error || "Failed to fetch rate"));
          }

          const data = response.data;
          if (!Array.isArray(data) || data.length === 0) {
            return reject(new Error(`No rate for ${currency} near ${dateStr}`));
          }

          let best = data[0];
          for (const obs of data) {
            if (obs.date <= dateStr) best = obs;
          }

          const rate = parseFloat(best.value);
          if (isNaN(rate)) return reject(new Error("Invalid rate value"));

          const result = { rate, date: best.date };
          rateCache[cacheKey] = result;
          log("rate fetched:", currency, "=", rate, "on", best.date);
          resolve(result);
        }
      );
    });
  }

  // ── DOM helpers ─────────────────────────────────────────────────

  function getAmountInput() {
    return (
      document.querySelector("#key_amount") ||
      document.querySelector('[data-testid="$Amount_Input"]')
    );
  }

  function getPaymentDate() {
    const el =
      document.querySelector("#key_paymentDate") ||
      document.querySelector('[data-testid="$PaymentDate_Input"]');
    if (el && /^\d{4}-\d{2}-\d{2}$/.test(el.value.trim())) {
      return el.value.trim();
    }
    return null;
  }

  function parseAmount(raw) {
    const val = parseFloat(raw.replace(/\s/g, "").replace(",", "."));
    return isNaN(val) ? null : val;
  }

  const OCR_PATTERNS = [
    { pattern: /\bSEK\b/,                          code: "SEK" },
    { pattern: /\bkronor\b/i,                       code: "SEK" },
    { pattern: /€/,                               code: "EUR" },
    { pattern: /\bEUR\b/,                          code: "EUR" },
    { pattern: /\bEuro\b/i,                        code: "EUR" },
    { pattern: /[€E¢C]\s*\d[\d.,]*\d{2}\b/,        code: "EUR" },
    { pattern: /\d[\d.,]*\d{2}\s*[€]/,             code: "EUR" },
    { pattern: /\bUSD\b/,                          code: "USD" },
    { pattern: /\$\s*\d[\d.,]*\d{2}\b/,            code: "USD" },
    { pattern: /\d[\d.,]*\d{2}\s*\$/,              code: "USD" },
    { pattern: /£/,                                code: "GBP" },
    { pattern: /\bGBP\b/,                          code: "GBP" },
    { pattern: /£\s*\d[\d.,]*\d{2}\b/,             code: "GBP" },
    { pattern: /₺/,                                code: "TRY" },
    { pattern: /\bTRY\b/,                          code: "TRY" },
    { pattern: /¥/,                                code: "JPY" },
    { pattern: /\bJPY\b/,                          code: "JPY" },
    { pattern: /₹/,                                code: "INR" },
    { pattern: /\bINR\b/,                          code: "INR" },
    { pattern: /₩/,                                code: "KRW" },
    { pattern: /\bKRW\b/,                          code: "KRW" },
    { pattern: /R\$/,                              code: "BRL" },
    { pattern: /\bBRL\b/,                          code: "BRL" },
    { pattern: /\bNOK\b/,                          code: "NOK" },
    { pattern: /\bDKK\b/,                          code: "DKK" },
    { pattern: /\bCHF\b/,                          code: "CHF" },
    { pattern: /\bCAD\b/,                          code: "CAD" },
    { pattern: /\bAUD\b/,                          code: "AUD" },
    { pattern: /\bNZD\b/,                          code: "NZD" },
    { pattern: /\bPLN\b/,                          code: "PLN" },
    { pattern: /\bCZK\b/,                          code: "CZK" },
    { pattern: /\bHUF\b/,                          code: "HUF" },
    { pattern: /\bCNY\b/,                          code: "CNY" },
    { pattern: /\bHKD\b/,                          code: "HKD" },
    { pattern: /\bSGD\b/,                          code: "SGD" },
    { pattern: /\bTHB\b/,                          code: "THB" },
    { pattern: /\bMXN\b/,                          code: "MXN" },
    { pattern: /\bZAR\b/,                          code: "ZAR" },
    { pattern: /\bISK\b/,                          code: "ISK" },
  ];

  function detectCurrencyInText(text, source) {
    log("scanning text for currency (" + source + "), length:", text.length);
    log("OCR text:", text);

    for (const { pattern, code } of OCR_PATTERNS) {
      const found = pattern.test(text);
      if (found) {
        const match = text.match(pattern);
        log("detected currency:", code, "via pattern", pattern.toString(), "matched:", match?.[0]);
        return code;
      }
    }
    log("no currency found in", source);
    return null;
  }

  async function ocrDetectCurrency() {
    log("looking for receipt image...");
    const img = document.querySelector('img[data-testid="ReceiptPageViewInReceiptOverview_Image"]');
    if (!img) {
      log("no receipt image found");
      return { currency: null, region: null };
    }
    log("receipt image found, src:", img.src?.substring(0, 80) + "...");

    try {
      let dataUrl;
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        log("canvas size:", w, "x", h);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        dataUrl = canvas.toDataURL("image/png");
        log("image captured via canvas, base64 length:", dataUrl.length);
      } catch (canvasErr) {
        log("canvas tainted (cross-origin), fetching image directly...");
        const resp = await fetch(img.src);
        const blob = await resp.blob();
        dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
        log("image fetched directly, base64 length:", dataUrl.length);
      }

      log("sending image to OCR...");
      const OCR_TIMEOUT = 30000;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          log("OCR timed out after", OCR_TIMEOUT + "ms");
          resolve({ ok: false, error: "OCR timed out" });
        }, OCR_TIMEOUT);
        chrome.runtime.sendMessage(
          { type: "OCR_IMAGE", imageData: dataUrl },
          (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            resolve(response);
          }
        );
      });

      if (!result?.ok) {
        log("OCR failed:", result?.error);
        return null;
      }

      log("OCR raw text:", result.text);
      const currency = detectCurrencyInText(result.text, "OCR");
      const region = detectSellerRegion(result.text);
      return { currency, region };
    } catch (err) {
      log("OCR error:", err.message);
      return { currency: null, region: null };
    }
  }

  function setReactInputValue(input, value) {
    log("set input value:", value);
    const nativeSet = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    ).set;
    nativeSet.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  // ── Number flow animation ───────────────────────────────────────

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let prevRateText = "";
  let prevResultText = "";

  function numberFlow(el, text, prev) {
    if (!prev || reducedMotion.matches) {
      el.textContent = text;
      return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const pch = i < prev.length ? prev[i] : null;

      if (/\d/.test(ch) && pch && /\d/.test(pch) && ch !== pch) {
        const slot = document.createElement("span");
        slot.className = "bfx-nf";
        slot.textContent = ch;
        const up = +ch > +pch;
        slot.animate([
          { transform: `translateY(${up ? "30%" : "-30%"})`, opacity: 0 },
          { transform: "translateY(0)", opacity: 1 }
        ], { duration: 400, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
        frag.appendChild(slot);
      } else {
        frag.appendChild(document.createTextNode(ch));
      }
    }
    el.textContent = "";
    el.appendChild(frag);
  }

  // ── Toast views ─────────────────────────────────────────────────

  function buildCurrencyOptions(selected) {
    return Object.entries(CURRENCIES)
      .map(([code, info]) => {
        const label = info.symbol ? `${info.symbol} ${code}` : code;
        const sel = code === selected ? " selected" : "";
        return `<option value="${code}"${sel}>${label} – ${info.name}</option>`;
      })
      .join("");
  }

  function showPicker() {
    log("showing currency picker");
    showToast(`
      <div class="bfx-toast-topbar">
        <span class="bfx-toast-brand">BOKIO-FX</span>
        <button class="bfx-toast-close" aria-label="Close">✕</button>
      </div>
      <div class="bfx-toast-header">
        <span class="bfx-toast-title">Select currency</span>
      </div>
      <div data-role="content">
        <select class="bfx-toast-select" aria-label="Currency">
          ${buildCurrencyOptions()}
        </select>
      </div>
    `);

    toastEl.querySelector("select").addEventListener("change", (e) => {
      if (e.target.value) convert(e.target.value);
    });
  }

  // ── Conversion flow ─────────────────────────────────────────────

  function setupRegionIndicator(container, region) {
    if (regionCleanup) { regionCleanup(); regionCleanup = null; }
    if (!region) return;

    const el = container.querySelector('[data-role="region-indicator"]');
    if (!el) return;

    function update() {
      const current = getCurrentSellerCountry();
      const match = current && current.includes(region);
      log("region indicator:", region, "current:", current, "match:", match);
      el.className = "bfx-toast-region " + (match ? "bfx-region-ok" : "bfx-region-warn");
      el.innerHTML = `
        <span class="bfx-toast-region-icon"></span>
        <span class="bfx-toast-region-label">Säljarens land: ${region}</span>
      `;
      if (amountApplied && match) {
        log("region now matches after apply — auto-dismissing");
        setTimeout(dismissToast, 800);
      }
    }
    update();

    const deferred = () => setTimeout(update, 300);
    document.addEventListener("click", deferred, true);
    document.addEventListener("keyup", deferred, true);
    regionCleanup = () => {
      document.removeEventListener("click", deferred, true);
      document.removeEventListener("keyup", deferred, true);
    };
  }

  async function convert(currency, region) {
    if (region !== undefined) activeRegion = region;
    activeCurrency = currency;
    const thisId = ++convertId;

    log("convert:", currency, "region:", activeRegion);
    const amountInput = getAmountInput();
    const dateStr = getPaymentDate();
    if (!amountInput || !dateStr) {
      log("convert: missing inputs — amount:", !!amountInput, "date:", dateStr);
      return;
    }

    const amount = parseAmount(amountInput.value);
    if (!amount || amount <= 0) {
      log("convert: invalid amount:", amountInput.value);
      return;
    }

    converting = true;
    amountApplied = false;
    const sym = CURRENCIES[currency]?.symbol || "";

    if (regionCleanup) { regionCleanup(); regionCleanup = null; }

    const canReuse = convertToast && convertToast.parentElement
      && convertToast.querySelector('[data-role="currency-change"]');

    let currentToast;

    if (canReuse) {
      log("convert: reusing toast for", currency);
      currentToast = convertToast;

      currentToast.querySelector(".bfx-toast-title").innerHTML =
        `<span class="bfx-toast-currency" data-action="change">${sym} ${currency}</span> <span class="bfx-toast-arrow">→</span> SEK`;

      const sel = currentToast.querySelector('[data-role="currency-change"]');
      sel.innerHTML = buildCurrencyOptions(currency);
      sel.classList.add("bfx-toast-select-hidden");

      currentToast.classList.add("bfx-toast-updating");
    } else {
      showToast(`
        <div class="bfx-toast-topbar">
          <span class="bfx-toast-brand">BOKIO-FX</span>
          <button class="bfx-toast-close" aria-label="Close">✕</button>
        </div>
        <div class="bfx-toast-header">
          <span class="bfx-toast-title"><span class="bfx-toast-currency" data-action="change">${sym} ${currency}</span> <span class="bfx-toast-arrow">→</span> SEK</span>
        </div>
        <select class="bfx-toast-select bfx-toast-select-hidden" data-role="currency-change" aria-label="Currency">
          ${buildCurrencyOptions(currency)}
        </select>
        <div data-role="content">
          <div class="bfx-toast-loading" aria-live="polite">
            <span class="bfx-toast-spinner"></span>
            Fetching rate…
          </div>
        </div>
      `);

      currentToast = toastEl;
      convertToast = currentToast;

      currentToast.addEventListener("click", (e) => {
        const a = e.target.closest("[data-action]");
        if (!a) return;
        if (a.dataset.action === "change") {
          const sel = currentToast.querySelector('[data-role="currency-change"]');
          sel.classList.remove("bfx-toast-select-hidden");
          try { sel.showPicker(); } catch (_) { sel.focus(); }
        } else if (a.dataset.action === "dismiss") {
          dismissToast(true);
        }
      });

      currentToast.querySelector('[data-role="currency-change"]')
        .addEventListener("change", (e) => {
          if (e.target.value && e.target.value !== activeCurrency) {
            convert(e.target.value);
          }
        });
    }

    try {
      const { rate, date: rateDate } = await fetchRate(currency, dateStr);
      const sekAmount = amount * rate;

      if (thisId !== convertId) {
        log("convert: superseded by newer conversion");
        return;
      }
      if (!currentToast.parentElement) {
        log("convert: toast removed during fetch");
        return;
      }

      log("convert result:", amount, currency, "×", rate, "=", sekAmount, "SEK (rate date:", rateDate + ")");
      const fmtAmount = amount.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtSek = sekAmount.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtRate = rate.toFixed(4);

      currentToast.classList.remove("bfx-toast-updating");

      const contentEl = currentToast.querySelector('[data-role="content"]');
      const inPlace = canReuse && contentEl.querySelector(".bfx-rate-panel");

      if (inPlace) {
        log("convert: in-place update");
        contentEl.querySelector(".bfx-rate-amount").textContent = `${fmtAmount} ${currency}`;
        numberFlow(contentEl.querySelector(".bfx-rate-value"), fmtRate, prevRateText);
        contentEl.querySelector(".bfx-rate-source").textContent = `Riksbanken rate on ${rateDate}`;
        numberFlow(contentEl.querySelector(".bfx-result-value"), fmtSek, prevResultText);

        const oldBtn = contentEl.querySelector('[data-action="apply"]');
        const freshBtn = oldBtn.cloneNode(true);
        freshBtn.textContent = "Apply";
        freshBtn.classList.remove("bfx-applied");
        oldBtn.replaceWith(freshBtn);

        setupRegionIndicator(contentEl, activeRegion);
      } else {
        contentEl.innerHTML = `
          <div class="bfx-rate-panel">
            <div class="bfx-rate-row">
              <span class="bfx-rate-amount">${fmtAmount} ${currency}</span>
              <span class="bfx-rate-op">×</span>
              <span class="bfx-rate-value"></span>
            </div>
            <div class="bfx-rate-meta">
              <span class="bfx-rate-source">Riksbanken rate on ${rateDate}</span>
            </div>
          </div>
          <div class="bfx-result-row">
            <span class="bfx-result-value"></span>
            <span class="bfx-result-unit">SEK</span>
          </div>
          <div class="bfx-toast-actions">
            <button class="bfx-toast-btn bfx-toast-btn-primary" data-action="apply">Apply</button>
            <button class="bfx-toast-btn bfx-toast-btn-secondary" data-action="dismiss">Dismiss</button>
          </div>
          ${activeRegion ? `<div class="bfx-toast-region" data-role="region-indicator"></div>` : ""}
        `;

        numberFlow(contentEl.querySelector(".bfx-rate-value"), fmtRate, prevRateText);
        numberFlow(contentEl.querySelector(".bfx-result-value"), fmtSek, prevResultText);

        setupRegionIndicator(contentEl, activeRegion);
      }

      prevRateText = fmtRate;
      prevResultText = fmtSek;

      contentEl.querySelector('[data-action="apply"]')
        .addEventListener("click", (e) => {
          log("apply:", fmtSek, "SEK");
          const sekStr = sekAmount.toFixed(2).replace(".", ",");
          setReactInputValue(amountInput, sekStr);
          e.target.textContent = "Applied ✓";
          e.target.classList.add("bfx-applied");
          suppressed = true;
          amountApplied = true;

          const regionMatch = !activeRegion
            || (getCurrentSellerCountry() && getCurrentSellerCountry().includes(activeRegion));
          log("post-apply region check:", regionMatch);
          if (regionMatch) {
            setTimeout(dismissToast, 800);
          }
        });
    } catch (err) {
      log("convert error:", err.message);
      if (thisId !== convertId || !currentToast.parentElement) return;

      currentToast.querySelector('[data-role="content"]').innerHTML = `
        <div class="bfx-toast-body bfx-toast-error-msg">
          ${err.message}
        </div>
      `;
      currentToast.classList.add("bfx-toast-error");
    } finally {
      converting = false;
    }
  }

  // ── Main ────────────────────────────────────────────────────────

  async function run(manual) {
    log("run()", manual ? "(manual)" : "(auto)");
    const dateEl = document.querySelector(
      '#key_paymentDate, [data-testid="$PaymentDate_Input"]'
    );
    if (!dateEl) {
      log("run: no payment date field, resetting");
      if (toastEl) dismissToast(true);
      lastState = "";
      hasRun = false;
      suppressed = false;
      return;
    }

    if (suppressed) { log("run: suppressed, skipping"); return; }
    if (converting) { log("run: conversion in progress, skipping"); return; }

    const amountInput = getAmountInput();
    if (!amountInput) { log("run: no amount input"); return; }

    const dateStr = getPaymentDate();
    if (!dateStr) { log("run: no valid date"); return; }

    const amount = parseAmount(amountInput.value);
    if (!amount || amount <= 0) { log("run: invalid amount:", amountInput.value); return; }

    if (hasRun && !manual) { log("run: already handled, skipping auto"); return; }

    hasRun = true;
    log("run: inputs ready, starting OCR detection...");
    showToast(`
      <div class="bfx-toast-topbar">
        <span class="bfx-toast-brand">BOKIO-FX</span>
        <button class="bfx-toast-close" aria-label="Close">✕</button>
      </div>
      <div class="bfx-toast-header">
        <span class="bfx-toast-title">Reading receipt…</span>
      </div>
      <div data-role="content">
        <div class="bfx-toast-loading" aria-live="polite">
          <span class="bfx-toast-spinner"></span>
          Scanning for currency…
        </div>
      </div>
    `);

    const { currency: detected, region } = await ocrDetectCurrency();

    if (detected === "SEK") {
      log("run: receipt is in SEK (via OCR), no conversion needed");
      dismissToast(false);
    } else if (detected) {
      const state = `${detected}_${amount}_${dateStr}`;
      log("run: OCR detected", detected, "region:", region, "— state:", state);
      lastState = state;
      await convert(detected, region);
    } else {
      log("run: OCR found no currency, showing picker");
      showPicker();
    }
  }

  // ── Extension icon click ────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "ICON_CLICKED") {
      log("extension icon clicked — resetting state");
      suppressed = false;
      lastState = "";
      hasRun = false;
      run(true);
    }
  });

  // ── Observer ────────────────────────────────────────────────────

  let debounceTimer = null;
  function scheduleRun() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 1000);
  }

  const observer = new MutationObserver(scheduleRun);
  observer.observe(document.body, { childList: true, subtree: true });
  log("content script loaded, observer started");
  scheduleRun();
})();
