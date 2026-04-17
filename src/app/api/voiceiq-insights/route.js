import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  buildAgentBreakdown,
  buildCallLogMetrics,
  buildDailyVolume,
  normalizeCallLog,
} from "@/lib/callLogTransforms";

export const dynamic = "force-dynamic";

const TABLE_NAME = process.env.CALL_LOGS_TABLE || "CallLogsV2";
const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const SCAN_BATCH_SIZE = 100;
const MAX_SCAN_PASSES = 8;
const MAX_KEYWORD_SCAN_PASSES = 40;
const QUESTION_NOT_ALLOWED = "Question not allowed. Please try again.";

const PROFESSIONAL_KEYWORDS = [
  "agent",
  "analysis",
  "analytics",
  "call",
  "call center",
  "cdr",
  "coach",
  "coaching",
  "connected",
  "contact",
  "csv",
  "customer",
  "dashboard",
  "data",
  "disposition",
  "download",
  "engagement",
  "export",
  "inbound",
  "insight",
  "kpi",
  "manager",
  "metric",
  "missed",
  "outbound",
  "pdf",
  "performance",
  "presentation",
  "qa",
  "queue",
  "recording",
  "report",
  "sales",
  "sentiment",
  "service level",
  "sla",
  "staffing",
  "statistics",
  "support",
  "team",
  "transcript",
  "trend",
  "volume",
];

const DISALLOWED_PATTERNS = [
  /\b(?:joke|poem|story|song|lyrics|riddle)\b/i,
  /\b(?:birthday|anniversary|wedding|dating|relationship|romance)\b/i,
  /\b(?:recipe|cook|restaurant|vacation|travel itinerary|movie|tv show|game)\b/i,
  /\b(?:medical|diagnose|symptom|prescription|legal advice|lawsuit|tax return)\b/i,
  /\b(?:horoscope|astrology|tarot|fortune)\b/i,
  /\b(?:therapy|mental health|my feelings)\b/i,
];

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasConfiguredAws() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } = process.env;
  return (
    AWS_ACCESS_KEY_ID &&
    AWS_SECRET_ACCESS_KEY &&
    AWS_REGION &&
    AWS_ACCESS_KEY_ID !== "replace_me" &&
    AWS_SECRET_ACCESS_KEY !== "replace_me"
  );
}

function hasConfiguredOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== "replace_me");
}

