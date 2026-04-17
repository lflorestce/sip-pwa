import CallLogsClient from "./CallLogsClient";

export default function CallLogsPage() {
  return <CallLogsClient />;
}
/*
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildAgentBreakdown,
  buildCallLogMetrics,
  buildDailyVolume,
  formatDuration,
} from "@/lib/callLogTransforms";

const NAV_ITEMS = [
  { id: "logs", label: "Call Logs" },
  { id: "dashboard", label: "Dashboard" },
  { id: "insights", label: "VoiceIQ Insights" },
];

const TABLE_COLUMNS = [
  { key: "startedAt", label: "Start Time" },
  { key: "endedAt", label: "End Time" },
  { key: "agent", label: "Agent" },
  { key: "customer", label: "Customer" },
  { key: "callTranscript", label: "Call Transcript" },
  { key: "aiAnalysis", label: "AI Analysis" },
  { key: "durationSeconds", label: "Duration" },
  { key: "status", label: "Status" },
  { key: "disposition", label: "Post Call" },
  { key: "contactId", label: "Contact ID" },
  { key: "id", label: "Transcript ID" },
];

const INSIGHT_PROMPTS = [
  "What's the average agent engagement rate for the last month calls?",
  "Which agents handled the most calls over the last 30 days?",
  "How is inbound volume trending over the last two weeks?",
  "What is the current connected rate from the available call logs?",
  "Which call outcomes should we investigate first this week?",
];

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

function buildInsightAnswer(question, metrics, topAgents, dailyVolume) {
  if (question.includes("engagement")) {
    return metrics.avgEngagementRate !== null
      ? `Based on the current dataset, the average agent engagement rate is ${formatPercent(metrics.avgEngagementRate)}. This is using the engagement fields present in CallLogsV2.`
      : "Engagement scoring is not present consistently in the current dataset yet. The panel is ready to surface it as soon as those fields are populated.";
  }

  if (question.includes("most calls")) {
    if (!topAgents.length) {
      return "There are no agent-attributed calls in the current dataset yet, so this ranking is still empty.";
    }

    const summary = topAgents.map((item) => `${item.agent} (${item.calls})`).join(", ");
    return `The current leaders by call volume are ${summary}. This answer is generated from the live call logs loaded into the dashboard.`;
  }

  if (question.includes("inbound volume")) {
    const highestDay = [...dailyVolume].sort((left, right) => right.value - left.value)[0];
    return highestDay
      ? `Inbound and overall trend visuals are still in placeholder mode, but the recent dataset shows the heaviest day at ${highestDay.label} with ${highestDay.value} calls.`
      : "There is not enough recent call activity loaded yet to describe a trend.";
  }

  if (question.includes("connected rate")) {
    return `The current connected rate is ${formatPercent(metrics.connectedRate)}, calculated from answered or duration-bearing calls vs the total records currently loaded.`;
  }

  if (question.includes("investigate")) {
    return metrics.missedCalls > 0
      ? `Missed or unconnected calls are the clearest investigation bucket right now. The dataset shows ${formatMetricNumber(metrics.missedCalls)} calls that were not classified as connected.`
      : "The current sample is heavily connected, so the next review area would likely be sentiment, coaching, or talk-time outliers once those overlays are turned on.";
  }

  return "VoiceIQ answer placeholders are active. We can replace these with retrieval-backed insights in the next phase.";
}

function buildStatusBreakdown(logs) {
  const counts = logs.reduce((accumulator, log) => {
    const key = log.status || "Unknown";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count);
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized.includes("complete")) {
    return "success";
  }

  if (normalized.includes("process")) {
    return "info";
  }

  if (normalized.includes("unknown")) {
    return "muted";
  }

  return "warning";
}

export default function CallLogsPage() {
  const router = useRouter();
  const [activeView, setActiveView] = useState("logs");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [cursorStack, setCursorStack] = useState([null]);
  const [nextCursor, setNextCursor] = useState(null);
  const [schemaKeys, setSchemaKeys] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "startedAtEpoch", direction: "desc" });
  const [selectedPrompt, setSelectedPrompt] = useState(INSIGHT_PROMPTS[0]);
  const currentCursor = cursorStack[cursorStack.length - 1];

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

  const sortedLogs = useMemo(() => {
    const next = [...logs];
    next.sort((left, right) => {
      const leftValue = left[sortConfig.key];
      const rightValue = right[sortConfig.key];

      if (leftValue === rightValue) {
        return 0;
      }

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
  const voiceIqAnswer = useMemo(
    () => buildInsightAnswer(selectedPrompt, metrics, topAgents, dailyVolume),
    [dailyVolume, metrics, selectedPrompt, topAgents]
  );

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

  function handlePageSizeChange(value) {
    setPageSize(Number(value));
    setCursorStack([null]);
  }

  function goToNextPage() {
    if (!nextCursor) {
      return;
    }

    setCursorStack((current) => [...current, nextCursor]);
  }

  function goToPreviousPage() {
    if (cursorStack.length === 1) {
      return;
    }

    setCursorStack((current) => current.slice(0, -1));
  }

  function renderCallLogs() {
    return (
      <section className="panel logs-panel">
        <div className="panel-header">
          <div className="hero-copy">
            <div className="hero-badge-row">
              <p className="eyebrow">CallLogsV2</p>
              <span className="hero-chip">Operations Console</span>
            </div>
            <h1>Call Logs</h1>
            <p className="panel-copy">Standard CDR-style review mapped to the real `CallLogsV2` fields: transcript, timing, caller ownership, contact, status, and post-call outcome.</p>
          </div>
          <button className="secondary-button" onClick={() => router.push("/")}>
            Back to Dialer
          </button>
        </div>

        <div className="summary-strip">
          <div className="summary-card">
            <span>Visible Records</span>
            <strong>{formatMetricNumber(sortedLogs.length)}</strong>
          </div>
          <div className="summary-card">
            <span>Connected Rate</span>
            <strong>{formatPercent(metrics.connectedRate)}</strong>
          </div>
          <div className="summary-card">
            <span>Average Duration</span>
            <strong>{formatDuration(metrics.avgDurationSeconds)}</strong>
          </div>
        </div>

        <div className="filters-card">
          <div className="filters-heading">
            <div>
              <h2>Refine the Log View</h2>
              <p>Filter by timeframe, search by people or transcript IDs, and page through the stored records.</p>
            </div>
            <button className="ghost-button" onClick={resetFilters}>Reset filters</button>
          </div>
          <div className="filters-grid">
            <label>
              Start date
              <input type="date" value={startDate} onChange={(event) => handleFiltersChange(setStartDate, event.target.value)} />
            </label>
            <label>
              End date
              <input type="date" value={endDate} onChange={(event) => handleFiltersChange(setEndDate, event.target.value)} />
            </label>
            <label className="search-field">
              Search
              <input
                type="search"
                value={searchTerm}
                placeholder="Agent, customer, status, call ID..."
                onChange={(event) => handleFiltersChange(setSearchTerm, event.target.value)}
              />
            </label>
            <label>
              Rows per page
              <select value={pageSize} onChange={(event) => handlePageSizeChange(event.target.value)}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </label>
          </div>
        </div>

        {warning ? <div className="message warning">{warning}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
        {loading ? <div className="message neutral">Loading call logs from DynamoDB...</div> : null}

        {!loading && !error ? (
          <div className="table-shell">
            <div className="table-meta">
              <span>{formatMetricNumber(sortedLogs.length)} records on this page</span>
              <span className="sort-chip">Sorted by {sortConfig.key.replace(/([A-Z])/g, " $1")}</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {TABLE_COLUMNS.map((column) => (
                      <th key={column.key}>
                        <button className="header-button" onClick={() => toggleSort(column.key === "startedAt" ? "startedAtEpoch" : column.key)}>
                          {column.label}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedLogs.length ? (
                    sortedLogs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          <div className="timestamp-cell">
                            <strong>{formatDateTime(log.startedAt)}</strong>
                            <span>Started</span>
                          </div>
                        </td>
                        <td>
                          <div className="timestamp-cell">
                            <strong>{formatDateTime(log.endedAt)}</strong>
                            <span>Ended</span>
                          </div>
                        </td>
                        <td>
                          <div className="agent-cell">
                            <strong>{log.agent}</strong>
                            <span>{log.agentEmail}</span>
                          </div>
                        </td>
                        <td>
                          <span className="customer-pill">{log.customer}</span>
                        </td>
                        <td>
                          <div className="text-preview-cell" title={log.callTranscript}>
                            <strong>Transcript</strong>
                            <span>{log.callTranscriptPreview}</span>
                          </div>
                        </td>
                        <td>
                          <div className="text-preview-cell analysis" title={log.aiAnalysis}>
                            <strong>Analysis</strong>
                            <span>{log.aiAnalysisPreview}</span>
                          </div>
                        </td>
                        <td>
                          <span className="duration-pill">{formatDuration(log.durationSeconds)}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${getStatusTone(log.status)}`}>{log.status}</span>
                        </td>
                        <td>
                          <span className="disposition-pill">{log.disposition}</span>
                        </td>
                        <td className="call-id">{log.contactId}</td>
                        <td className="call-id">{log.id}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={TABLE_COLUMNS.length} className="empty-state">
                        No call logs match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination-row">
              <button className="ghost-button" onClick={goToPreviousPage} disabled={cursorStack.length === 1 || loading}>
                Previous
              </button>
              <span>Page {cursorStack.length}</span>
              <button className="secondary-button" onClick={goToNextPage} disabled={!nextCursor || loading}>
                Next
              </button>
            </div>
          </div>
        ) : null}

        {schemaKeys.length ? (
          <div className="schema-note">
            <strong>Detected fields from sampled records</strong>: {schemaKeys.join(", ")}
          </div>
        ) : null}
      </section>
    );
  }

  function renderDashboard() {
    const peakVolume = Math.max(...dailyVolume.map((item) => item.value), 1);

    return (
      <section className="panel dashboard-panel">
        <div className="panel-header">
          <div className="hero-copy">
            <div className="hero-badge-row">
              <p className="eyebrow">Operations Snapshot</p>
              <span className="hero-chip">Insurance Agency View</span>
            </div>
            <h1>Dashboard</h1>
            <p className="panel-copy">Insurance-agency style KPI view using the live call-log data already stored in DynamoDB.</p>
          </div>
        </div>

        <div className="metrics-grid">
          <article className="metric-card">
            <span>Total Calls</span>
            <strong>{formatMetricNumber(metrics.totalCalls)}</strong>
            <p>Filtered dataset</p>
          </article>
          <article className="metric-card">
            <span>Connected Rate</span>
            <strong>{formatPercent(metrics.connectedRate)}</strong>
            <p>Answered or duration-bearing calls</p>
          </article>
          <article className="metric-card">
            <span>Average Duration</span>
            <strong>{formatDuration(metrics.avgDurationSeconds)}</strong>
            <p>Across the visible call set</p>
          </article>
          <article className="metric-card">
            <span>Calls Today</span>
            <strong>{formatMetricNumber(metrics.callsToday)}</strong>
            <p>Since local midnight</p>
          </article>
        </div>

        <div className="dashboard-grid">
          <article className="chart-card">
            <div className="card-title-row">
              <h2>14-Day Volume</h2>
              <span>Live counts, placeholder visual</span>
            </div>
            <div className="bars">
              {dailyVolume.map((item) => (
                <div key={item.date} className="bar-column">
                  <div className="bar-track">
                    <div className="bar-fill" style={{ height: `${(item.value / peakVolume) * 100}%` }} />
                  </div>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="chart-card">
            <div className="card-title-row">
              <h2>Transcript Status</h2>
              <span>Live totals</span>
            </div>
            <div className="split-stats">
              {statusBreakdown.slice(0, 3).map((item) => (
                <div key={item.status}>
                  <strong>{formatMetricNumber(item.count)}</strong>
                  <p>{item.status}</p>
                </div>
              ))}
            </div>
            <div className="placeholder-note">This card now reflects the actual transcript lifecycle fields stored in CallLogsV2.</div>
          </article>

          <article className="chart-card">
            <div className="card-title-row">
              <h2>Top Agents</h2>
              <span>Live ranking</span>
            </div>
            <div className="agent-list">
              {topAgents.length ? (
                topAgents.map((item) => (
                  <div key={item.agent} className="agent-row">
                    <span>{item.agent}</span>
                    <strong>{item.calls} calls</strong>
                  </div>
                ))
              ) : (
                <div className="placeholder-note">Agent attribution is not present on the currently visible logs.</div>
              )}
            </div>
          </article>

          <article className="chart-card">
            <div className="card-title-row">
              <h2>Stored Data Coverage</h2>
              <span>Schema-backed placeholders</span>
            </div>
            <div className="phase-two-box">
              <p>{formatMetricNumber(logs.filter((log) => log.recordingUrl).length)} records include a recording reference</p>
              <p>{formatMetricNumber(logs.filter((log) => log.disposition && log.disposition !== "-").length)} records include a post-call selection</p>
              <p>{formatMetricNumber(logs.filter((log) => log.notes).length)} records include post-call notes</p>
            </div>
          </article>
        </div>
      </section>
    );
  }

  function renderInsights() {
    return (
      <section className="panel insights-panel">
        <div className="panel-header">
          <div className="hero-copy">
            <div className="hero-badge-row">
              <p className="eyebrow">Conversational Analytics</p>
              <span className="hero-chip">VoiceIQ Preview</span>
            </div>
            <h1>VoiceIQ Insights</h1>
            <p className="panel-copy">Placeholder AI-chat experience seeded with common operational questions.</p>
          </div>
        </div>

        <div className="insights-layout">
          <div className="prompt-list">
            {INSIGHT_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                className={`prompt-button ${selectedPrompt === prompt ? "active" : ""}`}
                onClick={() => setSelectedPrompt(prompt)}
              >
                <span className="prompt-index">{INSIGHT_PROMPTS.indexOf(prompt) + 1}</span>
                <span>{prompt}</span>
              </button>
            ))}
          </div>

          <div className="chat-shell">
            <div className="chat-shell-header">
              <div>
                <strong>VoiceIQ Assistant</strong>
                <span>Prototype insight stream</span>
              </div>
              <span className="live-dot">Ready</span>
            </div>
            <div className="chat-message user">
              <span className="chat-role">You</span>
              <p>{selectedPrompt}</p>
            </div>
            <div className="chat-message assistant">
              <span className="chat-role">VoiceIQ</span>
              <p>{voiceIqAnswer}</p>
            </div>
            <div className="chat-footer">
              <input value="Ask a follow-up in Phase 2..." readOnly />
              <button disabled>Send</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/img/TCEVoiceIQ-Vecotized-Logo1.svg" alt="TCE VoiceIQ logo" className="sidebar-logo" />
          <p className="sidebar-eyebrow">TCE VoiceIQ</p>
          <h2>My Call Logs</h2>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              onClick={() => setActiveView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        {activeView === "logs" ? renderCallLogs() : null}
        {activeView === "dashboard" ? renderDashboard() : null}
        {activeView === "insights" ? renderInsights() : null}
      </main>

      <style jsx>{`
        .workspace {
          min-height: 100vh;
          display: grid;
          grid-template-columns: 260px 1fr;
          background:
            radial-gradient(circle at top left, rgba(198, 225, 255, 0.7), transparent 30%),
            linear-gradient(135deg, #eff5ff 0%, #f7f9fc 45%, #eef7f2 100%);
          color: #132238;
        }
        .sidebar {
          padding: 32px 24px;
          background: rgba(19, 34, 56, 0.92);
          color: #f4f8ff;
          display: flex;
          flex-direction: column;
          gap: 32px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
        }
        .sidebar-brand {
          display: grid;
          justify-items: center;
          text-align: center;
          gap: 12px;
        }
        .sidebar-logo {
          width: 160px;
          max-width: 100%;
          height: auto;
          display: block;
          filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.18));
        }
        .sidebar h2 {
          margin: 0;
          font-size: 28px;
          line-height: 1.1;
        }
        .sidebar-eyebrow,
        .eyebrow {
          margin: 0;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          opacity: 0.75;
        }
        nav {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .nav-item {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: inherit;
          text-align: left;
          padding: 14px 16px;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .nav-item.active,
        .nav-item:hover {
          background: linear-gradient(135deg, #6fb1ff, #85d4b2);
          color: #0f1b2b;
          border-color: transparent;
        }
        .content {
          padding: 28px;
          position: relative;
        }
        .content::before {
          content: "";
          position: absolute;
          inset: 18px 18px auto auto;
          width: 240px;
          height: 240px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(93, 169, 255, 0.18), transparent 68%);
          pointer-events: none;
        }
        .panel {
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(19, 34, 56, 0.08);
          border-radius: 28px;
          padding: 28px;
          box-shadow: 0 18px 45px rgba(36, 72, 120, 0.12);
          position: relative;
          overflow: hidden;
        }
        .logs-panel {
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 251, 255, 0.9)),
            rgba(255, 255, 255, 0.8);
        }
        .dashboard-panel {
          background:
            radial-gradient(circle at top right, rgba(110, 208, 182, 0.12), transparent 26%),
            linear-gradient(180deg, rgba(249, 252, 255, 0.94), rgba(243, 250, 247, 0.92));
        }
        .insights-panel {
          background:
            radial-gradient(circle at top right, rgba(100, 149, 237, 0.14), transparent 24%),
            linear-gradient(180deg, rgba(247, 250, 255, 0.96), rgba(242, 246, 255, 0.94));
        }
        .panel::after {
          content: "";
          position: absolute;
          inset: 0 auto auto 0;
          width: 100%;
          height: 1px;
          background: linear-gradient(90deg, rgba(111, 177, 255, 0.55), rgba(133, 212, 178, 0.4), transparent);
        }
        .panel-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 24px;
        }
        .hero-copy {
          display: grid;
          gap: 10px;
        }
        .hero-badge-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .hero-chip {
          display: inline-flex;
          align-items: center;
          padding: 6px 12px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(111, 177, 255, 0.15), rgba(133, 212, 178, 0.18));
          border: 1px solid rgba(111, 177, 255, 0.22);
          color: #26496b;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .panel-header h1 {
          margin: 6px 0 8px;
          font-size: 40px;
          line-height: 1.02;
          letter-spacing: -0.04em;
        }
        .panel-copy {
          margin: 0;
          max-width: 760px;
          color: #49627d;
          line-height: 1.6;
        }
        .secondary-button,
        .ghost-button {
          border: 1px solid transparent;
          border-radius: 12px;
          padding: 12px 16px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .secondary-button {
          background: linear-gradient(135deg, #18375f, #24548d);
          color: white;
          box-shadow: 0 10px 24px rgba(25, 60, 106, 0.22);
        }
        .ghost-button {
          background: rgba(230, 238, 248, 0.7);
          color: #16345d;
          align-self: end;
          border-color: #d4e0ed;
        }
        .secondary-button:hover,
        .ghost-button:hover {
          transform: translateY(-1px);
        }
        .summary-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .summary-card {
          padding: 18px 20px;
          border-radius: 22px;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(242, 249, 255, 0.85));
          border: 1px solid rgba(150, 182, 216, 0.22);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
        }
        .summary-card span {
          display: block;
          color: #607890;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: 10px;
        }
        .summary-card strong {
          font-size: 30px;
          color: #15375f;
        }
        .filters-card {
          display: grid;
          gap: 18px;
          background: linear-gradient(180deg, #f7fbff, #f2f8f8);
          border: 1px solid #dce7f3;
          border-radius: 24px;
          padding: 22px;
          margin-bottom: 20px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        .filters-heading {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }
        .filters-heading h2 {
          margin: 0 0 6px;
          font-size: 20px;
          color: #173a60;
        }
        .filters-heading p {
          margin: 0;
          color: #59718a;
        }
        .filters-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        label {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #38506d;
        }
        input,
        select {
          border: 1px solid #c9d8e8;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 14px;
          background: white;
        }
        .search-field {
          grid-column: span 2;
        }
        .message {
          border-radius: 16px;
          padding: 14px 16px;
          margin-bottom: 16px;
          font-weight: 500;
        }
        .message.warning {
          background: #fff4d6;
          color: #7a5a00;
        }
        .message.error {
          background: #ffe0de;
          color: #8f1f18;
        }
        .message.neutral {
          background: #e8f1fb;
          color: #21496f;
        }
        .table-shell {
          background: white;
          border: 1px solid #d9e5f1;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 18px 36px rgba(43, 85, 133, 0.08);
        }
        .table-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 20px;
          background: linear-gradient(180deg, #f4f8fc, #eef4fb);
          color: #5a708a;
          font-size: 13px;
          border-bottom: 1px solid #d9e5f1;
        }
        .sort-chip {
          padding: 6px 10px;
          background: white;
          border-radius: 999px;
          border: 1px solid #dbe6f1;
        }
        .table-scroll {
          overflow: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1100px;
        }
        th,
        td {
          padding: 16px 16px;
          border-bottom: 1px solid #edf2f7;
          text-align: left;
          font-size: 14px;
          white-space: nowrap;
          vertical-align: middle;
        }
        th {
          position: sticky;
          top: 0;
          background: rgba(247, 251, 255, 0.98);
          z-index: 1;
        }
        tbody tr:nth-child(even) {
          background: rgba(247, 251, 255, 0.55);
        }
        tbody tr:hover {
          background: #eef6ff;
        }
        .header-button {
          border: none;
          background: transparent;
          font-weight: 700;
          color: #1f3a5b;
          cursor: pointer;
          padding: 0;
        }
        .empty-state {
          text-align: center;
          padding: 32px;
          color: #5a708a;
        }
        .call-id {
          font-family: var(--font-geist-mono);
          font-size: 12px;
          color: #4b627e;
        }
        .timestamp-cell,
        .agent-cell {
          display: grid;
          gap: 4px;
        }
        .timestamp-cell strong,
        .agent-cell strong {
          color: #15375f;
          font-size: 13px;
        }
        .timestamp-cell span,
        .agent-cell span {
          color: #7488a0;
          font-size: 12px;
        }
        .text-preview-cell {
          display: grid;
          gap: 4px;
          max-width: 240px;
          white-space: normal;
        }
        .text-preview-cell strong {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #57708a;
        }
        .text-preview-cell span {
          font-size: 12px;
          line-height: 1.5;
          color: #26445f;
        }
        .text-preview-cell.analysis {
          padding: 10px 12px;
          border-radius: 14px;
          background: linear-gradient(135deg, #f3f6ff, #eef9ff);
          border: 1px solid #dce6f6;
        }
        .text-preview-cell.analysis span {
          color: #314f72;
        }
        .customer-pill,
        .duration-pill,
        .disposition-pill,
        .status-pill {
          display: inline-flex;
          align-items: center;
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.01em;
        }
        .customer-pill {
          background: #edf6ff;
          color: #28527a;
        }
        .duration-pill {
          background: #eff8f4;
          color: #20624a;
        }
        .disposition-pill {
          background: #f7f0ff;
          color: #6347a4;
        }
        .status-pill.success {
          background: #e7f7ef;
          color: #1e7a54;
        }
        .status-pill.info {
          background: #e8f1ff;
          color: #295ca5;
        }
        .status-pill.muted {
          background: #eef2f6;
          color: #5e7080;
        }
        .status-pill.warning {
          background: #fff3df;
          color: #a05f00;
        }
        .pagination-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 18px;
          background: #f4f8fc;
          border-top: 1px solid #d9e5f1;
        }
        .pagination-row span {
          color: #5a708a;
          font-weight: 600;
        }
        .secondary-button:disabled,
        .ghost-button:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .schema-note {
          margin-top: 16px;
          padding: 14px 16px;
          border-radius: 16px;
          background: linear-gradient(135deg, #edf5ff, #f5fbff);
          color: #3f5874;
          font-size: 13px;
          line-height: 1.6;
          border: 1px solid #d8e5f1;
        }
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .metric-card,
        .chart-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(246, 250, 255, 0.88));
          border: 1px solid #d9e5f1;
          border-radius: 24px;
          padding: 22px;
          box-shadow: 0 16px 34px rgba(46, 84, 126, 0.08);
        }
        .dashboard-panel .metric-card:first-child {
          background: linear-gradient(135deg, #17365d, #24548d);
          color: white;
          border-color: transparent;
        }
        .dashboard-panel .metric-card:first-child span,
        .dashboard-panel .metric-card:first-child strong,
        .dashboard-panel .metric-card:first-child p {
          color: white;
        }
        .dashboard-panel .chart-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(241, 249, 245, 0.92));
        }
        .metric-card span,
        .chart-card span {
          color: #5a708a;
        }
        .metric-card strong {
          display: block;
          font-size: 40px;
          margin: 10px 0 6px;
          color: #16345d;
        }
        .metric-card p,
        .placeholder-note,
        .phase-two-box p {
          margin: 0;
          color: #5a708a;
        }
        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .card-title-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
          margin-bottom: 20px;
        }
        .card-title-row h2 {
          margin: 0;
          font-size: 20px;
        }
        .bars {
          display: grid;
          grid-template-columns: repeat(14, minmax(0, 1fr));
          gap: 10px;
          align-items: end;
          min-height: 240px;
        }
        .bar-column {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .bar-column strong {
          font-size: 12px;
          color: #4b647f;
        }
        .bar-track {
          width: 100%;
          height: 180px;
          display: flex;
          align-items: end;
          background: linear-gradient(180deg, #eff6ff, #f7fbff);
          border-radius: 16px;
          overflow: hidden;
        }
        .bar-fill {
          width: 100%;
          background: linear-gradient(180deg, #74b2ff, #6ed0b6);
          border-radius: 16px 16px 0 0;
          min-height: 6px;
        }
        .bar-column span {
          font-size: 11px;
        }
        .split-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-bottom: 18px;
        }
        .split-stats div {
          padding: 16px;
          background: linear-gradient(180deg, #f7fbff, #f1f8ff);
          border-radius: 16px;
          text-align: center;
          border: 1px solid #e0ebf5;
        }
        .split-stats strong {
          display: block;
          font-size: 28px;
          color: #16345d;
        }
        .split-stats p {
          margin: 6px 0 0;
          color: #5a708a;
        }
        .agent-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .agent-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          background: linear-gradient(135deg, #f7fbff, #f2f9f4);
          border-radius: 14px;
          border: 1px solid #e0ebf5;
        }
        .phase-two-box {
          display: grid;
          gap: 12px;
        }
        .phase-two-box p {
          padding: 14px 16px;
          border-radius: 14px;
          background: linear-gradient(135deg, #eff5ff, #f4fbf7);
        }
        .insights-layout {
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 20px;
        }
        .prompt-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .prompt-button {
          text-align: left;
          display: grid;
          grid-template-columns: 38px 1fr;
          gap: 12px;
          align-items: start;
          padding: 16px;
          border-radius: 16px;
          border: 1px solid #d9e5f1;
          background: linear-gradient(180deg, #ffffff, #f8fbff);
          color: #16345d;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(38, 72, 111, 0.06);
        }
        .prompt-button.active,
        .prompt-button:hover {
          background: linear-gradient(135deg, #16345d, #24568a);
          color: white;
        }
        .prompt-index {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          border-radius: 12px;
          background: rgba(111, 177, 255, 0.18);
          font-weight: 800;
        }
        .chat-shell {
          background:
            radial-gradient(circle at top right, rgba(111, 177, 255, 0.14), transparent 30%),
            linear-gradient(180deg, #f5f9ff, #ffffff);
          border: 1px solid #d9e5f1;
          border-radius: 24px;
          padding: 22px;
          min-height: 460px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 18px 36px rgba(46, 84, 126, 0.08);
        }
        .insights-panel .prompt-button {
          background: linear-gradient(180deg, #fbfcff, #f2f7ff);
        }
        .insights-panel .chat-shell {
          border-color: #cfdcf0;
          box-shadow: 0 24px 46px rgba(46, 84, 126, 0.12);
        }
        .chat-shell-header {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          padding-bottom: 14px;
          border-bottom: 1px solid #e2ebf4;
        }
        .chat-shell-header strong {
          display: block;
          color: #17385d;
          margin-bottom: 4px;
        }
        .chat-shell-header span {
          color: #6d8095;
          font-size: 13px;
        }
        .live-dot {
          padding: 8px 12px;
          border-radius: 999px;
          background: #e9f7ef;
          color: #20724d;
          font-weight: 700;
        }
        .chat-message {
          max-width: 78%;
          padding: 16px 18px;
          border-radius: 20px;
        }
        .chat-message.user {
          align-self: flex-end;
          background: #16345d;
          color: white;
          border-bottom-right-radius: 6px;
        }
        .chat-message.assistant {
          align-self: flex-start;
          background: #edf6f1;
          color: #173428;
          border-bottom-left-radius: 6px;
        }
        .chat-role {
          display: block;
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .chat-message p {
          margin: 0;
          line-height: 1.6;
        }
        .chat-footer {
          display: flex;
          gap: 12px;
          margin-top: auto;
        }
        .chat-footer input {
          flex: 1;
          background: white;
        }
        .chat-footer button {
          border: none;
          border-radius: 12px;
          padding: 0 18px;
          background: linear-gradient(135deg, #b8cadf, #c9d9e8);
          color: white;
        }
        @media (max-width: 1100px) {
          .workspace {
            grid-template-columns: 1fr;
          }
          .sidebar {
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }
          nav {
            flex-direction: row;
            flex-wrap: wrap;
          }
          .metrics-grid,
          .dashboard-grid,
          .insights-layout,
          .summary-strip,
          .filters-grid {
            grid-template-columns: 1fr;
          }
          .search-field {
            grid-column: span 1;
          }
        }
        @media (max-width: 720px) {
          .content {
            padding: 16px;
          }
          .panel {
            padding: 20px;
            border-radius: 20px;
          }
          .panel-header {
            flex-direction: column;
          }
          .filters-heading {
            flex-direction: column;
          }
          .panel-header h1 {
            font-size: 28px;
          }
          .bars {
            gap: 6px;
          }
          .bar-column span {
            writing-mode: vertical-rl;
            transform: rotate(180deg);
          }
          .chat-message {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
*/
