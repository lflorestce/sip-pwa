"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import {
  readLiveTranscriptSnapshot,
  subscribeToLiveTranscript,
} from "@/lib/liveTranscriptBridge";

const ASSISTANT_WINDOW_WIDTH = 460;
const ASSISTANT_WINDOW_HEIGHT = 720;
const WINDOW_GAP = 12;

const EMPTY_SNAPSHOT = {
  callActive: false,
  status: "idle",
  rows: [],
  transcript: [],
  liveTranscriptEnabled: false,
  voiceIqAssistantEnabled: false,
  voiceCommand: null,
  updatedAt: null,
};

export default function LiveTranscriptPage() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [shouldAutoScrollTranscript, setShouldAutoScrollTranscript] = useState(true);
  const transcriptEndRef = useRef(null);
  const transcriptPanelRef = useRef(null);
  const assistantWindowRef = useRef(null);
  const openAssistantWindowRef = useRef(null);
  const openedVoiceCommandIdRef = useRef(null);
  const isProgrammaticScrollRef = useRef(false);
  const userPausedAutoScrollRef = useRef(false);

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
    if (!shouldAutoScrollTranscript || userPausedAutoScrollRef.current) {
      return;
    }

    const panel = transcriptPanelRef.current;
    if (!panel) {
      return;
    }

    requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = true;
      transcriptEndRef.current?.scrollIntoView({ block: "end" });
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 120);
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

    if (isProgrammaticScrollRef.current) {
      return;
    }

    const distanceFromBottom =
      panel.scrollHeight - panel.scrollTop - panel.clientHeight;
    const isNearBottom = distanceFromBottom < 56;
    userPausedAutoScrollRef.current = !isNearBottom;
    setShouldAutoScrollTranscript(isNearBottom);
  };

  const pauseAutoScroll = () => {
    userPausedAutoScrollRef.current = true;
    setShouldAutoScrollTranscript(false);
  };

  const handleTranscriptWheel = (event) => {
    if (event.deltaY < 0) {
      pauseAutoScroll();
    }
  };

  const handleTranscriptPointerDown = () => {
    const panel = transcriptPanelRef.current;
    if (!panel || panel.scrollHeight <= panel.clientHeight + 4) {
      return;
    }

    pauseAutoScroll();
  };

  const scrollTranscriptToBottom = () => {
    userPausedAutoScrollRef.current = false;
    setShouldAutoScrollTranscript(true);
    isProgrammaticScrollRef.current = true;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 320);
  };

  const getAssistantWindowLayout = () => {
    const screenLeft = Number(window.screen?.availLeft ?? window.screenX ?? 0);
    const screenTop = Number(window.screen?.availTop ?? window.screenY ?? 0);
    const screenWidth = Number(window.screen?.availWidth ?? window.screen?.width ?? 1200);
    const screenHeight = Number(window.screen?.availHeight ?? window.screen?.height ?? 800);
    const currentLeft = Number(window.screenX ?? screenLeft);
    const currentTop = Number(window.screenY ?? screenTop);
    const currentWidth = Number(window.outerWidth || ASSISTANT_WINDOW_WIDTH);
    const height = Math.min(ASSISTANT_WINDOW_HEIGHT, Math.max(520, screenHeight - 48));
    const preferredLeft = currentLeft + currentWidth + WINDOW_GAP;
    const maxLeft = screenLeft + screenWidth - ASSISTANT_WINDOW_WIDTH;
    const left =
      preferredLeft <= maxLeft
        ? preferredLeft
        : Math.max(screenLeft, currentLeft - ASSISTANT_WINDOW_WIDTH - WINDOW_GAP);
    const top = Math.max(screenTop, Math.min(currentTop, screenTop + screenHeight - height));

    return {
      left,
      top,
      height,
    };
  };

  const buildAssistantWindowFeatures = ({ left, top, height }) =>
    [
      "popup=yes",
      "toolbar=no",
      "menubar=no",
      "location=no",
      "status=no",
      "scrollbars=yes",
      "resizable=yes",
      `width=${ASSISTANT_WINDOW_WIDTH}`,
      `height=${height}`,
      `left=${Math.max(0, Math.round(left))}`,
      `top=${Math.max(0, Math.round(top))}`,
    ].join(",");

  const openAssistantWindow = () => {
    if (typeof window === "undefined") {
      return;
    }

    if (assistantWindowRef.current && !assistantWindowRef.current.closed) {
      const layout = getAssistantWindowLayout();
      assistantWindowRef.current.moveTo?.(layout.left, layout.top);
      assistantWindowRef.current.resizeTo?.(ASSISTANT_WINDOW_WIDTH, layout.height);
      assistantWindowRef.current.focus();
      return;
    }

    const layout = getAssistantWindowLayout();

    assistantWindowRef.current = window.open(
      "/live-transcript-assistant",
      "voiceiq-live-transcript-assistant",
      buildAssistantWindowFeatures(layout)
    );
  };

  openAssistantWindowRef.current = openAssistantWindow;

  useEffect(() => {
    const commandId = snapshot.voiceCommand?.id;
    if (
      !commandId ||
      !snapshot.voiceIqAssistantEnabled ||
      openedVoiceCommandIdRef.current === commandId
    ) {
      return;
    }

    openedVoiceCommandIdRef.current = commandId;
    openAssistantWindowRef.current?.();
  }, [snapshot.voiceCommand, snapshot.voiceIqAssistantEnabled]);

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
          onWheelCapture={handleTranscriptWheel}
          onPointerDown={handleTranscriptPointerDown}
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
            <ArrowDown size={18} strokeWidth={2.4} aria-hidden="true" />
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
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          background: rgba(16, 23, 31, 0.58);
          backdrop-filter: blur(8px);
          color: #dce6f1;
          font-size: 0;
          line-height: 1;
          cursor: pointer;
          opacity: 0.82;
          box-shadow: 0 8px 18px rgba(7, 10, 14, 0.18);
          transition: transform 0.18s ease, background 0.18s ease, opacity 0.18s ease;
        }
        .jump-to-latest:hover {
          transform: translateY(-1px);
          background: rgba(26, 36, 49, 0.82);
          opacity: 1;
        }
        .jump-to-latest :global(svg) {
          pointer-events: none;
        }
      `}</style>
    </main>
  );
}
