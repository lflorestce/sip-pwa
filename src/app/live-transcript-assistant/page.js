"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  voiceCommand: null,
  updatedAt: null,
};

const SUGGESTED_PROMPTS = [
  "Please help me find an answer to the last customer's question.",
  "Summarize the customer's main concern in one sentence.",
  "What should I ask next to move this call forward?",
  "Find my nearest availability in my Outlook calendar.",
];

const QUBIT_ASSET_BASE = "/img/qubit-svg-expressions";

const QUBIT_EXPRESSIONS = {
  alerting: {
    src: `${QUBIT_ASSET_BASE}/qubit-alerting.svg`,
    alt: "Qubit is alerting",
    label: "Heads up",
    tone: "alerting",
  },
  celebrating: {
    src: `${QUBIT_ASSET_BASE}/qubit-celebrating.svg`,
    alt: "Qubit is celebrating",
    label: "Done",
    tone: "celebrating",
  },
  listening: {
    src: `${QUBIT_ASSET_BASE}/qubit-listening.svg`,
    alt: "Qubit is listening",
    label: "Listening",
    tone: "listening",
  },
  suggesting: {
    src: `${QUBIT_ASSET_BASE}/qubit-suggesting.svg`,
    alt: "Qubit is suggesting",
    label: "Suggestion ready",
    tone: "suggesting",
  },
  supporting: {
    src: `${QUBIT_ASSET_BASE}/qubit-supporting.svg`,
    alt: "Qubit is supporting",
    label: "Standing by",
    tone: "supporting",
  },
  thinking: {
    src: `${QUBIT_ASSET_BASE}/qubit-thinking.svg`,
    alt: "Qubit is thinking",
    label: "Thinking",
    tone: "thinking",
  },
};

function getQubitExpression({ snapshot, messages, isAsking }) {
  if (!snapshot.voiceIqAssistantEnabled || snapshot.status === "error") {
    return QUBIT_EXPRESSIONS.alerting;
  }

  if (isAsking) {
    return QUBIT_EXPRESSIONS.thinking;
  }

  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.tone === "error") {
    return QUBIT_EXPRESSIONS.alerting;
  }

  if (
    latestMessage?.availabilitySlot ||
    (Array.isArray(latestMessage?.attachments) && latestMessage.attachments.length > 0)
  ) {
    return QUBIT_EXPRESSIONS.celebrating;
  }

  if (latestMessage?.role === "assistant") {
    return QUBIT_EXPRESSIONS.suggesting;
  }

  if (snapshot.callActive) {
    return QUBIT_EXPRESSIONS.listening;
  }

  return QUBIT_EXPRESSIONS.supporting;
}

function renderInlineText(value) {
  const text = String(value || "");
  const segments = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g).filter(Boolean);

  return segments.map((segment, index) => {
    const strongMatch =
      segment.match(/^\*\*([^*]+)\*\*$/) || segment.match(/^\*([^*\n]+)\*$/);

    if (strongMatch) {
      return <strong key={`${segment}-${index}`}>{strongMatch[1]}</strong>;
    }

    return segment.replace(/#{1,6}\s*/g, "").replace(/\*\*/g, "").replace(/\*/g, "");
  });
}

function renderAssistantContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const text = paragraph.join(" ").trim();
    if (text) {
      blocks.push({
        type: "paragraph",
        text,
      });
    }
    paragraph = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      return;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: "heading",
        text: headingMatch[1].replace(/:$/, ""),
      });
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({
        type: "bullet",
        text: bulletMatch[1],
      });
      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();

  return blocks.map((block, index) => {
    if (block.type === "heading") {
      return (
        <h3 key={`${block.type}-${index}`} className="assistant-message-heading">
          {renderInlineText(block.text)}
        </h3>
      );
    }

    if (block.type === "bullet") {
      return (
        <div key={`${block.type}-${index}`} className="assistant-message-row">
          <span className="assistant-message-dot" aria-hidden="true" />
          <span>{renderInlineText(block.text)}</span>
        </div>
      );
    }

    return (
      <p key={`${block.type}-${index}`} className="assistant-message-paragraph">
        {renderInlineText(block.text)}
      </p>
    );
  });
}

