const DATE_FIELDS = [
  "StartTime",
  "EndTime",
  "CreatedAt",
  "UpdatedAt",
  "startedAt",
  "startTime",
  "callStartTime",
  "CallStartTime",
  "timestamp",
  "createdAt",
  "date",
  "callDate",
  "datetime",
  "eventTime",
];

const DURATION_FIELDS = [
  "Duration",
  "durationSeconds",
  "duration",
  "callDuration",
  "billsec",
  "talkTime",
  "talkDuration",
];

const ID_FIELDS = [
  "TranscriptId",
  "id",
  "callId",
  "callID",
  "CallId",
  "CallID",
  "sessionId",
  "sessionID",
  "uuid",
];

const DIRECTION_FIELDS = ["direction", "callDirection", "Direction", "type"];
const AGENT_FIELDS = ["LastCaller", "agent", "agentName", "owner", "user", "username", "extensionOwner"];
const AGENT_EMAIL_FIELDS = ["LastCallerEmail"];
const FROM_FIELDS = ["from", "fromNumber", "ani", "caller", "source"];
const TO_FIELDS = ["to", "toNumber", "dnis", "destination", "callee"];
const CUSTOMER_FIELDS = ["GHContact", "customer", "customerName", "contactName", "leadName", "name"];
const STATUS_FIELDS = ["TranscriptStatus", "status", "callStatus", "result", "state"];
const DISPOSITION_FIELDS = ["PostCallOption", "disposition", "callDisposition", "outcome", "hangupCause"];
const RECORDING_FIELDS = ["CallRecordingId", "recordingUrl", "recordingURL", "recording", "RecordingUrl"];
const CONTACT_ID_FIELDS = ["ContactId"];
const ENDED_AT_FIELDS = ["EndTime"];
const NOTES_FIELDS = ["PostCallNotes"];
const AI_ANALYSIS_FIELDS = ["AIAnalysis", "aiAnalysis"];
const TRANSCRIPT_FIELDS = ["CallTranscript", "TranscriptContent", "callTranscript"];
const SENTIMENT_FIELDS = ["sentimentScore", "sentiment", "qaSentiment"];
const ENGAGEMENT_FIELDS = ["engagementRate", "agentEngagementRate", "engagement"];

function pickFirstValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function coerceNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const durationMatch = value.match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
    if (durationMatch && durationMatch[0].trim()) {
      const hours = Number(durationMatch[1] || 0);
      const minutes = Number(durationMatch[2] || 0);
      const seconds = Number(durationMatch[3] || 0);
      const durationSeconds = hours * 3600 + minutes * 60 + seconds;
      if (durationSeconds > 0 || /0s|0m|0h/.test(value)) {
        return durationSeconds;
      }
    }

    const sanitized = value.replace(/[^\d.-]/g, "");
    const parsed = Number(sanitized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function coerceDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const maybeMs = value > 1000000000000 ? value : value * 1000;
    const date = new Date(maybeMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return coerceDate(numeric);
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatDuration(durationSeconds) {
  const duration = Math.max(0, Math.round(durationSeconds || 0));
  const hours = Math.floor(duration / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const seconds = duration % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toPreviewText(value, limit = 140) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "-";
  }

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function normalizeCallLog(item, index = 0) {
  const startedAt = coerceDate(pickFirstValue(item, DATE_FIELDS));
  const endedAt = coerceDate(pickFirstValue(item, ENDED_AT_FIELDS));
  const durationSeconds = coerceNumber(pickFirstValue(item, DURATION_FIELDS)) || 0;
  const sentiment = coerceNumber(pickFirstValue(item, SENTIMENT_FIELDS));
  const engagementRate = coerceNumber(pickFirstValue(item, ENGAGEMENT_FIELDS));
  const status = String(pickFirstValue(item, STATUS_FIELDS) || "Unknown");
  const disposition = String(pickFirstValue(item, DISPOSITION_FIELDS) || "-");
  const notes = String(pickFirstValue(item, NOTES_FIELDS) || "");
  const aiAnalysis = String(pickFirstValue(item, AI_ANALYSIS_FIELDS) || "");
  const callTranscript = String(pickFirstValue(item, TRANSCRIPT_FIELDS) || "");

  return {
    id: String(pickFirstValue(item, ID_FIELDS) || `call-${index + 1}`),
    startedAt: startedAt ? startedAt.toISOString() : null,
    startedAtEpoch: startedAt ? startedAt.getTime() : 0,
    endedAt: endedAt ? endedAt.toISOString() : null,
    endedAtEpoch: endedAt ? endedAt.getTime() : 0,
    direction: String(pickFirstValue(item, DIRECTION_FIELDS) || "Unknown"),
    agent: String(pickFirstValue(item, AGENT_FIELDS) || "Unassigned"),
    agentEmail: String(pickFirstValue(item, AGENT_EMAIL_FIELDS) || "-"),
    from: String(pickFirstValue(item, FROM_FIELDS) || "-"),
    to: String(pickFirstValue(item, TO_FIELDS) || "-"),
    customer: String(pickFirstValue(item, CUSTOMER_FIELDS) || "-"),
    contactId: String(pickFirstValue(item, CONTACT_ID_FIELDS) || "-"),
    durationSeconds,
    durationLabel: formatDuration(durationSeconds),
    status,
    disposition,
    notes,
    aiAnalysis,
    aiAnalysisPreview: toPreviewText(aiAnalysis, 150),
    callTranscript,
    callTranscriptPreview: toPreviewText(callTranscript, 120),
    recordingUrl: pickFirstValue(item, RECORDING_FIELDS),
    sentiment,
    engagementRate,
  };
}

export function buildCallLogMetrics(logs) {
  const now = Date.now();
  const last30Days = now - 30 * 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const answeredStatuses = new Set(["answered", "completed", "connected"]);
  const answered = logs.filter((log) => {
    const status = String(log.status || "").toLowerCase();
    const disposition = String(log.disposition || "").toLowerCase();
    return answeredStatuses.has(status) || answeredStatuses.has(disposition) || log.durationSeconds > 0;
  });

  const inbound = logs.filter((log) => String(log.direction || "").toLowerCase().includes("in")).length;
  const outbound = logs.filter((log) => String(log.direction || "").toLowerCase().includes("out")).length;
  const totalDurationSeconds = logs.reduce((sum, log) => sum + (log.durationSeconds || 0), 0);
  const callsToday = logs.filter((log) => log.startedAtEpoch >= today.getTime()).length;
  const callsLast30Days = logs.filter((log) => log.startedAtEpoch >= last30Days).length;

  const engagementValues = logs
    .map((log) => log.engagementRate)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  const sentimentValues = logs
    .map((log) => log.sentiment)
    .filter((value) => typeof value === "number" && Number.isFinite(value));

  return {
    totalCalls: logs.length,
    answeredCalls: answered.length,
    missedCalls: Math.max(0, logs.length - answered.length),
    inboundCalls: inbound,
    outboundCalls: outbound,
    totalDurationSeconds,
    avgDurationSeconds: logs.length ? totalDurationSeconds / logs.length : 0,
    callsToday,
    callsLast30Days,
    connectedRate: logs.length ? (answered.length / logs.length) * 100 : 0,
    avgEngagementRate: engagementValues.length
      ? engagementValues.reduce((sum, value) => sum + value, 0) / engagementValues.length
      : null,
    avgSentiment: sentimentValues.length
      ? sentimentValues.reduce((sum, value) => sum + value, 0) / sentimentValues.length
      : null,
  };
}

export function buildDailyVolume(logs, days = 14) {
  const buckets = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  logs.forEach((log) => {
    if (!log.startedAt) {
      return;
    }

    const key = new Date(log.startedAt).toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  });

  return Array.from(buckets.entries()).map(([date, value]) => ({
    date,
    label: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value,
  }));
}

export function buildAgentBreakdown(logs, limit = 5) {
  const counts = logs.reduce((accumulator, log) => {
    const key = log.agent || "Unassigned";
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts)
    .map(([agent, calls]) => ({ agent, calls }))
    .sort((left, right) => right.calls - left.calls)
    .slice(0, limit);
}