function createDocumentClient() {
  const config = {
    region: process.env.AWS_REGION || "us-east-1",
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return DynamoDBDocumentClient.from(new DynamoDBClient(config));
}

function isProfessionalQuestion(question) {
  const normalized = normalizeText(question).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (DISALLOWED_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return PROFESSIONAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function detectTimeframe(question) {
  const normalized = normalizeText(question).toLowerCase();

  if (/\b(?:last 7 days|past 7 days|last week|weekly)\b/.test(normalized)) {
    return { days: 7, label: "the last 7 days" };
  }

  if (/\b(?:last 14 days|past 14 days|last two weeks|past two weeks)\b/.test(normalized)) {
    return { days: 14, label: "the last 14 days" };
  }

  if (/\b(?:last 90 days|past 90 days|last quarter|quarterly)\b/.test(normalized)) {
    return { days: 90, label: "the last 90 days" };
  }

  if (/\b(?:today)\b/.test(normalized)) {
    return { days: 1, label: "today" };
  }

  return { days: 30, label: "the last 30 days" };
}

function buildStatusBreakdown(logs, limit = 5) {
  return Object.entries(
    logs.reduce((accumulator, log) => {
      const key = log.status || "Unknown";
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {})
  )
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function detectRequestedReportType(question) {
  const normalized = normalizeText(question).toLowerCase();

  if (/\b(?:csv|spreadsheet)\b/.test(normalized)) {
    return "csv";
  }

  if (/\b(?:json)\b/.test(normalized)) {
    return "json";
  }

  if (/\b(?:pdf|presentation|deck|slides|report|download|export|file)\b/.test(normalized)) {
    return "pdf";
  }

  return "none";
}

function detectTranscriptKeywordQuery(question) {
  const normalized = normalizeText(question);
  const quotedMatch =
    normalized.match(/\bkeyword\b(?:\s+in\s+transcripts?)?\s*["']([^"']+)["']/i) ||
    normalized.match(/\btranscripts?\b.*?["']([^"']+)["']/i);

  if (quotedMatch?.[1]) {
    return normalizeText(quotedMatch[1]).toLowerCase();
  }

  const containsMatch =
    normalized.match(/\btranscripts?\b.*\bcontaining\b\s+([a-z0-9_-]+)/i) ||
    normalized.match(/\bfind\b.*\bin\s+transcripts?\s+([a-z0-9_-]+)/i);

  if (containsMatch?.[1]) {
    return normalizeText(containsMatch[1]).toLowerCase();
  }

  return "";
}

function calculateKeywordScore(log, tokens) {
  if (!tokens.length) {
    return 0;
  }

  const haystack = [
    log.agent,
    log.customer,
    log.direction,
    log.status,
    log.disposition,
    log.aiAnalysis,
    log.callTranscript,
  ]
    .join(" ")
    .toLowerCase();

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
}

async function fetchRelevantLogs(question) {
  if (!hasConfiguredAws()) {
    return {
      logs: [],
      relevantLogs: [],
      timeframe: detectTimeframe(question),
      warning: "AWS credentials are not configured. Set valid AWS env values to load CallLogsV2.",
    };
  }

  const timeframe = detectTimeframe(question);
  const transcriptKeyword = detectTranscriptKeywordQuery(question);
  const threshold = transcriptKeyword ? null : Date.now() - timeframe.days * 24 * 60 * 60 * 1000;
  const client = createDocumentClient();
  const scopedLogs = [];
  let passes = 0;
  let exclusiveStartKey;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: SCAN_BATCH_SIZE,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    if (response.Items?.length) {
      const normalized = response.Items
        .map((item, index) => normalizeCallLog(item, index))
        .filter((log) => (threshold === null ? true : log.startedAtEpoch >= threshold));
      scopedLogs.push(...normalized);
    }

    exclusiveStartKey = response.LastEvaluatedKey;
    passes += 1;
  } while (
    exclusiveStartKey &&
    passes < (transcriptKeyword ? MAX_KEYWORD_SCAN_PASSES : MAX_SCAN_PASSES) &&
    scopedLogs.length < (transcriptKeyword ? 2000 : 300)
  );

  const logs = scopedLogs
    .sort((left, right) => right.startedAtEpoch - left.startedAtEpoch)
    .slice(0, transcriptKeyword ? 2000 : 250);

  const tokens = normalizeText(question)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .slice(0, 12);

  const rankedLogs = transcriptKeyword
    ? logs
        .filter((log) => normalizeText(log.callTranscript).toLowerCase().includes(transcriptKeyword))
        .map((log) => ({ log, score: 1000 }))
    : logs
        .map((log) => ({ log, score: calculateKeywordScore(log, tokens) }))
        .sort((left, right) => right.score - left.score || right.log.startedAtEpoch - left.log.startedAtEpoch);

  const relevantLogs = rankedLogs
    .slice(0, 12)
    .map(({ log }) => ({
      id: log.id,
      startedAt: log.startedAt,
      agent: log.agent,
      customer: log.customer,
      direction: log.direction,
      status: log.status,
      disposition: log.disposition,
      durationSeconds: log.durationSeconds,
      aiAnalysis: normalizeText(log.aiAnalysis).slice(0, 220),
      callTranscript: normalizeText(log.callTranscript).slice(0, 220),
    }));

  return {
    logs,
    relevantLogs,
    timeframe,
    transcriptKeyword,
    warning: logs.length ? null : `No call logs were found for ${timeframe.label}.`,
  };
}

function buildAnalyticsContext(logs, timeframe) {
  return {
    scope: timeframe.label,
    generatedAt: new Date().toISOString(),
    recordCount: logs.length,
    metrics: buildCallLogMetrics(logs),
    dailyVolume: buildDailyVolume(logs, Math.min(timeframe.days, 14)),
    topAgents: buildAgentBreakdown(logs, 5),
    statusBreakdown: buildStatusBreakdown(logs, 5),
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const parts = [];
  for (const item of payload?.output || []) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

async function generateAssistantReply({ question, history, analytics, relevantLogs }) {
  if (!hasConfiguredOpenAI()) {
    return {
      answer: "OpenAI is not configured on the server yet. Add a valid OPENAI_API_KEY in .env and try again.",
      bullets: [],
      reportType: detectRequestedReportType(question),
      reportTitle: "VoiceIQ Report",
    };
  }

  const context = {
    analytics,
    relevantLogs,
    recentConversation: history.slice(-6),
    userQuestion: question,
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: `Use only this VoiceIQ context to answer the user:\n${JSON.stringify(context)}`,
      instructions:
        "You are VoiceIQ Assistant, a call center and call data analysis specialist trained in customer support, sales, team management, QA, coaching, and operational analytics. " +
        "Answer only from the provided context. Do not invent metrics. Keep the tone professional and concise. " +
        "If the user requested a report, suggest the best matching report type. Return JSON only.",
      text: {
        format: {
          type: "json_schema",
          name: "voiceiq_response",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer: { type: "string" },
              bullets: {
                type: "array",
                items: { type: "string" },
              },
              reportType: {
                type: "string",
                enum: ["none", "pdf", "csv", "json"],
              },
              reportTitle: { type: "string" },
            },
            required: ["answer", "bullets", "reportType", "reportTitle"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    let details = "OpenAI request failed.";
    try {
      const payload = await response.json();
      details = payload?.error?.message || details;
    } catch {
      // Keep fallback message.
    }
    throw new Error(details);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(text);
  return {
    answer: parsed.answer || "No answer returned.",
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.filter(Boolean).slice(0, 5) : [],
    reportType: parsed.reportType || "none",
    reportTitle: normalizeText(parsed.reportTitle) || "VoiceIQ Report",
  };
}

function sanitizeAscii(value) {
  return normalizeText(value).replace(/[^\x20-\x7E]/g, "");
}

function wrapText(text, width = 90) {
  const words = sanitizeAscii(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) {
        lines.push(current);
      }
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function escapePdfText(value) {
  return sanitizeAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createPdfBuffer(lines) {
  const objects = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const pageId = 4;
  const contentId = 5;

  const contentLines = ["BT", "/F1 11 Tf", "48 780 Td", "14 TL"];
  lines.forEach((line, index) => {
    const escaped = escapePdfText(line);
    contentLines.push(`${index === 0 ? "" : "T* "}(${escaped}) Tj`.trim());
  });
  contentLines.push("ET");

  const contentStream = contentLines.join("\n");
  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[pageId] =
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  objects[contentId] = `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}

function buildReportRows(analytics) {
  const rows = [
    `Scope: ${analytics.scope}`,
    `Records analyzed: ${analytics.recordCount}`,
    `Total calls: ${analytics.metrics.totalCalls}`,
    `Answered calls: ${analytics.metrics.answeredCalls}`,
    `Connected rate: ${analytics.metrics.connectedRate.toFixed(1)}%`,
    `Average duration: ${Math.round(analytics.metrics.avgDurationSeconds || 0)} sec`,
    `Inbound calls: ${analytics.metrics.inboundCalls}`,
    `Outbound calls: ${analytics.metrics.outboundCalls}`,
  ];

  analytics.topAgents.forEach((item, index) => {
    rows.push(`Top agent ${index + 1}: ${item.agent} (${item.calls} calls)`);
  });

  return rows;
}

function normalizeFilename(title, extension) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "voiceiq-report"}.${extension}`;
}

function buildPdfAttachment({ reportTitle, question, answer, bullets, analytics }) {
  const lines = [
    reportTitle,
    "",
    `Generated: ${new Date().toLocaleString("en-US")}`,
    `Question: ${sanitizeAscii(question)}`,
    "",
    "Executive summary",
    ...wrapText(answer),
    "",
    "Highlights",
    ...bullets.flatMap((bullet) => wrapText(`- ${bullet}`)),
    "",
    "Metrics",
    ...buildReportRows(analytics).flatMap((line) => wrapText(line)),
  ];

  return {
    filename: normalizeFilename(reportTitle, "pdf"),
    mimeType: "application/pdf",
    base64: createPdfBuffer(lines).toString("base64"),
    label: "Download PDF report",
  };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildCsvAttachment({ reportTitle, logs }) {
  const headers = [
    "Call ID",
    "Started At",
    "Agent",
    "Customer",
    "Direction",
    "Status",
    "Disposition",
    "Duration Seconds",
  ];

  const rows = logs.slice(0, 250).map((log) => [
    log.id,
    log.startedAt || "",
    log.agent,
    log.customer,
    log.direction,
    log.status,
    log.disposition,
    log.durationSeconds,
  ]);

  const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n");
  return {
    filename: normalizeFilename(reportTitle, "csv"),
    mimeType: "text/csv;charset=utf-8",
    base64: Buffer.from(csv, "utf8").toString("base64"),
    label: "Download CSV export",
  };
}

function buildJsonAttachment({ reportTitle, question, answer, bullets, analytics, relevantLogs }) {
  const payload = {
    reportTitle,
    generatedAt: new Date().toISOString(),
    question,
    answer,
    bullets,
    analytics,
    relevantLogs,
  };

  return {
    filename: normalizeFilename(reportTitle, "json"),
    mimeType: "application/json",
    base64: Buffer.from(JSON.stringify(payload, null, 2), "utf8").toString("base64"),
    label: "Download JSON report",
  };
}

function buildAttachments({ reportType, reportTitle, question, answer, bullets, analytics, logs, relevantLogs }) {
  if (reportType === "pdf") {
    return [buildPdfAttachment({ reportTitle, question, answer, bullets, analytics })];
  }

  if (reportType === "csv") {
    return [buildCsvAttachment({ reportTitle, logs })];
  }

  if (reportType === "json") {
    return [buildJsonAttachment({ reportTitle, question, answer, bullets, analytics, relevantLogs })];
  }

  return [];
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = normalizeText(body?.question);
    const history = Array.isArray(body?.history)
      ? body.history
          .map((item) => ({
            role: item?.role === "assistant" ? "assistant" : "user",
            content: normalizeText(item?.content),
          }))
          .filter((item) => item.content)
      : [];

    if (!question) {
      return NextResponse.json({ error: "A question is required." }, { status: 400 });
    }

    if (!isProfessionalQuestion(question)) {
      return NextResponse.json({
        blocked: true,
        answer: QUESTION_NOT_ALLOWED,
        bullets: [],
        attachments: [],
      });
    }

    const { logs, relevantLogs, timeframe, transcriptKeyword, warning } = await fetchRelevantLogs(question);
    const analytics = buildAnalyticsContext(logs, timeframe);

    if (transcriptKeyword) {
      const matchCount = logs.filter((log) =>
        normalizeText(log.callTranscript).toLowerCase().includes(transcriptKeyword)
      ).length;

      const answer = matchCount
        ? `I found ${matchCount} transcript${matchCount === 1 ? "" : "s"} containing the keyword "${transcriptKeyword}".`
        : `I did not find any transcripts containing the keyword "${transcriptKeyword}" in the scanned data.`;

      const bullets = relevantLogs.slice(0, 5).map((log) => {
        const agent = log.agent || "Unknown agent";
        const customer = log.customer || "Unknown customer";
        const date = log.startedAt ? new Date(log.startedAt).toLocaleString("en-US") : "Unknown time";
        return `${date} | ${agent} | ${customer} | ${log.callTranscript}`;
      });

      return NextResponse.json({
        blocked: false,
        answer,
        bullets,
        attachments: [],
        warning,
        meta: {
          scope: transcriptKeyword ? "all scanned transcripts" : analytics.scope,
          recordCount: analytics.recordCount,
          model: "deterministic-transcript-search",
          tableName: TABLE_NAME,
          transcriptKeyword,
          matchCount,
        },
      });
    }

    const reply = await generateAssistantReply({
      question,
      history,
      analytics,
      relevantLogs,
    });

    const requestedReportType = detectRequestedReportType(question);
    const reportType = requestedReportType !== "none" ? requestedReportType : reply.reportType;
    const attachments = buildAttachments({
      reportType,
      reportTitle: reply.reportTitle,
      question,
      answer: reply.answer,
      bullets: reply.bullets,
      analytics,
      logs,
      relevantLogs,
    });

    return NextResponse.json({
      blocked: false,
      answer: reply.answer,
      bullets: reply.bullets,
      attachments,
      warning,
      meta: {
        scope: analytics.scope,
        recordCount: analytics.recordCount,
        model: OPENAI_MODEL,
        tableName: TABLE_NAME,
      },
    });
  } catch (error) {
    console.error("VoiceIQ insights request failed", error);
    return NextResponse.json(
      {
        error: "Unable to process the VoiceIQ insight request.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
