"use client";

import React, { useEffect, useState } from "react";

const MAX_VISIBLE_LOGS = 6;

const formatTimestamp = (timestamp) => {
  if (!timestamp) {
    return "--:--:--";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const stringifyPayload = (payload) => {
  if (!payload) {
    return "";
  }

  try {
    return JSON.stringify(payload);
  } catch (error) {
    return "[unserializable payload]";
  }
};

export default function DesktopBridgeDebug() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const debugEnabled =
      !!window.chrome?.webview ||
      searchParams.get("desktopDebug") === "1" ||
      window.localStorage.getItem("desktopBridgeDebug") === "1";

    if (!debugEnabled) {
      return;
    }

    setIsVisible(true);
    setStatus(window.__desktopBridgeStatus || "idle");
    setLogs(window.__desktopBridgeLogs || []);

    const handleLog = (event) => {
      const entry = event.detail;
      if (!entry) {
        return;
      }

      setLogs((current) => {
        const next = [...current, entry];
        return next.slice(-MAX_VISIBLE_LOGS);
      });
    };

    const handleStatus = (event) => {
      setStatus(event.detail?.status || "idle");
    };

    window.addEventListener("desktop-bridge-log", handleLog);
    window.addEventListener("desktop-bridge-status", handleStatus);

    return () => {
      window.removeEventListener("desktop-bridge-log", handleLog);
      window.removeEventListener("desktop-bridge-status", handleStatus);
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  const latestLog = logs[logs.length - 1];
  const statusTone =
    status === "error"
      ? "border-red-300 bg-red-50 text-red-700"
      : status === "connected"
        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
        : "border-slate-300 bg-white/95 text-slate-700";

  return (
    <div className="fixed right-4 top-4 z-50 flex max-w-sm flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className={`rounded-full border px-3 py-2 text-xs font-medium shadow-sm backdrop-blur ${statusTone}`}
      >
        Desktop bridge: {status}
      </button>

      {isExpanded && (
        <div className="w-80 rounded-2xl border border-slate-200 bg-white/95 p-3 text-left shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Recent Events
            </p>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="text-xs font-medium text-slate-500"
            >
              Close
            </button>
          </div>

          <div className="space-y-2">
            {logs.length === 0 && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Waiting for desktop bridge activity.
              </p>
            )}

            {logs
              .slice()
              .reverse()
              .map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {entry.kind}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-700">{entry.message}</p>
                  {entry.payload && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 px-2 py-2 text-[11px] text-slate-100">
                      {stringifyPayload(entry.payload)}
                    </pre>
                  )}
                </div>
              ))}
          </div>

          {latestLog && (
            <p className="mt-3 text-[11px] text-slate-500">
              Latest: {latestLog.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
