chrome.webRequest.onCompleted.addListener(
  function(details) {
    chrome.storage.local.set({ lastHeaders: details.responseHeaders });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);
