export function isDesktopShell() {
  return typeof window !== "undefined" && !!window.chrome?.webview;
}

export function postDesktopMessage(type, payload = {}) {
  if (!isDesktopShell()) {
    return;
  }

  try {
    window.chrome.webview.postMessage({
      type,
      ...payload,
    });
  } catch (error) {
    console.warn("Failed to post message to desktop shell:", error);
  }
}

export function subscribeDesktopMessages(handler) {
  if (!isDesktopShell() || typeof handler !== "function") {
    return () => {};
  }

  const wrappedHandler = (event) => {
    handler(event?.data || {});
  };

  window.chrome.webview.addEventListener("message", wrappedHandler);

  return () => {
    try {
      window.chrome.webview.removeEventListener("message", wrappedHandler);
    } catch {
      // No action needed.
    }
  };
}
