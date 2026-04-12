// Bokio Foreign Currency → SEK Converter
// Sonner-style toast in top-right corner

(function () {
  "use strict";

  const TAG = "[BKX]";
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

  const rateCache = {};
  let containerEl = null;
  let toastEl = null;
  let lastState = "";
  let hasRun = false;
  let suppressed = false;
  let converting = false;
  let retryCount = 0;

  // ── Toast container ─────────────────────────────────────────────

  function getContainer() {
    if (containerEl && containerEl.parentElement) return containerEl;
    containerEl = document.createElement("div");
    containerEl.className = "bkx-toast-container";
    document.body.appendChild(containerEl);
    return containerEl;
  }

  function dismissToast(animate) {
    if (!toastEl) return;
    log("dismiss toast", animate !== false ? "(animate)" : "(instant)");
    if (animate !== false) {
      toastEl.classList.add("bkx-toast-dismiss");
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
    const stale = container.querySelectorAll(".bkx-toast");
    if (stale.length) log("removing", stale.length, "stale toast(s)");
    for (const el of stale) el.remove();

    toastEl = document.createElement("div");
    toastEl.className = "bkx-toast" + (opts.error ? " bkx-toast-error" : "");
    toastEl.innerHTML = html;

    const closeBtn = toastEl.querySelector(".bkx-toast-close");
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

  function autoDetectCurrency() {
    const text = document.body.textContent;
    for (const code of Object.keys(CURRENCIES)) {
      if (new RegExp(`\\b${code}\\b`).test(text)) {
        log("auto-detected currency:", code, "(by code)");
        return code;
      }
    }
    for (const [symbol, code] of Object.entries(SYMBOL_TO_CODE)) {
      if (text.includes(symbol)) {
        log("auto-detected currency:", code, "(by symbol", symbol + ")");
        return code;
      }
    }
    log("auto-detect: no currency found");
    return null;
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
      <div class="bkx-toast-header">
        <span class="bkx-toast-title">Select currency</span>
        <button class="bkx-toast-close">✕</button>
      </div>
      <div data-role="content">
        <select class="bkx-toast-select">
          <option value="">Choose…</option>
          ${buildCurrencyOptions()}
        </select>
      </div>
    `);

    toastEl.querySelector("select").addEventListener("change", (e) => {
      if (e.target.value) convert(e.target.value);
    });
  }

  // ── Conversion flow ─────────────────────────────────────────────

  async function convert(currency) {
    log("convert:", currency);
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

    log("convert:", amount, currency, "on", dateStr);
    converting = true;
    const sym = CURRENCIES[currency]?.symbol || "";

    showToast(`
      <div class="bkx-toast-header">
        <span class="bkx-toast-title">${sym} ${currency} <span class="bkx-toast-arrow">→</span> SEK</span>
        <span class="bkx-toast-header-right">
          <button class="bkx-toast-change" data-action="change">Change</button>
          <button class="bkx-toast-close">✕</button>
        </span>
      </div>
      <select class="bkx-toast-select bkx-toast-select-hidden" data-role="currency-change">
        ${buildCurrencyOptions(currency)}
      </select>
      <div data-role="content">
        <div class="bkx-toast-loading">
          <span class="bkx-toast-spinner"></span>
          Fetching rate…
        </div>
      </div>
    `);

    const currentToast = toastEl;

    currentToast.querySelector('[data-action="change"]').addEventListener("click", () => {
      currentToast.querySelector('[data-role="currency-change"]')
        .classList.toggle("bkx-toast-select-hidden");
    });

    currentToast.querySelector('[data-role="currency-change"]').addEventListener("change", (e) => {
      if (e.target.value && e.target.value !== currency) {
        convert(e.target.value);
      }
    });

    try {
      const { rate, date: rateDate } = await fetchRate(currency, dateStr);
      const sekAmount = amount * rate;

      if (toastEl !== currentToast) {
        log("convert: toast replaced during fetch, aborting");
        return;
      }

      log("convert result:", amount, currency, "×", rate, "=", sekAmount, "SEK (rate date:", rateDate + ")");
      const fmtAmount = amount.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fmtSek = sekAmount.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      currentToast.querySelector('[data-role="content"]').innerHTML = `
        <div class="bkx-toast-body">
          <span class="bkx-toast-calc">${fmtAmount} × ${rate.toFixed(4)}</span>
          <span class="bkx-toast-date">${rateDate}</span>
        </div>
        <div class="bkx-toast-result">${fmtSek} kr</div>
        <div class="bkx-toast-actions">
          <button class="bkx-toast-btn bkx-toast-btn-primary" data-action="apply">Apply</button>
          <button class="bkx-toast-btn bkx-toast-btn-secondary" data-action="dismiss">Dismiss</button>
        </div>
      `;

      currentToast.querySelector('[data-action="apply"]').addEventListener("click", (e) => {
        log("apply:", fmtSek, "kr");
        const sekStr = sekAmount.toFixed(2).replace(".", ",");
        setReactInputValue(amountInput, sekStr);
        e.target.textContent = "Applied ✓";
        e.target.classList.add("bkx-applied");
        suppressed = true;
        setTimeout(dismissToast, 800);
      });

      currentToast.querySelector('[data-action="dismiss"]').addEventListener("click", () => dismissToast(true));
    } catch (err) {
      log("convert error:", err.message);
      if (toastEl !== currentToast) return;

      currentToast.querySelector('[data-role="content"]').innerHTML = `
        <div class="bkx-toast-body bkx-toast-error-msg">
          ${err.message}
        </div>
      `;
      currentToast.classList.add("bkx-toast-error");
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
      retryCount = 0;
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

    const detected = autoDetectCurrency();

    if (detected) {
      retryCount = 0;
      const state = `${detected}_${amount}_${dateStr}`;
      if (state === lastState) { log("run: state unchanged:", state); return; }
      log("run: new state:", state, "(was:", lastState + ")");
      hasRun = true;
      lastState = state;
      await convert(detected);
    } else if (manual) {
      log("run: no currency detected, showing picker (manual)");
      showPicker();
    } else if (hasRun) {
      log("run: no currency detected, already shown picker");
    } else if (retryCount < 5) {
      retryCount++;
      const delay = retryCount * 500;
      log("run: no currency detected, retry", retryCount, "in", delay + "ms");
      setTimeout(run, delay);
    } else {
      log("run: no currency detected after retries, showing picker");
      hasRun = true;
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
      retryCount = 0;
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
