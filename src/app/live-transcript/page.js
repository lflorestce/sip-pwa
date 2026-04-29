"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  readLiveTranscriptSnapshot,
  subscribeToLiveTranscript,
} from "@/lib/liveTranscriptBridge";

const EMPTY_SNAPSHOT = {
  callActive: false,
  status: "idle",
  rows: [],
  transcript: [],
  liveTranscriptEnabled: false,
  voiceIqAssistantEnabled: false,
  updatedAt: null,
};

export default function LiveTranscriptPage() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [shouldAutoScrollTranscript, setShouldAutoScrollTranscript] = useState(true);
  const transcriptEndRef = useRef(null);
  const transcriptPanelRef = useRef(null);
  const assistantWindowRef = useRef(null);

  useEffect(() => {
    document.title = "TCE VoiceIQ Live Transcript";

    const unsubscribe = subscribeToLiveTranscript((nextSnapshot) => {
      setSnapshot(nextSnapshot || EMPTY_SNAPSHOT);
    });

    const latestSnapshot = readLiveTranscriptSnapshot();
    if (latestSnapshot) {
      setSnapshot(latestSnapshot);
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    const closeAssistantWindow = () => {
      if (assistantWindowRef.current && !assistantWindowRef.current.closed) {
        assistantWindowRef.current.close();
      }
      assistantWindowRef.current = null;
    };

    window.addEventListener("beforeunload", closeAssistantWindow);

    return () => {
      closeAssistantWindow();
      window.removeEventListener("beforeunload", closeAssistantWindow);
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollTranscript) {
      return;
    }

    const panel = transcriptPanelRef.current;
    if (!panel) {
      return;
    }

    requestAnimationFrame(() => {
      panel.scrollTop = panel.scrollHeight;
    });
  }, [shouldAutoScrollTranscript, snapshot.transcript]);

  const statusLabel = useMemo(() => {
    if (snapshot.status === "error") {
      return "Transcript unavailable";
    }

    if (snapshot.callActive) {
      return snapshot.status === "streaming" || snapshot.status === "ready"
        ? "Live"
        : "Connecting";
    }

    return snapshot.updatedAt ? "Call ended" : "Waiting";
  }, [snapshot.callActive, snapshot.status, snapshot.updatedAt]);

  const handleTranscriptScroll = () => {
    const panel = transcriptPanelRef.current;
    if (!panel) {
      return;
    }

    const distanceFromBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    setShouldAutoScrollTranscript(distanceFromBottom < 48);
  };

  const scrollTranscriptToBottom = () => {
    const panel = transcriptPanelRef.current;
    if (!panel) {
      return;
    }

    setShouldAutoScrollTranscript(true);
    panel.scrollTop = panel.scrollHeight;
  };

  const openAssistantWindow = () => {
    if (typeof window === "undefined") {
      return;
    }

    if (assistantWindowRef.current && !assistantWindowRef.current.closed) {
      assistantWindowRef.current.focus();
      return;
    }

    assistantWindowRef.current = window.open(
      "/live-transcript-assistant",
      "voiceiq-live-transcript-assistant",
      [
        "popup=yes",
        "toolbar=no",
        "menubar=no",
        "location=no",
        "status=no",
        "scrollbars=yes",
        "resizable=yes",
        "width=460",
        "height=720",
      ].join(",")
    );
  };

  return (
    <main className="live-transcript-shell">
      <section className="workspace">
        <div className="toolbar">
          <div className="status-bar">
            <span className={`status-dot ${snapshot.callActive ? "active" : ""}`} />
            <span>{statusLabel}</span>
          </div>

          <button
            type="button"
            className="assistant-toggle"
            onClick={openAssistantWindow}
            disabled={!snapshot.voiceIqAssistantEnabled}
            title={
              snapshot.voiceIqAssistantEnabled
                ? "Open VoiceIQ Assistant"
                : "Enable VoiceIQ Assistant from the dialer to use this feature"
            }
          >
            VoiceIQ Assistant
          </button>
        </div>

        <section
          ref={transcriptPanelRef}
          className="transcript-panel"
          aria-live="polite"
          onScroll={handleTranscriptScroll}
        >
          {snapshot.transcript.length > 0 ? (
            snapshot.transcript.map((turn) => (
              <article key={`${turn.turnOrder}-${turn.speakerLabel}`} className="transcript-turn">
                <div className="speaker-pill">{turn.speakerLabel || "UNKNOWN"}</div>
                <p>{turn.transcript}</p>
              </article>
            ))
          ) : (
            <div className="empty-state">
              {snapshot.status === "error"
                ? "AssemblyAI live transcript is currently unavailable."
                : snapshot.callActive
                  ? "Listening for speech..."
                  : "The live transcript will appear here during the next call."}
            </div>
          )}
          <div ref={transcriptEndRef} />
        </section>

        {!shouldAutoScrollTranscript && snapshot.transcript.length > 0 && (
          <button
            type="button"
            className="jump-to-latest"
            onClick={scrollTranscriptToBottom}
            aria-label="Jump to latest transcript lines"
            title="Jump to latest"
          >
            ↓
          </button>
        )}
      </section>

      <style jsx>{`
        .live-transcript-shell {
          min-height: 100vh;
          padding: 16px;
          background:
            linear-gradient(180deg, rgba(78, 92, 110, 0.18), rgba(20, 24, 31, 0.36)),
            linear-gradient(135deg, #2f343c 0%, #23282f 100%);
          color: #e7edf4;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          overflow: hidden;
        }
        .workspace {
          min-height: calc(100vh - 32px);
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
        }
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .status-bar {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          align-self: flex-start;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #b9c7d6;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #6b7280;
          box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.18);
        }
        .status-dot.active {
          background: #22c55e;
          box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.15), 0 0 10px rgba(34, 197, 94, 0.4);
        }
        .assistant-toggle {
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(114, 191, 255, 0.2);
          background: linear-gradient(135deg, rgba(38, 54, 72, 0.92), rgba(23, 31, 44, 0.94));
          color: #e4f1ff;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          box-shadow: 0 10px 24px rgba(10, 16, 24, 0.24);
        }
        .assistant-toggle:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 28px rgba(10, 16, 24, 0.34);
        }
        .assistant-toggle:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          transform: none;
          box-shadow: 0 10px 24px rgba(10, 16, 24, 0.12);
        }
        .transcript-panel {
          flex: 1;
          overflow-y: auto;
          border-radius: 18px;
          padding: 10px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
            rgba(14, 18, 24, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .transcript-turn {
          display: grid;
          grid-template-columns: 56px minmax(0, 1fr);
          gap: 10px;
          align-items: start;
          margin-bottom: 10px;
          padding: 10px 12px;
          border-radius: 14px;
          background: rgba(66, 74, 86, 0.32);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .speaker-pill {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-height: 24px;
          border-radius: 999px;
          background: rgba(96, 165, 250, 0.18);
          color: #d8e8ff;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
        }
        .transcript-turn p {
          margin: 0;
          color: #f4f8fc;
          font-size: 14px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .empty-state {
          min-height: 100%;
          display: grid;
          place-items: center;
          text-align: center;
          color: #a5b1be;
          font-size: 14px;
          padding: 20px;
        }
        .jump-to-latest {
          position: absolute;
          right: 22px;
          bottom: 18px;
          width: 34px;
          height: 34px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 999px;
          background: rgba(16, 23, 31, 0.88);
          color: #dce6f1;
          font-size: 18px;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(7, 10, 14, 0.28);
          transition: transform 0.18s ease, background 0.18s ease;
        }
        .jump-to-latest:hover {
          transform: translateY(-1px);
          background: rgba(26, 36, 49, 0.96);
        }
      `}</style>
    </main>
  );
}
