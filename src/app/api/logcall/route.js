import crypto from "crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  createDocumentClient,
  hasConfiguredAws,
  missingAwsResponse,
} from "@/lib/server/dynamoDb";
import {
  cleanMarkdownAnalysis,
  createPostCallAnalysis,
  hasConfiguredOpenAI,
  normalizeText,
} from "@/lib/server/openAiResponses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CALL_LOGS_TABLE = process.env.CALL_LOGS_TABLE || "CallLogsV2";
const SENDGRID_MAIL_URL = "https://api.sendgrid.com/v3/mail/send";

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function formatTranscriptTurns(turns) {
  if (!Array.isArray(turns)) {
    return normalizeText(turns);
  }

  return turns
    .slice()
    .sort((left, right) => Number(left?.turnOrder ?? left?.turn_order ?? 0) - Number(right?.turnOrder ?? right?.turn_order ?? 0))
    .map((turn) => {
      const speaker = normalizeText(turn?.speakerLabel || turn?.speaker_label || "Speaker");
      const text = normalizeText(turn?.transcript || turn?.text);
      return text ? `${speaker}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTranscriptHtml(turns, transcriptText) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return `<div style="font-family:Roboto, Arial, sans-serif; line-height:1.5;">${escapeHtml(transcriptText).replace(/\n/g, "<br>")}</div>`;
  }

  return turns
    .slice()
    .sort((left, right) => Number(left?.turnOrder ?? left?.turn_order ?? 0) - Number(right?.turnOrder ?? right?.turn_order ?? 0))
    .map((turn) => {
      const speaker = escapeHtml(turn?.speakerLabel || turn?.speaker_label || "Speaker");
      const text = escapeHtml(turn?.transcript || turn?.text);
      return `<div style="margin-bottom:8px; font-family:Roboto, Arial, sans-serif; line-height:1.5;"><b>${speaker}:</b> ${text}</div>`;
    })
    .join("");
}

function hasConfiguredSendGrid() {
  return Boolean(
    process.env.SENDGRID_API_KEY &&
      process.env.SENDGRID_API_KEY !== "replace_me" &&
      process.env.SENDGRID_FROM_EMAIL &&
      process.env.SENDGRID_FROM_EMAIL !== "replace_me"
  );
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function buildPostCallEmailHtml({ aiAnalysis, transcriptHtml, item }) {
  return `
    <div style="font-family:Roboto,Arial,sans-serif;color:#172033;line-height:1.5;">
      <h1 style="font-size:22px;margin:0 0 12px;">Post-Call Analysis</h1>
      <p style="margin:0 0 16px;color:#526070;">
        Call completed ${textToHtml(item.EndTime || item.LastCallDate || "")}
        ${item.Duration ? `, duration ${textToHtml(item.Duration)}` : ""}.
      </p>
      <h2 style="font-size:16px;margin:18px 0 8px;">AI Analysis</h2>
      <div style="padding:12px;border:1px solid #d8dee9;border-radius:8px;background:#f8fafc;">
        ${textToHtml(aiAnalysis || "No AI analysis was generated.")}
      </div>
      <h2 style="font-size:16px;margin:18px 0 8px;">Transcript</h2>
      <div style="padding:12px;border:1px solid #d8dee9;border-radius:8px;background:#ffffff;">
        ${transcriptHtml || "No transcript was captured."}
      </div>
    </div>
  `;
}

async function sendPostCallEmail({ to, aiAnalysis, transcriptHtml, item }) {
  if (!to) {
    return "missing_recipient";
  }

  if (!hasConfiguredSendGrid()) {
    return "not_configured";
  }

  const response = await fetch(SENDGRID_MAIL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: to }],
        },
      ],
      from: {
        email: process.env.SENDGRID_FROM_EMAIL,
        name: "TCE VoiceIQ",
      },
      subject: "Post-Call Analysis",
      content: [
        {
          type: "text/html",
          value: buildPostCallEmailHtml({
            aiAnalysis,
            transcriptHtml,
            item,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    let details = "SendGrid request failed.";
    try {
      const payload = await response.json();
      details = payload?.errors?.[0]?.message || details;
    } catch {
      // Keep fallback.
    }

    throw new Error(details);
  }

  return "sent";
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  try {
    const body = await request.json();
    const transcriptTurns = Array.isArray(body?.liveTranscript)
      ? body.liveTranscript
      : Array.isArray(body?.transcript)
        ? body.transcript
        : [];
    const transcriptText =
      normalizeText(body?.transcriptText || body?.CallTranscript) ||
      formatTranscriptTurns(transcriptTurns);
    const postCallEnabled = toBoolean(body?.postCallEnabled ?? body?.["post-call"]);
    const now = new Date().toISOString();
    const transcriptId = body?.transcriptId || `live-${Date.now()}-${crypto.randomUUID()}`;
    const recordingSessionId = body?.recordingSessionId || transcriptId;
    const callerName = [body?.firstName || body?.ghUserFirstName, body?.lastName || body?.ghUserLastName]
      .map(normalizeText)
      .filter(Boolean)
      .join(" ");

    let aiAnalysis = "";
    let analysisStatus = "skipped";
    if (postCallEnabled) {
      if (!transcriptText) {
        aiAnalysis = "Post-call AI analysis was enabled, but no live transcript text was captured.";
        analysisStatus = "no_transcript";
      } else if (!hasConfiguredOpenAI()) {
        aiAnalysis = "Post-call AI analysis is not configured because OPENAI_API_KEY is missing.";
        analysisStatus = "not_configured";
      } else {
        aiAnalysis = cleanMarkdownAnalysis(await createPostCallAnalysis({
          transcriptText,
          callContext: {
            startTime: body?.starttime || body?.startTime || "",
            endTime: body?.endtime || body?.endTime || "",
            duration: body?.duration || "",
            phoneNumber: body?.phoneNumber || "",
            callerName,
            callerEmail: body?.email || body?.ghUserEmail || "",
          },
        }));
        analysisStatus = "completed";
      }
    }

    const transcriptHtml = buildTranscriptHtml(transcriptTurns, transcriptText);
    const emailRecipient = body?.email || body?.ghUserEmail || "";
    let emailStatus = "skipped";
    let emailError = "";

    const item = {
      TranscriptId: String(transcriptId),
      ContactId: "NO_CONTACT",
      GHContact: "No Contact Matched",
      StartTime: body?.starttime || body?.startTime || now,
      EndTime: body?.endtime || body?.endTime || now,
      Duration: body?.duration || "",
      LastCaller: callerName || "Unknown",
      LastCallerEmail: body?.email || body?.ghUserEmail || "",
      LastCallDate: now,
      CallRecordingId: body?.recordingUrl || "",
      RecordingSessionId: recordingSessionId,
      RecordingStorage: recordingSessionId ? "local-browser-s3" : "",
      RecordingFormat: recordingSessionId ? "mp3" : "",
      RecordingFinalizationStatus: body?.recordingUrl ? "completed" : recordingSessionId ? "pending" : "not_started",
      PostCallNotes: body?.postCallNotes || "",
      PostCallOption: body?.postcallOption || "",
      Context: body?.context || "",
      CreatedAt: now,
      UpdatedAt: now,
      TranscriptStatus: transcriptText ? "completed" : "no_transcript",
      PostCallAIStatus: analysisStatus,
      PostCallEmailStatus: emailStatus,
      CallTranscript: transcriptText,
      CallTranscriptHtml: transcriptHtml,
      AIAnalysis: aiAnalysis,
      direction: body?.direction || "outbound",
      to: body?.phoneNumber || "",
      from: body?.from || "",
    };

    if (postCallEnabled) {
      try {
        emailStatus = await sendPostCallEmail({
          to: emailRecipient,
          aiAnalysis,
          transcriptHtml,
          item,
        });
      } catch (error) {
        emailStatus = "failed";
        emailError = error instanceof Error ? error.message : "Unable to send post-call email.";
        console.error("Post-call email failed:", error);
      }

      item.PostCallEmailStatus = emailStatus;
      if (emailError) {
        item.PostCallEmailError = emailError;
      }
    }

    const client = createDocumentClient();
    await client.send(
      new PutCommand({
        TableName: CALL_LOGS_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(TranscriptId)",
      })
    );

    return NextResponse.json(
      {
        success: true,
        message: "Call log stored from live transcript.",
        transcriptId: item.TranscriptId,
        analysisStatus,
        emailStatus,
        emailError: emailError || null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error storing post-call log:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to store call log.",
      },
      { status: 500 }
    );
  }
}
