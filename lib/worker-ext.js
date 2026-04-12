const _fetch = self.fetch;
self.fetch = function (url, init) {
  const urlStr = typeof url === "string" ? url : url.url;
  if (urlStr.startsWith("chrome-extension://")) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", urlStr, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = function () {
        resolve(
          new Response(xhr.response, {
            status: xhr.status,
            statusText: xhr.statusText,
          })
        );
      };
      xhr.onerror = function () {
        reject(new TypeError("Network request failed for " + urlStr));
      };
      xhr.send();
    });
  }
  return _fetch.call(self, url, init);
};

importScripts("worker.min.js");
