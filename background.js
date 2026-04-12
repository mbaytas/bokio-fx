const TAG = "[BKX bg]";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "FETCH_RATE") return;

  const { series, from, to } = msg;
  const url = `https://api.riksbank.se/swea/v1/Observations/${series}/${from}/${to}`;
  console.log(TAG, "fetch rate:", series, from, "→", to);

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      return res.json();
    })
    .then((data) => {
      console.log(TAG, "fetch ok:", series, data.length, "observations");
      sendResponse({ ok: true, data });
    })
    .catch((err) => {
      console.log(TAG, "fetch error:", series, err.message);
      sendResponse({ ok: false, error: err.message });
    });

  return true;
});

chrome.action.onClicked.addListener((tab) => {
  console.log(TAG, "icon clicked, tab:", tab.id, tab.url);
  chrome.tabs.sendMessage(tab.id, { type: "ICON_CLICKED" });
});
