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
  voiceIqAssistantEnabled: false,
  updatedAt: null,
};

const SUGGESTED_PROMPTS = [
  "Please help me find an answer to the last customer's question.",
  "Summarize the customer's main concern in one sentence.",
  "What should I ask next to move this call forward?",
  "Find my nearest availability in my Outlook calendar.",
];

export default function LiveTranscriptAssistantPage() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    document.title = "TCE VoiceIQ Assistant";

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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

  const downloadAttachment = (attachment) => {
    if (!attachment?.base64 || !attachment?.filename || !attachment?.mimeType) {
      return;
    }

    const byteCharacters = window.atob(attachment.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i += 1) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    const blob = new Blob([new Uint8Array(byteNumbers)], {
      type: attachment.mimeType,
    });

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const askAssistant = async (question) => {
    const normalizedQuestion = String(question || "").trim();
    if (!normalizedQuestion || isAsking || !snapshot.voiceIqAssistantEnabled) {
      return;
    }

    setDraft("");
    setIsAsking(true);

    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: normalizedQuestion,
      },
    ]);

    try {
      const historyForRequest = [
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: "user",
          content: normalizedQuestion,
        },
      ];

      const response = await fetch("/api/live-transcript-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: normalizedQuestion,
          transcript: snapshot.transcript,
          history: historyForRequest,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to contact VoiceIQ Assistant.");
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.answer || "No answer returned.",
          attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "VoiceIQ Assistant is unavailable right now.",
          tone: "error",
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await askAssistant(draft);
  };

  return (
    <main className="assistant-shell">
      <header className="assistant-header">
        <div className="status-bar">
          <span className={`status-dot ${snapshot.callActive ? "active" : ""}`} />
          <span>{statusLabel}</span>
        </div>
        <div className="header-copy">
          <h1>VoiceIQ Assistant</h1>
          <p>Answers grounded in the current live transcript.</p>
        </div>
      </header>

      <div className="suggestion-row">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="suggestion-chip"
            onClick={() => askAssistant(prompt)}
            disabled={isAsking || !snapshot.voiceIqAssistantEnabled}
          >
            {prompt}
          </button>
        ))}
      </div>

      <section className="assistant-chat" aria-live="polite">
        {!snapshot.voiceIqAssistantEnabled ? (
          <div className="assistant-empty">
            Enable the VoiceIQ Assistant PFK on the dialer to use this feature.
          </div>
        ) : messages.length > 0 ? (
          messages.map((message) => (
            <article
              key={message.id}
              className={`chat-bubble ${message.role} ${message.tone === "error" ? "error" : ""}`}
            >
              <span className="chat-role">
                {message.role === "assistant" ? "VoiceIQ" : "You"}
              </span>
              <p>{message.content}</p>
              {Array.isArray(message.attachments) && message.attachments.length > 0 && (
                <div className="attachment-row">
                  {message.attachments.map((attachment) => (
                    <button
                      key={`${message.id}-${attachment.filename}`}
                      type="button"
                      className="attachment-chip"
                      onClick={() => downloadAttachment(attachment)}
                    >
                      {attachment.label || attachment.filename}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))
        ) : (
          <div className="assistant-empty">
            Ask for help during the call and VoiceIQ will answer from the live transcript.
          </div>
        )}
        {isAsking && (
          <div className="assistant-thinking">
            VoiceIQ is reading the current transcript...
          </div>
        )}
        <div ref={chatEndRef} />
      </section>

      <form className="assistant-composer" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about the current call..."
          rows={3}
          disabled={!snapshot.voiceIqAssistantEnabled}
        />
        <button type="submit" disabled={isAsking || !draft.trim() || !snapshot.voiceIqAssistantEnabled}>
          Ask
        </button>
      </form>

      <style jsx>{`
        .assistant-shell {
          min-height: 100vh;
          padding: 16px;
          background:
            linear-gradient(180deg, rgba(78, 92, 110, 0.18), rgba(20, 24, 31, 0.36)),
            linear-gradient(135deg, #2f343c 0%, #23282f 100%);
          color: #e7edf4;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow: hidden;
        }
        .assistant-header {
          display: flex;
          flex-direction: column;
          gap: 10px;
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
        .header-copy h1 {
          margin: 0;
          font-size: 24px;
        }
        .header-copy p {
          margin: 6px 0 0;
          color: #97a8bb;
          font-size: 13px;
        }
        .suggestion-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .suggestion-chip {
          padding: 9px 12px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(34, 42, 52, 0.88);
          color: #dce6f1;
          font-size: 12px;
          line-height: 1.35;
          text-align: left;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
        }
        .suggestion-chip:hover:not(:disabled) {
          background: rgba(47, 58, 71, 0.96);
          transform: translateY(-1px);
        }
        .suggestion-chip:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .assistant-chat {
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
        .chat-bubble {
          margin-bottom: 10px;
          padding: 12px 14px;
          border-radius: 16px;
          background: rgba(42, 50, 61, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .chat-bubble.user {
          background: rgba(28, 44, 64, 0.82);
          border-color: rgba(96, 165, 250, 0.16);
        }
        .chat-bubble.assistant {
          background: rgba(46, 55, 42, 0.72);
          border-color: rgba(74, 222, 128, 0.14);
        }
        .chat-bubble.error {
          background: rgba(76, 29, 29, 0.7);
          border-color: rgba(248, 113, 113, 0.18);
        }
        .chat-role {
          display: block;
          margin-bottom: 6px;
          color: #9fb6cd;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .chat-bubble p {
          margin: 0;
          color: #f4f8fc;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .attachment-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .attachment-chip {
          padding: 8px 12px;
          border: 1px solid rgba(96, 165, 250, 0.22);
          border-radius: 999px;
          background: rgba(22, 36, 52, 0.92);
          color: #dbeafe;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, background 0.18s ease;
        }
        .attachment-chip:hover {
          transform: translateY(-1px);
          background: rgba(28, 48, 72, 0.98);
        }
        .assistant-empty {
          min-height: 100%;
          display: grid;
          place-items: center;
          text-align: center;
          color: #a5b1be;
          font-size: 14px;
          padding: 20px;
        }
        .assistant-thinking {
          padding: 12px 14px;
          border-radius: 16px;
          background: rgba(24, 32, 43, 0.74);
          color: #b9c7d6;
          font-size: 13px;
        }
        .assistant-composer {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: end;
        }
        .assistant-composer textarea {
          width: 100%;
          resize: none;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(14, 18, 24, 0.92);
          color: #f4f8fc;
          padding: 12px 14px;
          font: inherit;
          line-height: 1.45;
          min-height: 74px;
        }
        .assistant-composer textarea:focus {
          outline: none;
          border-color: rgba(96, 165, 250, 0.38);
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.08);
        }
        .assistant-composer button {
          height: 46px;
          padding: 0 18px;
          border: none;
          border-radius: 14px;
          background: linear-gradient(135deg, #4f46e5, #2563eb);
          color: white;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }
        .assistant-composer button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
