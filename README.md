# Bokio Currency Converter

Chrome extension that automatically detects foreign currencies on [Bokio](https://www.bokio.se) invoice pages and converts amounts to SEK using official Riksbanken exchange rates.

## Features

- **OCR-powered currency detection** — Uses Tesseract.js to read receipt/invoice images and detect the currency (EUR, USD, GBP, and 20+ others)
- **Riksbanken exchange rates** — Fetches official rates from the Swedish central bank API for the payment date
- **One-click conversion** — Converts the foreign amount to SEK and applies it to the Bokio form
- **Seller country suggestion** — Detects the seller's country from the invoice and shows whether the "Säljarens land" field matches (EU / non-EU / Sverige)
- **SEK invoice detection** — Automatically skips conversion for domestic invoices
- **Manual override** — Click the currency label to switch to a different currency, or use the picker if auto-detection fails

## How it works

1. When you open an accounting entry on `app.bokio.se`, the extension looks for a receipt image
2. The image is sent to a local Tesseract.js OCR engine (runs entirely in-browser, no data leaves your machine)
3. The OCR text is scanned for currency codes, symbols, and country names
4. If a foreign currency is detected, a toast shows the converted SEK amount with an Apply button
5. If the seller's country is detected, an indicator shows whether the Bokio form field matches

## Installation

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select this directory

## Architecture

```
content.js          Content script injected on app.bokio.se
                    Finds receipt image, captures to canvas, shows toast UI

background.js       Service worker
                    Proxies Riksbanken API calls, manages offscreen document

offscreen.html/js   Hidden extension page
                    Runs Tesseract.js OCR (needs DOM/WASM access)

lib/                Tesseract.js v5.1.1 (bundled locally)
  tesseract.min.js    Main library
  worker-ext.js       Worker wrapper (patches fetch for chrome-extension:// URLs)
  worker.min.js       Tesseract web worker
  tesseract-core-*.js WASM cores (simd, lstm, simd-lstm variants)
  lang/eng.traineddata English language model

style.css           Toast UI styles
manifest.json       Chrome MV3 manifest
```

## Tech

- Chrome Extension Manifest V3
- Tesseract.js 5.1.1 with WASM (local, no network OCR)
- Riksbanken SWEA API for exchange rates
- Offscreen Documents API for MV3-compatible WASM execution

## License

MIT
