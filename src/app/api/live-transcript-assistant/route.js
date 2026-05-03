import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  MICROSOFT_GRAPH_SESSION_COOKIE,
  buildAvailabilityAnswerForQuestion,
  buildCookieOptions,
  createCalendarEvent,
  decodeMicrosoftSessionCookie,
  encodeMicrosoftSessionCookie,
  extractAvailabilityDurationMinutes,
  extractAvailabilitySearchOptions,
  findNearestAvailability,
  hasMicrosoftGraphConfig,
  looksLikeCalendarEventCreationRequest,
  looksLikeCalendarAvailabilityQuestion,
  refreshMicrosoftAccessToken,
} from "@/lib/microsoftGraph";

export const dynamic = "force-dynamic";

const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
const DEFAULT_TIMEZONE = "America/Chicago";

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasConfiguredOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== "replace_me");
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

function normalizeFilename(value, extension) {
  const stem = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "voiceiq-download";

  return `${stem}.${extension}`;
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toIcsDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function buildIcsAttachment(event) {
  const title = normalizeText(event?.title);
  const startAt = normalizeText(event?.startAt);
  const endAt = normalizeText(event?.endAt);

  if (!title || !startAt || !endAt) {
    return null;
  }

  const dtStart = toIcsDateTime(startAt);
  const dtEnd = toIcsDateTime(endAt);
  const dtStamp = toIcsDateTime(new Date().toISOString());

  if (!dtStart || !dtEnd || !dtStamp) {
    return null;
  }

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@tcevoiceiq.local`;
  const description = escapeIcsText(event?.description || "");
  const location = escapeIcsText(event?.location || "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TCE VoiceIQ//Live Transcript Assistant//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    description ? `DESCRIPTION:${description}` : null,
    location ? `LOCATION:${location}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return {
    filename: normalizeFilename(title, "ics"),
    mimeType: "text/calendar;charset=utf-8",
    base64: Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8").toString("base64"),
    label: normalizeText(event?.label) || "Download calendar invite",
  };
}

function normalizeCalendarEvent(event) {
  const title = normalizeText(event?.title);
  const startAt = normalizeText(event?.startAt);
  const endAt = normalizeText(event?.endAt);

  if (!title || !startAt || !endAt) {
    return null;
  }

  return {
    title,
    description: normalizeText(event?.description),
    startAt,
    endAt,
    location: normalizeText(event?.location),
    attendees: Array.isArray(event?.attendees)
      ? event.attendees
          .map((attendee) => ({
            name: normalizeText(attendee?.name),
            email: normalizeText(attendee?.email),
          }))
          .filter((attendee) => attendee.email)
      : [],
  };
}

async function generateAssistantReply({ question, transcript, history }) {
  const transcriptContext = transcript
    .map((turn, index) => {
      const speaker = normalizeText(turn?.speakerLabel || "UNKNOWN");
      const text = normalizeText(turn?.transcript || turn?.text || "");
      return text ? `${index + 1}. [${speaker}] ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");

  const recentHistory = history
    .slice(-8)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: normalizeText(message?.content),
    }))
    .filter((message) => message.content)
    .map((message) => ({
      role: message.role,
      content: [
        {
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.content,
        },
      ],
    }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        ...recentHistory,
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Current date/time: ${new Date().toISOString()}\n` +
                `Preferred local timezone: ${DEFAULT_TIMEZONE}\n\n` +
                `Current live call transcript:\n${transcriptContext || "No live transcript yet."}\n\n` +
                `Operator question: ${question}`,
            },
          ],
        },
      ],
      instructions:
        "You are VoiceIQ Assistant, a real-time telecom and customer support copilot for a live phone agent. " +
        "Use only the provided live transcript and recent chat history. Do not invent facts that are not grounded in the transcript. " +
        "If the transcript does not yet contain enough information, say so clearly and suggest the next best question or action the agent can take. " +
        "Keep responses concise, practical, and immediately usable during a live call. " +
        "When returning calendarEvents, describe the event details but do not claim the event has been created; the server will create it after your response is parsed. " +
        "If the operator explicitly asks for a downloadable calendar invite, ICS file, meeting invite, or appointment file, " +
        "and the transcript contains enough detail for a specific event title plus start and end time, you may return one ICS attachment. " +
        "If the operator explicitly asks to create, book, schedule, or add an Outlook calendar event, return one calendarEvents item when the transcript, recent chat history, or question contains a specific title plus start and end time. " +
        "When recent chat history contains a Structured availability slot and the operator asks to schedule this/that slot, use that exact slot for startAt and endAt. " +
        `Use ${DEFAULT_TIMEZONE} local wall-clock times for calendarEvents, and make startAt/endAt match the exact local time stated in your answer. ` +
        "For example, if you say 10:00 AM CDT, return 10:00 AM Central time, not the UTC conversion as the local hour. " +
        "If required event details are missing, do not create an attachment or calendar event.",
      text: {
        format: {
          type: "json_schema",
          name: "voiceiq_live_transcript_assistant",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              answer: { type: "string" },
              attachments: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    kind: {
                      type: "string",
                      enum: ["ics"],
                    },
                    label: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    startAt: { type: "string" },
                    endAt: { type: "string" },
                    location: { type: "string" },
                  },
                  required: [
                    "kind",
                    "label",
                    "title",
                    "description",
                    "startAt",
                    "endAt",
                    "location",
                  ],
                },
              },
              calendarEvents: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    startAt: { type: "string" },
                    endAt: { type: "string" },
                    location: { type: "string" },
                    attendees: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          name: { type: "string" },
                          email: { type: "string" },
                        },
                        required: ["name", "email"],
                      },
                    },
                  },
                  required: [
                    "title",
                    "description",
                    "startAt",
                    "endAt",
                    "location",
                    "attendees",
                  ],
                },
              },
            },
            required: ["answer", "attachments", "calendarEvents"],
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
      // Keep fallback
    }
    throw new Error(details);
  }

  const payload = await response.json();
  const text = extractResponseText(payload);
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  const parsed = JSON.parse(text);
  const attachments = Array.isArray(parsed.attachments)
    ? parsed.attachments
        .map((attachment) => {
          if (attachment?.kind !== "ics") {
            return null;
          }

          return buildIcsAttachment(attachment);
        })
        .filter(Boolean)
    : [];
  const calendarEvents = Array.isArray(parsed.calendarEvents)
    ? parsed.calendarEvents.map(normalizeCalendarEvent).filter(Boolean)
    : [];

  return {
    answer: parsed.answer || "No answer returned.",
    attachments,
    calendarEvents,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = normalizeText(body?.question);
    const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
    const history = Array.isArray(body?.history) ? body.history : [];

    if (!question) {
      return NextResponse.json(
        { error: "Question is required." },
        { status: 400 }
      );
    }

    if (looksLikeCalendarAvailabilityQuestion(question)) {
      if (!hasMicrosoftGraphConfig()) {
        return NextResponse.json(
          {
            answer:
              "Microsoft Outlook availability is not configured on the server yet. Add the Microsoft Graph environment values first.",
            attachments: [],
          },
          { status: 200 }
        );
      }

      const cookieStore = cookies();
      const session = decodeMicrosoftSessionCookie(
        cookieStore.get(MICROSOFT_GRAPH_SESSION_COOKIE)?.value
      );

      if (!session?.refreshToken) {
        return NextResponse.json(
          {
            answer:
              "Your Microsoft Outlook calendar is not connected in this browser yet. Open My Profile, go to Integrations, and connect Outlook first.",
            attachments: [],
          },
          { status: 200 }
        );
      }

      const durationMinutes = extractAvailabilityDurationMinutes(question);
      const searchOptions = extractAvailabilitySearchOptions(question, {
        timeZone: DEFAULT_TIMEZONE,
      });
      const refreshed = await refreshMicrosoftAccessToken(session);
      const slot = await findNearestAvailability(refreshed.accessToken, {
        durationMinutes,
        scheduleAddress: session?.account?.email || "",
        ...searchOptions,
      });

      const response = NextResponse.json(
        {
          answer: buildAvailabilityAnswerForQuestion(slot, durationMinutes, searchOptions),
          attachments: [],
          availabilitySlot: slot
            ? {
                startAt: slot.startAt,
                endAt: slot.endAt,
                label: slot.label,
                timeZone: slot.timeZone,
                durationMinutes: slot.durationMinutes,
              }
            : null,
        },
        { status: 200 }
      );

      response.cookies.set(
        MICROSOFT_GRAPH_SESSION_COOKIE,
        encodeMicrosoftSessionCookie(refreshed.session),
        buildCookieOptions()
      );

      return response;
    }

    if (!hasConfiguredOpenAI()) {
      return NextResponse.json(
        {
          answer:
            "OpenAI is not configured on the server yet. Add a valid OPENAI_API_KEY in .env and try again.",
          attachments: [],
        },
        { status: 200 }
      );
    }

    const reply = await generateAssistantReply({
      question,
      transcript,
      history,
    });

    if (!looksLikeCalendarEventCreationRequest(question) || reply.calendarEvents.length === 0) {
      return NextResponse.json(
        {
          answer: reply.answer,
          attachments: reply.attachments,
        },
        { status: 200 }
      );
    }

    if (!hasMicrosoftGraphConfig()) {
      return NextResponse.json(
        {
          answer:
            `${reply.answer}\n\nI found the event details, but Microsoft Outlook event creation is not configured on the server yet.`,
          attachments: reply.attachments,
        },
        { status: 200 }
      );
    }

    const cookieStore = cookies();
    const session = decodeMicrosoftSessionCookie(
      cookieStore.get(MICROSOFT_GRAPH_SESSION_COOKIE)?.value
    );

    if (!session?.refreshToken) {
      return NextResponse.json(
        {
          answer:
            `${reply.answer}\n\nI found the event details, but Outlook is not connected in this browser yet. Open My Profile, go to Integrations, and connect Outlook first.`,
          attachments: reply.attachments,
        },
        { status: 200 }
      );
    }

    const refreshed = await refreshMicrosoftAccessToken(session);
    const createdEvents = [];

    for (const calendarEvent of reply.calendarEvents.slice(0, 1)) {
      const createdEvent = await createCalendarEvent(refreshed.accessToken, calendarEvent, {
        localTimeZone: DEFAULT_TIMEZONE,
      });
      createdEvents.push({
        title: createdEvent?.subject || calendarEvent.title,
        webLink: createdEvent?.webLink || "",
      });
    }

    const created = createdEvents[0];
    const response = NextResponse.json(
      {
        answer:
          `${reply.answer}\n\nCreated the Outlook calendar event${created?.title ? `: ${created.title}` : "."}${created?.webLink ? `\n${created.webLink}` : ""}`,
        attachments: reply.attachments,
      },
      { status: 200 }
    );

    response.cookies.set(
      MICROSOFT_GRAPH_SESSION_COOKIE,
      encodeMicrosoftSessionCookie(refreshed.session),
      buildCookieOptions()
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
