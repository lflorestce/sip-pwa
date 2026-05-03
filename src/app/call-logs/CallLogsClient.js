"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CassetteTape, Copy, Download, PhoneCall, Send, Trash2, X } from "lucide-react";
import {
  buildAgentBreakdown,
  buildCallLogMetrics,
  buildDailyVolume,
  formatDuration,
} from "@/lib/callLogTransforms";
import {
  applyRememberedDesktopWindowState,
  navigateWithDesktopWindowState,
  requestDesktopWindowState,
} from "@/lib/desktopBridge";
import styles from "./page.module.css";

const NAV_ITEMS = [
  { id: "logs", label: "Call Logs" },
  { id: "dashboard", label: "Dashboard" },
  { id: "insights", label: "VoiceIQ Insights" },
];

const TABLE_COLUMNS = [
  { key: "startedAtEpoch", label: "Start Time" },
  { key: "endedAtEpoch", label: "End Time" },
  { key: "agent", label: "Agent" },
  { key: "customer", label: "Customer" },
  { key: "callTranscript", label: "Call Transcript" },
  { key: "aiAnalysis", label: "AI Analysis" },
  { key: "durationSeconds", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "disposition", label: "Post Call" },
  { key: "contactId", label: "Contact ID" },
  { key: "recordingUrl", label: "Recording Link" },
];

const INSIGHT_PROMPTS = [
  "What's the average agent engagement rate for the last month calls?",
  "Which agents handled the most calls over the last 30 days?",
  "How is inbound volume trending over the last two weeks?",
  "What is the current connected rate from the available call logs?",
  "Can you generate a PDF presentation with the call performance highlights and statistics for the last month?",
];

const INITIAL_CHAT = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Ask about call center operations, support performance, sales activity, team coaching, QA, trends, or report exports. Unrelated questions are blocked automatically.",
    bullets: [],
    attachments: [],
  },
];

const QUBIT_ASSET_BASE = "/img/qubit-svg-expressions";

const QUBIT_EXPRESSIONS = {
  alerting: {
    src: `${QUBIT_ASSET_BASE}/qubit-alerting.svg`,
    label: "Needs attention",
    className: "insightsQubitAlerting",
  },
  celebrating: {
    src: `${QUBIT_ASSET_BASE}/qubit-celebrating.svg`,
    label: "Report ready",
    className: "insightsQubitCelebrating",
  },
  suggesting: {
    src: `${QUBIT_ASSET_BASE}/qubit-suggesting.svg`,
    label: "Insight ready",
    className: "insightsQubitSuggesting",
  },
  supporting: {
    src: `${QUBIT_ASSET_BASE}/qubit-supporting.svg`,
    label: "Standing by",
    className: "insightsQubitSupporting",
  },
  thinking: {
    src: `${QUBIT_ASSET_BASE}/qubit-thinking.svg`,
    label: "Analyzing",
    className: "insightsQubitThinking",
  },
};

