// Service worker keep-alive utility
// Prevents Chrome from suspending the service worker during long operations

let keepAliveInterval = null;

export function startKeepAlive() {
  if (!keepAliveInterval) {
    keepAliveInterval = setInterval(() => chrome.runtime.getPlatformInfo(), 25000);
  }
}

export function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

