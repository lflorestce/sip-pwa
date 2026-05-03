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

function buildDesktopWindowStateMessages(state, view = "dialer") {
  const normalizedState = state === "maximized" ? "maximized" : "normal";
  const isMaximized = normalizedState === "maximized";
  const command = isMaximized ? "maximize" : "normalize";
  const alternateState = isMaximized ? "maximize" : "restore";

  return [
    {
      type: "shellWindowState",
      Type: "shellWindowState",
      state: normalizedState,
      State: normalizedState,
      view,
      View: view,
    },
    {
      type: "windowState",
      Type: "windowState",
      state: normalizedState,
      State: normalizedState,
      view,
      View: view,
    },
    {
      type: "setWindowState",
      Type: "setWindowState",
      state: normalizedState,
      State: normalizedState,
      view,
      View: view,
    },
    {
      type: "resizeWindow",
      Type: "resizeWindow",
      state: normalizedState,
      State: normalizedState,
      command,
      Command: command,
      view,
      View: view,
    },
    {
      type: command,
      Type: command,
      view,
      View: view,
    },
    {
      type: "windowState",
      Type: "windowState",
      state: alternateState,
      State: alternateState,
      view,
      View: view,
    },
  ];
}

function postDesktopHostMessages(messages) {
  let sent = false;

  for (const message of messages) {
    sent = postDesktopHostMessage(message) || sent;

    if (typeof window !== "undefined") {
      try {
        sent = postDesktopHostMessage(JSON.stringify(message)) || sent;
      } catch {
        // Ignore JSON fallback failures.
      }
    }
  }

  return sent;
}

function isLocalDesktopHost() {
  if (typeof window === "undefined") {
    return false;
  }

  const hostname = window.location.hostname;
  return (
    !!window.chrome?.webview &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1")
  );
}

function requestLocalDesktopWindowState(state, view = "dialer") {
  if (!isLocalDesktopHost()) {
    return false;
  }

  const normalizedState = state === "maximized" ? "maximized" : "normal";

  window.setTimeout(() => {
    fetch("/api/desktop-window-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: normalizedState,
        view,
        width: 540,
        height: 820,
      }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        appendDesktopBridgeLog(
          payload?.ok ? "bridge" : "warning",
          payload?.ok
            ? "Local desktop window fallback applied."
            : "Local desktop window fallback did not apply.",
          payload
        );
      })
      .catch((error) => {
        appendDesktopBridgeLog("error", "Local desktop window fallback failed.", {
          message: error?.message ?? String(error),
        });
      });
  }, 260);

  return true;
}

export function requestDesktopWindowState(state, view = "dialer") {
  const messages = buildDesktopWindowStateMessages(state, view);
  const sent = postDesktopHostMessages(messages);
  requestLocalDesktopWindowState(state, view);

  if (typeof window !== "undefined") {
    [80, 180, 360, 700, 1200, 2000].forEach((delay) => {
      window.setTimeout(() => {
        postDesktopHostMessages(messages);
      }, delay);
    });
  }

  return sent;
}

export function rememberDesktopWindowState(state, view = "dialer") {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      "voiceiqDesktopWindowState",
      JSON.stringify({
        state,
        view,
        requestedAt: Date.now(),
      })
    );
  } catch {
    // Non-critical; direct host messaging still runs.
  }
}

export function applyRememberedDesktopWindowState(maxAgeMs = 10000) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const raw = window.sessionStorage.getItem("voiceiqDesktopWindowState");
    if (!raw) {
      return false;
    }

    const request = JSON.parse(raw);
    if (!request?.state || Date.now() - Number(request.requestedAt || 0) > maxAgeMs) {
      window.sessionStorage.removeItem("voiceiqDesktopWindowState");
      return false;
    }

    requestDesktopWindowState(request.state, request.view || "dialer");
    return true;
  } catch {
    return false;
  }
}

export function navigateWithDesktopWindowState({
  href,
  router,
  state,
  view = "dialer",
  delayMs = 180,
}) {
  rememberDesktopWindowState(state, view);
  requestDesktopWindowState(state, view);

  if (typeof window === "undefined") {
    router?.push?.(href);
    return;
  }

  window.setTimeout(() => {
    if (router?.push) {
      router.push(href);
      return;
    }

    window.location.href = href;
  }, delayMs);
}