export default function LiveTranscriptAssistantPage() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const chatEndRef = useRef(null);
  const handledVoiceCommandIdRef = useRef(null);
  const suggestionsCloseTimerRef = useRef(null);

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

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!event.target?.closest?.(".suggestion-trigger-wrap")) {
        setIsSuggestionsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsSuggestionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(suggestionsCloseTimerRef.current);
    };
  }, []);

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

  const qubitExpression = useMemo(
    () => getQubitExpression({ snapshot, messages, isAsking }),
    [isAsking, messages, snapshot]
  );

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

  const askAssistant = useCallback(async (question, options = {}) => {
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
        source: options.source || "manual",
      },
    ]);

    try {
      const historyForRequest = [
        ...messages.map((message) => ({
          role: message.role,
          content: message.availabilitySlot
            ? `${message.content}\n\nStructured availability slot: ${JSON.stringify(message.availabilitySlot)}`
            : message.content,
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
          availabilitySlot: payload.availabilitySlot || null,
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
  }, [isAsking, messages, snapshot.transcript, snapshot.voiceIqAssistantEnabled]);

  useEffect(() => {
    const command = snapshot.voiceCommand;
    if (
      !command?.id ||
      !command?.question ||
      !snapshot.voiceIqAssistantEnabled ||
      isAsking ||
      handledVoiceCommandIdRef.current === command.id
    ) {
      return;
    }

    handledVoiceCommandIdRef.current = command.id;
    askAssistant(command.question, { source: "voice" });
  }, [askAssistant, isAsking, snapshot.voiceCommand, snapshot.voiceIqAssistantEnabled]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    await askAssistant(draft);
  };

  const openSuggestions = () => {
    window.clearTimeout(suggestionsCloseTimerRef.current);
    setIsSuggestionsOpen(true);
  };

  const scheduleCloseSuggestions = () => {
    window.clearTimeout(suggestionsCloseTimerRef.current);
    suggestionsCloseTimerRef.current = window.setTimeout(() => {
      setIsSuggestionsOpen(false);
    }, 450);
  };

  const handleSuggestionClick = (prompt) => {
    setIsSuggestionsOpen(false);
    askAssistant(prompt);
  };

  return (
    <main className="assistant-shell">
      <header className="assistant-header">
        <div className="qubit-panel">
          <div className="qubit-avatar-wrap" aria-hidden="true">
            <img
              key={qubitExpression.src}
              className={`qubit-avatar ${qubitExpression.tone}`}
              src={qubitExpression.src}
              alt=""
              width="92"
              height="92"
            />
          </div>
          <div className="qubit-copy">
            <div className="status-bar">
              <span className={`status-dot ${snapshot.callActive ? "active" : ""}`} />
              <span>{statusLabel}</span>
            </div>
            <div className="header-copy">
              <h1>Qubit</h1>
              <p>VoiceIQ live assistant for the current call.</p>
            </div>
            <span className="qubit-state">{qubitExpression.label}</span>
          </div>
        </div>
      </header>

      <div className="suggestion-toolbar">
        <div
          className={`suggestion-trigger-wrap ${isSuggestionsOpen ? "open" : ""}`}
          onMouseEnter={openSuggestions}
          onMouseLeave={scheduleCloseSuggestions}
          onFocus={openSuggestions}
        >
          <button
            type="button"
            className="suggestion-trigger"
            title="Suggested actions/questions"
            aria-label="Suggested actions/questions"
            aria-expanded={isSuggestionsOpen}
            aria-haspopup="menu"
            onClick={() => setIsSuggestionsOpen((current) => !current)}
            disabled={isAsking || !snapshot.voiceIqAssistantEnabled}
          >
            Suggestions
          </button>
          <div className="suggestion-menu" role="menu" aria-label="Suggested actions/questions">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="suggestion-menu-item"
                onClick={() => handleSuggestionClick(prompt)}
                disabled={isAsking || !snapshot.voiceIqAssistantEnabled}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
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
                {message.role === "assistant"
                  ? "Qubit"
                  : message.source === "voice"
                    ? "Qubit command"
                    : "You"}
              </span>
              {message.role === "assistant" ? (
                <div className="assistant-message-content">
                  {renderAssistantContent(message.content)}
                </div>
              ) : (
                <p>{message.content}</p>
              )}
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
            Qubit is reading the current transcript...
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
          box-sizing: border-box;
          height: 100vh;
          min-height: 0;
          padding: 16px;
          background:
            linear-gradient(180deg, rgba(78, 92, 110, 0.18), rgba(20, 24, 31, 0.36)),
            linear-gradient(135deg, #2f343c 0%, #23282f 100%);
          color: #e7edf4;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: hidden;
        }
        .assistant-header {
          position: sticky;
          top: 0;
          z-index: 5;
          display: block;
          flex: 0 0 auto;
        }
        .qubit-panel {
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr);
          align-items: center;
          gap: 12px;
          min-height: 104px;
          padding: 10px;
          border-radius: 16px;
          background:
            linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.025)),
            rgba(12, 17, 24, 0.48);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        }
        .qubit-avatar-wrap {
          width: 92px;
          height: 92px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: radial-gradient(circle at 50% 38%, rgba(0, 209, 255, 0.2), rgba(10, 15, 23, 0.04) 68%);
          overflow: hidden;
        }
        .qubit-avatar {
          width: 90px;
          height: 90px;
          object-fit: contain;
          filter: drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28));
          animation: qubit-state-glow 1.1s ease-out;
        }
        .qubit-avatar.listening,
        .qubit-avatar.thinking,
        .qubit-avatar.suggesting {
          --qubit-glow: rgba(102, 240, 255, 0.78);
        }
        .qubit-avatar.supporting {
          --qubit-glow: rgba(134, 239, 172, 0.72);
        }
        .qubit-avatar.celebrating {
          --qubit-glow: rgba(250, 204, 21, 0.78);
        }
        .qubit-avatar.alerting {
          --qubit-glow: rgba(248, 113, 113, 0.78);
        }
        .qubit-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 7px;
        }
        .status-bar {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          align-self: flex-start;
          padding: 5px 9px;
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
          font-size: 26px;
          line-height: 1.05;
          letter-spacing: 0;
        }
        .header-copy p {
          margin: 5px 0 0;
          color: #97a8bb;
          font-size: 13px;
        }
        .qubit-state {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 4px 9px;
          border-radius: 999px;
          background: rgba(102, 240, 255, 0.1);
          border: 1px solid rgba(102, 240, 255, 0.16);
          color: #bff8ff;
          font-size: 12px;
          font-weight: 700;
        }
        .suggestion-toolbar {
          display: flex;
          justify-content: flex-end;
          flex: 0 0 auto;
        }
        .suggestion-trigger-wrap {
          position: relative;
        }
        .suggestion-trigger-wrap::after {
          content: "";
          position: absolute;
          right: 0;
          top: 100%;
          z-index: 7;
          width: min(340px, calc(100vw - 32px));
          height: 16px;
        }
        .suggestion-trigger {
          min-height: 30px;
          padding: 6px 11px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(34, 42, 52, 0.88);
          color: #dce6f1;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
        }
        .suggestion-trigger:hover:not(:disabled),
        .suggestion-trigger:focus-visible {
          background: rgba(47, 58, 71, 0.96);
          transform: translateY(-1px);
        }
        .suggestion-trigger:disabled {
          opacity: 0.6;
          cursor: progress;
        }
        .suggestion-trigger-wrap::before {
          content: "Suggested actions/questions";
          position: absolute;
          right: 0;
          bottom: calc(100% + 8px);
          z-index: 9;
          width: max-content;
          max-width: 230px;
          padding: 6px 9px;
          border-radius: 999px;
          background: rgba(12, 17, 24, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #dce6f1;
          font-size: 11px;
          font-weight: 700;
          opacity: 0;
          pointer-events: none;
          transform: translateY(4px);
          transition: opacity 0.16s ease, transform 0.16s ease;
        }
        .suggestion-trigger-wrap:hover::before,
        .suggestion-trigger-wrap:focus-within::before,
        .suggestion-trigger-wrap.open::before {
          opacity: 1;
          transform: translateY(0);
        }
        .suggestion-menu {
          position: absolute;
          right: 0;
          top: calc(100% + 8px);
          z-index: 8;
          display: grid;
          gap: 6px;
          width: min(340px, calc(100vw - 32px));
          padding: 8px;
          border-radius: 14px;
          background: rgba(12, 17, 24, 0.98);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
          opacity: 0;
          pointer-events: none;
          transform: translateY(-4px);
          transition: opacity 0.16s ease, transform 0.16s ease;
        }
        .suggestion-trigger-wrap:hover .suggestion-menu,
        .suggestion-trigger-wrap:focus-within .suggestion-menu,
        .suggestion-trigger-wrap.open .suggestion-menu {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }
        .suggestion-menu-item {
          padding: 9px 10px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 10px;
          background: rgba(34, 42, 52, 0.92);
          color: #dce6f1;
          font-size: 12px;
          line-height: 1.35;
          text-align: left;
          cursor: pointer;
        }
        .suggestion-menu-item:hover:not(:disabled),
        .suggestion-menu-item:focus-visible {
          outline: none;
          background: rgba(47, 58, 71, 0.98);
        }
        .suggestion-menu-item:disabled {
          opacity: 0.55;
          cursor: progress;
        }
        .assistant-chat {
          flex: 1;
          min-height: 0;
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
        .assistant-message-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: #f4f8fc;
          font-size: 14px;
          line-height: 1.5;
        }
        .assistant-message-content strong {
          color: #ffffff;
          font-weight: 750;
        }
        .assistant-message-heading {
          margin: 8px 0 2px;
          color: #c7f9d4;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .assistant-message-heading:first-child {
          margin-top: 0;
        }
        .assistant-message-paragraph {
          margin: 0;
          white-space: pre-wrap;
        }
        .assistant-message-row {
          display: grid;
          grid-template-columns: 8px minmax(0, 1fr);
          gap: 9px;
          align-items: start;
        }
        .assistant-message-dot {
          width: 5px;
          height: 5px;
          margin-top: 8px;
          border-radius: 999px;
          background: rgba(134, 239, 172, 0.84);
          box-shadow: 0 0 0 3px rgba(134, 239, 172, 0.08);
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
          flex: 0 0 auto;
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
        @media (max-width: 420px) {
          .qubit-panel {
            grid-template-columns: 78px minmax(0, 1fr);
            min-height: 92px;
            gap: 9px;
          }
          .qubit-avatar-wrap {
            width: 78px;
            height: 78px;
          }
          .qubit-avatar {
            width: 76px;
            height: 76px;
          }
          .header-copy h1 {
            font-size: 23px;
          }
          .header-copy p {
            font-size: 12px;
          }
          .suggestion-menu {
            right: auto;
            left: 50%;
            transform: translate(-50%, -4px);
            width: calc(100vw - 32px);
          }
          .suggestion-trigger-wrap:hover .suggestion-menu,
          .suggestion-trigger-wrap:focus-within .suggestion-menu,
          .suggestion-trigger-wrap.open .suggestion-menu {
            transform: translate(-50%, 0);
          }
        }
        @keyframes qubit-state-glow {
          0% {
            filter:
              drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28))
              drop-shadow(0 0 0 rgba(102, 240, 255, 0));
            transform: scale(0.98);
          }
          35% {
            filter:
              drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28))
              drop-shadow(0 0 22px var(--qubit-glow));
            transform: scale(1.035);
          }
          100% {
            filter:
              drop-shadow(0 10px 16px rgba(0, 0, 0, 0.28))
              drop-shadow(0 0 0 rgba(102, 240, 255, 0));
            transform: scale(1);
          }
        }
      `}</style>
    </main>
  );
}
