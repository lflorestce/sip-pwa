export const desktopBridgeScript = String.raw`
(function() {
  window.__desktopDialQueue = window.__desktopDialQueue || [];
  window.__desktopBridgeLogs = window.__desktopBridgeLogs || [];
  window.__desktopBridgeStatus = window.__desktopBridgeStatus || "booting";
  window.__desktopDialListenerReady = window.__desktopDialListenerReady || false;
  window.__webview2BridgeReady = false;

  function emitBridgeStatus(status) {
    window.__desktopBridgeStatus = status;
    window.dispatchEvent(new CustomEvent("desktop-bridge-status", {
      detail: { status: status }
    }));
  }

  function emitBridgeLog(kind, message, payload) {
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      kind: kind,
      message: message,
      payload: payload,
    };

    window.__desktopBridgeLogs.push(entry);
    if (window.__desktopBridgeLogs.length > 25) {
      window.__desktopBridgeLogs.shift();
    }

    window.dispatchEvent(new CustomEvent("desktop-bridge-log", {
      detail: entry
    }));
  }

  function getMessageField(message, field) {
    const pascalField = field.charAt(0).toUpperCase() + field.slice(1);
    return message?.[field] ?? message?.[pascalField];
  }

  function normalizeDialDetail(message) {
    return {
      number: getMessageField(message, "number"),
      source: getMessageField(message, "source") ?? "tel",
      autoDial: !!getMessageField(message, "autoDial"),
    };
  }

  function dispatchDial(detail) {
    if (!window.__desktopDialListenerReady) {
      window.__desktopDialQueue.push(detail);
      emitBridgeLog("queue", "Dial request queued until dialer listener is ready.", detail);
    }

    window.dispatchEvent(new CustomEvent("desktop-dial", {
      detail: detail
    }));
    emitBridgeLog("dispatch", "Desktop dial event dispatched to the app.", detail);
  }

  function handleWebviewMessage(event) {
    try {
      const msg = event.data;
      const messageType = getMessageField(msg, "type");
      const number = getMessageField(msg, "number");
      console.log("WebView host message:", msg);
      emitBridgeLog("host", "Message received from desktop host.", msg);

      if (messageType === "dial" && number) {
        dispatchDial(normalizeDialDetail(msg));
      }
    } catch (error) {
      console.error("WebView2 bridge message handler error", error);
      emitBridgeStatus("error");
      emitBridgeLog("error", "WebView2 bridge message handler error.", {
        message: error?.message ?? String(error),
      });
    }
  }

  function attachBridge() {
    const webview = window.chrome?.webview;
    if (!webview) {
      emitBridgeStatus("waiting");
      return false;
    }

    if (!window.__webview2BridgeReady) {
      webview.addEventListener("message", handleWebviewMessage);
      emitBridgeLog("bridge", "WebView2 bridge listener attached.", null);

      try {
        webview.postMessage({ type: "ready" });
        webview.postMessage({ type: "dialerReady" });
        emitBridgeLog("bridge", "Ready signals posted to desktop host.", {
          messages: ["ready", "dialerReady"],
        });
      } catch (error) {
        console.error("WebView2 bridge postMessage error", error);
        emitBridgeStatus("error");
        emitBridgeLog("error", "Failed to post readiness to desktop host.", {
          message: error?.message ?? String(error),
        });
      }

      window.__webview2BridgeReady = true;
      emitBridgeStatus("connected");
    }

    return true;
  }

  if (!attachBridge()) {
    emitBridgeLog("bridge", "Waiting for WebView2 host to become available.", null);
    const intervalId = setInterval(() => {
      if (attachBridge()) {
        clearInterval(intervalId);
      }
    }, 100);

    window.addEventListener("unload", () => clearInterval(intervalId));
  }
})();
`;

function appendDesktopBridgeLog(kind, message, payload) {
  if (typeof window === "undefined") {
    return;
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    kind,
    message,
    payload,
  };

  window.__desktopBridgeLogs = window.__desktopBridgeLogs || [];
  window.__desktopBridgeLogs.push(entry);
  if (window.__desktopBridgeLogs.length > 25) {
    window.__desktopBridgeLogs.shift();
  }

  window.dispatchEvent(
    new CustomEvent("desktop-bridge-log", {
      detail: entry,
    })
  );
}

export function postDesktopHostMessage(message) {
  if (typeof window === "undefined") {
    return false;
  }

  const webview = window.chrome?.webview;
  if (!webview?.postMessage) {
    return false;
  }

  try {
    webview.postMessage(message);
    appendDesktopBridgeLog("bridge", "Message posted to desktop host.", message);
    return true;
  } catch (error) {
    appendDesktopBridgeLog("error", "Failed to post message to desktop host.", {
      message: error?.message ?? String(error),
      payload: message,
    });
    return false;
  }
}

export function requestDesktopWindowState(state, view = "dialer") {
  return postDesktopHostMessage({
    type: "shellWindowState",
    state,
    view,
  });
}