function getInsightsQubitExpression({ chatLoading, chatError, chatWarning, chatMessages }) {
  if (chatError || chatWarning) {
    return QUBIT_EXPRESSIONS.alerting;
  }

  if (chatLoading) {
    return QUBIT_EXPRESSIONS.thinking;
  }

  const latestAssistantMessage = [...chatMessages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (latestAssistantMessage?.attachments?.length) {
    return QUBIT_EXPRESSIONS.celebrating;
  }

  if (latestAssistantMessage && latestAssistantMessage.id !== "welcome") {
    return QUBIT_EXPRESSIONS.suggesting;
  }

  return QUBIT_EXPRESSIONS.supporting;
}

function formatMetricNumber(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function formatPercent(value) {
  return `${formatMetricNumber(value, 1)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildStatusBreakdown(logs) {
  return Object.entries(
    logs.reduce((accumulator, log) => {
      const key = log.status || "Unknown";
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {})
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);
}

function getStatusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("complete")) return styles.statusSuccess;
  if (normalized.includes("process")) return styles.statusInfo;
  if (normalized.includes("unknown")) return styles.statusMuted;
  return styles.statusWarning;
}

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function decodeBase64ToBlob(base64, mimeType) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}


export default function CallLogsClient() {
  const router = useRouter();
  const chatStreamRef = useRef(null);
  const [activeView, setActiveView] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    applyRememberedDesktopWindowState();
    requestDesktopWindowState("maximized", "call-logs");
  }, []);
  const [warning, setWarning] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [cursorStack, setCursorStack] = useState([null]);
  const [nextCursor, setNextCursor] = useState(null);
  const [schemaKeys, setSchemaKeys] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "startedAtEpoch", direction: "desc" });
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState(INITIAL_CHAT);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatWarning, setChatWarning] = useState("");
  const [chatError, setChatError] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);
  const [deleteRestrictionVisible, setDeleteRestrictionVisible] = useState(false);
  const currentCursor = cursorStack[cursorStack.length - 1];
  const insightsQubitExpression = useMemo(
    () =>
      getInsightsQubitExpression({
        chatLoading,
        chatError,
        chatWarning,
        chatMessages,
      }),
    [chatError, chatLoading, chatMessages, chatWarning]
  );

  useEffect(() => {
    const authToken = localStorage.getItem("authToken");
    if (!authToken) {
      router.push("/auth/login");
      return;
    }

    let isMounted = true;

    async function loadCallLogs() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams({
          pageSize: String(pageSize),
          startDate,
          endDate,
          search: searchTerm,
        });

        if (currentCursor) {
          params.set("cursor", currentCursor);
        }

        const response = await fetch(`/api/call-logs?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load call logs.");
        }

        if (isMounted) {
          setLogs(payload.logs || []);
          setWarning(payload.warning || "");
          setNextCursor(payload.meta?.nextCursor || null);
          setSchemaKeys(payload.meta?.schemaDiagnostics?.sampleKeys || []);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load call logs.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadCallLogs();
    return () => {
      isMounted = false;
    };
  }, [currentCursor, endDate, pageSize, router, searchTerm, startDate]);

  useEffect(() => {
    if (activeView === "insights" && chatStreamRef.current) {
      chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }
  }, [activeView, chatLoading, chatMessages]);

  useEffect(() => {
    if (!deleteRestrictionVisible) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setDeleteRestrictionVisible(false);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [deleteRestrictionVisible]);

  useEffect(() => {
    if (!selectedLog) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        closeLogDetails();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedLog]);

  useEffect(() => {
    if (!selectedLog) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedLog]);

  const sortedLogs = useMemo(() => {
    const next = [...logs];
    next.sort((left, right) => {
      const leftValue = left[sortConfig.key];
      const rightValue = right[sortConfig.key];

      if (leftValue === rightValue) return 0;
      if (sortConfig.direction === "asc") {
        return leftValue > rightValue ? 1 : -1;
      }

      return leftValue < rightValue ? 1 : -1;
    });

    return next;
  }, [logs, sortConfig]);

  const metrics = useMemo(() => buildCallLogMetrics(logs), [logs]);
  const dailyVolume = useMemo(() => buildDailyVolume(logs, 14), [logs]);
  const topAgents = useMemo(() => buildAgentBreakdown(logs, 5), [logs]);
  const statusBreakdown = useMemo(() => buildStatusBreakdown(logs), [logs]);

  function handleBackToDialer() {
    navigateWithDesktopWindowState({
      href: "/",
      router,
      state: "normal",
      view: "dialer",
    });
  }

  function renderBackToDialerAction() {
    return (
      <button className={styles.heroDialerLink} onClick={handleBackToDialer}>
        <span>Back to dialer</span>
        <PhoneCall size={15} strokeWidth={2.2} />
      </button>
    );
  }

  function toggleSort(columnKey) {
    setSortConfig((current) => ({
      key: columnKey,
      direction: current.key === columnKey && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  function resetFilters() {
    setStartDate("");
    setEndDate("");
    setSearchTerm("");
    setCursorStack([null]);
  }

  function handleFiltersChange(setter, value) {
    setter(value);
    setCursorStack([null]);
  }

  function goToPreviousPage() {
    if (cursorStack.length === 1) return;
    setCursorStack((current) => current.slice(0, -1));
  }

  function goToNextPage() {
    if (!nextCursor) return;
    setCursorStack((current) => [...current, nextCursor]);
  }

  async function handleDownload(attachment) {
    const blob = decodeBase64ToBlob(attachment.base64, attachment.mimeType);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.filename;
    link.style.display = "none";
    const parent = document.body || document.documentElement;
    if (parent) {
      parent.appendChild(link);
    }
    link.click();
    if (link.parentNode) {
      link.parentNode.removeChild(link);
    }
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(value) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      console.error("Failed to copy value to clipboard.", error);
    }
  }

  function downloadLogSnapshot(log) {
    const payload = {
      ...log,
      exportedAt: new Date().toISOString(),
    };

    handleDownload({
      filename: `call-record-${log.id}.json`,
      mimeType: "application/json",
      base64: window.btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2)))),
    });
  }

  function openLogDetails(log) {
    setSelectedLog(log);
    setDeleteRestrictionVisible(false);
  }

  function closeLogDetails() {
    setSelectedLog(null);
    setDeleteRestrictionVisible(false);
  }

  function renderSelectedLogModal() {
    if (!selectedLog) {
      return null;
    }

    return (
      <div className={styles.modalScrim} onClick={closeLogDetails}>
        <div
          className={styles.recordModal}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-record-detail-title"
        >
          <button className={styles.modalClose} onClick={closeLogDetails} aria-label="Close call record details">
            <X size={18} strokeWidth={2.4} />
          </button>

          <div className={styles.modalHeader}>
            <div>
              <p className={styles.modalEyebrow}>Call Record Detail</p>
              <h2 id="call-record-detail-title" className={styles.modalTitle}>
                {selectedLog.customer}
              </h2>
              <p className={styles.modalSubtle}>
                {formatDateTime(selectedLog.startedAt)} {" - "} {selectedLog.agent}
              </p>
            </div>
            <span className={cx(styles.statusPill, getStatusClass(selectedLog.status))}>
              {selectedLog.status}
            </span>
          </div>

          <div className={styles.modalGrid}>
            <div className={styles.detailCard}>
              <span className={styles.detailLabel}>Transcript ID</span>
              <strong className={styles.detailValueMono}>{selectedLog.id}</strong>
            </div>
            <div className={styles.detailCard}>
              <span className={styles.detailLabel}>Contact ID</span>
              <strong className={styles.detailValueMono}>{selectedLog.contactId}</strong>
            </div>
            <div className={styles.detailCard}>
              <span className={styles.detailLabel}>Duration</span>
              <strong>{formatDuration(selectedLog.durationSeconds)}</strong>
            </div>
            <div className={styles.detailCard}>
              <span className={styles.detailLabel}>Post Call</span>
              <strong>{selectedLog.disposition}</strong>
            </div>
          </div>

          <div className={styles.modalSections}>
            <section className={styles.modalSection}>
              <div className={styles.modalSectionHeader}>
                <h3>Call Transcript</h3>
                <button
                  type="button"
                  className={styles.inlineAction}
                  onClick={() => copyToClipboard(selectedLog.callTranscript)}
                >
                  <Copy size={14} strokeWidth={2} />
                  <span>Copy transcript</span>
                </button>
              </div>
              <p className={styles.modalBodyText}>{selectedLog.callTranscript || "No transcript stored for this record."}</p>
            </section>

            <section className={styles.modalSection}>
              <div className={styles.modalSectionHeader}>
                <h3>AI Analysis</h3>
              </div>
              <p className={styles.modalBodyText}>{selectedLog.aiAnalysis || "No AI analysis stored for this record."}</p>
            </section>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => downloadLogSnapshot(selectedLog)}
            >
              <Download size={16} strokeWidth={2} />
              <span>Download JSON</span>
            </button>

            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => copyToClipboard(selectedLog.id)}
            >
              <Copy size={16} strokeWidth={2} />
              <span>Copy Record ID</span>
            </button>

            {selectedLog.recordingUrl ? (
              <a
                className={styles.primaryButton}
                href={selectedLog.recordingUrl}
                target="_blank"
                rel="noreferrer"
              >
                <CassetteTape size={16} strokeWidth={2} />
                <span>Open Recording</span>
              </a>
            ) : null}

            <button
              type="button"
              className={styles.deleteAction}
              onClick={() => setDeleteRestrictionVisible(true)}
            >
              <Trash2 size={16} strokeWidth={2} />
              <span>Delete Record</span>
            </button>
          </div>
        </div>

        {deleteRestrictionVisible ? (
          <div
            className={styles.permissionPromptLayer}
            onClick={() => setDeleteRestrictionVisible(false)}
          >
            <div
              className={styles.permissionPrompt}
              onClick={(event) => event.stopPropagation()}
              role="alertdialog"
              aria-labelledby="delete-record-restriction-title"
              aria-describedby="delete-record-restriction-copy"
            >
              <button
                type="button"
                className={styles.permissionToastClose}
                onClick={() => setDeleteRestrictionVisible(false)}
                aria-label="Dismiss permission notice"
              >
                <X size={14} strokeWidth={2.4} />
              </button>
              <strong id="delete-record-restriction-title" className={styles.permissionPromptTitle}>
                Delete record unavailable
              </strong>
              <p id="delete-record-restriction-copy" className={styles.permissionPromptText}>
                Only Super Admins can delete Call Records.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  async function submitQuestion(questionOverride) {
    const nextQuestion = String(questionOverride ?? chatInput).trim();
    if (!nextQuestion || chatLoading) {
      return;
    }

    const history = chatMessages
      .filter((message) => message.id !== "welcome")
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setChatMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: nextQuestion,
        bullets: [],
        attachments: [],
      },
    ]);
    setChatInput("");
    setChatError("");
    setChatWarning("");
    setChatLoading(true);

    try {
      const response = await fetch("/api/voiceiq-insights", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: nextQuestion,
          history,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to get a VoiceIQ response.");
      }

      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: payload.answer || "No response returned.",
          bullets: payload.bullets || [],
          attachments: payload.attachments || [],
        },
      ]);
      setChatWarning(payload.warning || "");
    } catch (requestError) {
      setChatError(requestError instanceof Error ? requestError.message : "Failed to get a VoiceIQ response.");
    } finally {
      setChatLoading(false);
    }
  }


  function renderHero(eyebrow, chip, title, text, action) {
    return (
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrowRow}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <span className={styles.chip}>{chip}</span>
          </div>
          <div className={styles.heroTitleRow}>
            <h1 className={styles.heroTitle}>{title}</h1>
            {action ? <span className={styles.heroTitleDivider}>|</span> : null}
            {action}
          </div>
          <p className={styles.heroText}>{text}</p>
        </div>
      </div>
    );
  }

  function renderLogs() {
    return (
      <section className={cx(styles.panel, styles.logsPanel)}>
        <div className={styles.panelInner}>
          {renderHero(
            "CallLogsV2",
            "Operations Console",
            "Call Logs",
            "Standard CDR-style review mapped to the real CallLogsV2 fields: transcript, timing, caller ownership, contact, status, post-call outcome, and AI summary.",
            renderBackToDialerAction()
          )}

          <div className={styles.summaryGrid}>
            <article className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Visible Records</span>
              <strong className={styles.summaryValue}>{formatMetricNumber(sortedLogs.length)}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Connected Rate</span>
              <strong className={styles.summaryValue}>{formatPercent(metrics.connectedRate)}</strong>
            </article>
            <article className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Average Duration</span>
              <strong className={styles.summaryValue}>{formatDuration(metrics.avgDurationSeconds)}</strong>
            </article>
          </div>

          <div className={styles.filtersCard}>
            <div className={styles.filtersTop}>
              <div>
                <h2 className={styles.filtersTitle}>Refine the Log View</h2>
                <p className={styles.filtersText}>Filter by timeframe, search by people or transcript IDs, and page through the stored records.</p>
              </div>
              <button className={styles.ghostButton} onClick={resetFilters}>Reset filters</button>
            </div>

            <div className={styles.filtersGrid}>
              <label className={styles.field}>
                Start date
                <input className={styles.input} type="date" value={startDate} onChange={(event) => handleFiltersChange(setStartDate, event.target.value)} />
              </label>
              <label className={styles.field}>
                End date
                <input className={styles.input} type="date" value={endDate} onChange={(event) => handleFiltersChange(setEndDate, event.target.value)} />
              </label>
              <label className={cx(styles.field, styles.searchField)}>
                Search
                <input
                  className={styles.input}
                  type="search"
                  value={searchTerm}
                  placeholder="Agent, customer, status, transcript ID..."
                  onChange={(event) => handleFiltersChange(setSearchTerm, event.target.value)}
                />
              </label>
              <label className={styles.field}>
                Rows per page
                <select className={styles.select} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setCursorStack([null]); }}>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
            </div>
          </div>

          {warning ? <div className={cx(styles.message, styles.warning)}>{warning}</div> : null}
          {error ? <div className={cx(styles.message, styles.error)}>{error}</div> : null}
          {loading ? <div className={cx(styles.message, styles.neutral)}>Loading call logs from DynamoDB...</div> : null}

          {!loading && !error ? (
            <div className={styles.tableCard}>
              <div className={styles.tableMeta}>
                <span>{formatMetricNumber(sortedLogs.length)} records on this page</span>
                <span className={styles.sortChip}>Sorted by {sortConfig.key.replace(/([A-Z])/g, " $1")}</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((column) => (
                        <th key={column.key}>
                          <button className={styles.tableHeadButton} onClick={() => toggleSort(column.key)}>
                            {column.label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLogs.length ? (
                      sortedLogs.map((log) => (
                        <tr
                          key={log.id}
                          className={styles.clickableRow}
                          onClick={() => openLogDetails(log)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openLogDetails(log);
                            }
                          }}
                          tabIndex={0}
                        >
                          <td><div className={styles.stackCell}><strong>{formatDateTime(log.startedAt)}</strong><span>Started</span></div></td>
                          <td><div className={styles.stackCell}><strong>{formatDateTime(log.endedAt)}</strong><span>Ended</span></div></td>
                          <td><div className={styles.stackCell}><strong>{log.agent}</strong><span>{log.agentEmail}</span></div></td>
                          <td><span className={styles.customerPill}>{log.customer}</span></td>
                          <td><div className={styles.textCard} title={log.callTranscript}><span className={styles.textLabel}>Transcript</span><span className={styles.textPreview}>{log.callTranscriptPreview}</span></div></td>
                          <td><div className={styles.analysisCard} title={log.aiAnalysis}><span className={styles.textLabel}>Analysis</span><span className={styles.textPreview}>{log.aiAnalysisPreview}</span></div></td>
                          <td><span className={styles.durationPill}>{formatDuration(log.durationSeconds)}</span></td>
                          <td><span className={cx(styles.statusPill, getStatusClass(log.status))}>{log.status}</span></td>
                          <td><span className={styles.dispositionPill}>{log.disposition}</span></td>
                          <td className={styles.mono}>{log.contactId}</td>
                          <td>
                            <div className={styles.recordingCell}>
                              {log.recordingUrl ? (
                                <a
                                  className={styles.recordingLink}
                                  href={log.recordingUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Open recording"
                                  title="Open recording"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                <CassetteTape size={16} strokeWidth={2} />
                              </a>
                            ) : (
                              <span className={styles.recordingMissing}>No Recording</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={TABLE_COLUMNS.length} className={styles.emptyState}>No call logs match the current filters.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <button className={styles.ghostButton} onClick={goToPreviousPage} disabled={cursorStack.length === 1 || loading}>Previous</button>
                <span className={styles.paginationLabel}>Page {cursorStack.length}</span>
                <button className={styles.primaryButton} onClick={goToNextPage} disabled={!nextCursor || loading}>Next</button>
              </div>
            </div>
          ) : null}

          {schemaKeys.length ? (
            <div className={styles.schemaNote}>
              <strong>Detected fields from sampled records</strong>: {schemaKeys.join(", ")}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderDashboard() {
    const peakVolume = Math.max(...dailyVolume.map((item) => item.value), 1);

    return (
      <section className={cx(styles.panel, styles.dashboardPanel)}>
        <div className={styles.panelInner}>
          {renderHero(
            "Operations Snapshot",
            "Insurance Agency View",
            "DashboardIQ",
            "A vibrant KPI layer for call performance, transcript coverage, and agent activity using live data.",
            renderBackToDialerAction()
          )}

          <div className={styles.metricsGrid}>
            <article className={cx(styles.metricCard, styles.metricCardFeatured)}>
              <span className={styles.metricLabel}>Total Calls</span>
              <strong className={styles.metricValue}>{formatMetricNumber(metrics.totalCalls)}</strong>
              <p className={styles.metricText}>Filtered dataset</p>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Connected Rate</span>
              <strong className={styles.metricValue}>{formatPercent(metrics.connectedRate)}</strong>
              <p className={styles.metricText}>Answered or duration-bearing calls</p>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Average Duration</span>
              <strong className={styles.metricValue}>{formatDuration(metrics.avgDurationSeconds)}</strong>
              <p className={styles.metricText}>Across the visible call set</p>
            </article>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Calls Today</span>
              <strong className={styles.metricValue}>{formatMetricNumber(metrics.callsToday)}</strong>
              <p className={styles.metricText}>Since local midnight</p>
            </article>
          </div>

          <div className={styles.dashboardGrid}>
            <div className={styles.chartCard}>
              <div className={styles.cardHeader}>
                <h2>14-Day Volume</h2>
                <span className={styles.chip}>Live counts</span>
              </div>
              <div className={styles.bars}>
                {dailyVolume.map((item) => (
                  <div key={item.date} className={styles.barColumn}>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ height: `${(item.value / peakVolume) * 100}%` }} />
                    </div>
                    <strong className={styles.barValue}>{item.value}</strong>
                    <span className={styles.barLabel}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.accentCard}>
              <div className={styles.cardHeader}>
                <h2>Transcript Status</h2>
                <span>Live totals</span>
              </div>
              <div className={styles.statusGrid}>
                {statusBreakdown.slice(0, 3).map((item) => (
                  <div key={item.status} className={styles.statusCard}>
                    <strong className={styles.statusCount}>{formatMetricNumber(item.count)}</strong>
                    <div className={styles.statusName}>{item.status}</div>
                  </div>
                ))}
              </div>
              <p className={styles.statusMeta}>This panel reflects the actual transcript lifecycle fields stored in CallLogsV2.</p>
            </div>

            <div className={styles.chartCard}>
              <div className={styles.cardHeader}>
                <h2>Top Agents</h2>
                <span className={styles.chip}>Live ranking</span>
              </div>
              <div className={styles.agentList}>
                {topAgents.length ? (
                  topAgents.map((item) => (
                    <div key={item.agent} className={styles.agentRow}>
                      <span>{item.agent}</span>
                      <strong>{item.calls} calls</strong>
                    </div>
                  ))
                ) : (
                  <div className={styles.metricText}>Agent attribution is not present on the currently visible logs.</div>
                )}
              </div>
            </div>

            <div className={styles.accentCard}>
              <div className={styles.cardHeader}>
                <h2>Stored Data Coverage</h2>
                <span>Schema-backed</span>
              </div>
              <div className={styles.coverageList}>
                <div className={styles.coverageItem}>
                  <strong className={styles.coverageValue}>{formatMetricNumber(logs.filter((log) => log.recordingUrl).length)}</strong>
                  <span>records include a recording reference</span>
                </div>
                <div className={styles.coverageItem}>
                  <strong className={styles.coverageValue}>{formatMetricNumber(logs.filter((log) => log.disposition && log.disposition !== "-").length)}</strong>
                  <span>records include a post-call selection</span>
                </div>
                <div className={styles.coverageItem}>
                  <strong className={styles.coverageValue}>{formatMetricNumber(logs.filter((log) => log.aiAnalysis && log.aiAnalysis !== "-").length)}</strong>
                  <span>records include AI analysis text</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderInsights() {
    return (
      <section className={cx(styles.panel, styles.insightsPanel)}>
        <div className={styles.panelInner}>
          {renderHero(
            "Conversational Analytics",
            "VoiceIQ Live",
            "VoiceIQ Insights",
            "Live assistant access CDR data for call center analytics, support, sales, QA, coaching, and report exports.",
            renderBackToDialerAction()
          )}

          <div className={styles.insightsLayout}>
            <div className={styles.promptList}>
              {INSIGHT_PROMPTS.map((prompt, index) => (
                <button
                  key={prompt}
                  className={styles.promptButton}
                  onClick={() => submitQuestion(prompt)}
                  disabled={chatLoading}
                >
                  <span className={styles.promptIndex}>{index + 1}</span>
                  <span>{prompt}</span>
                </button>
              ))}

              <div className={styles.guidanceCard}>
                <strong>Allowed topics</strong>
                <p>Call logs, agent performance, support, sales, coaching, QA, trends, and report exports.</p>
                <strong>Blocked topics</strong>
                <p>Unrelated requests return the default not-allowed response instead of an AI answer.</p>
              </div>
            </div>

            <div className={styles.chatCard}>
              <div className={styles.insightsQubitHeader}>
                <div className={styles.insightsQubitAvatarWrap} aria-hidden="true">
                  <img
                    key={insightsQubitExpression.src}
                    className={cx(
                      styles.insightsQubitAvatar,
                      styles[insightsQubitExpression.className]
                    )}
                    src={insightsQubitExpression.src}
                    alt=""
                    width="96"
                    height="96"
                  />
                </div>
                <div className={styles.insightsQubitCopy}>
                  <span className={styles.chatSubtle}>VoiceIQ Insights</span>
                  <strong>Qubit</strong>
                  <span className={styles.chatSubtle}>Analytics assistant with DynamoDB call log context</span>
                </div>
                <span className={styles.readyPill}>{insightsQubitExpression.label}</span>
              </div>

              {chatWarning ? <div className={cx(styles.message, styles.warning)}>{chatWarning}</div> : null}
              {chatError ? <div className={cx(styles.message, styles.error)}>{chatError}</div> : null}

              <div className={styles.chatStream} ref={chatStreamRef}>
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={message.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAssistant}
                  >
                    <span className={styles.chatRole}>{message.role === "user" ? "You" : "Qubit"}</span>
                    <p className={styles.chatText}>{message.content}</p>

                    {message.bullets?.length ? (
                      <div className={styles.chatBullets}>
                        {message.bullets.map((bullet) => (
                          <div key={bullet} className={styles.chatBulletItem}>{bullet}</div>
                        ))}
                      </div>
                    ) : null}

                    {message.attachments?.length ? (
                      <div className={styles.attachmentList}>
                        {message.attachments.map((attachment) => (
                          <button
                            key={attachment.filename}
                            className={styles.attachmentButton}
                            onClick={() => handleDownload(attachment)}
                          >
                            <Download size={16} strokeWidth={2} />
                            <span>{attachment.label || attachment.filename}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}

                {chatLoading ? (
                  <div className={styles.chatBubbleAssistant}>
                    <span className={styles.chatRole}>Qubit</span>
                    <p className={styles.chatText}>Reviewing the live data and preparing the response...</p>
                  </div>
                ) : null}
              </div>

              <div className={styles.chatFooter}>
                <textarea
                  className={styles.chatInput}
                  value={chatInput}
                  placeholder="Ask about support, sales, team performance, trends, or request a PDF / CSV / JSON report..."
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitQuestion();
                    }
                  }}
                  rows={3}
                />
                <button className={styles.chatButton} onClick={() => submitQuestion()} disabled={chatLoading || !chatInput.trim()}>
                  <Send size={16} strokeWidth={2} />
                  <span>Send</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className={styles.page}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}>
            <img src="/img/TCEVoiceIQ-Vecotized-Logo1.svg" alt="TCE VoiceIQ logo" className={styles.sidebarLogo} />
            <p className={styles.sidebarEyebrow}>TCE VoiceIQ</p>
            <h2 className={styles.sidebarTitle}>My Call Logs</h2>
          </div>

          <nav className={styles.nav}>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={cx(styles.navItem, activeView === item.id && styles.navItemActive)}
                onClick={() => setActiveView(item.id)}
              >
                {item.label}
              </button>
            ))}

            <button
              className={styles.navItem}
              onClick={handleBackToDialer}
            >
              <span>Back to dialer</span>
              <PhoneCall size={16} strokeWidth={2.2} />
            </button>
          </nav>
        </aside>

        <main className={styles.content}>
          {activeView === "logs" ? renderLogs() : null}
          {activeView === "dashboard" ? renderDashboard() : null}
          {activeView === "insights" ? renderInsights() : null}
        </main>
      </div>

      {selectedLog && typeof document !== "undefined"
        ? createPortal(renderSelectedLogModal(), document.body)
        : null}
    </>
  );
}
