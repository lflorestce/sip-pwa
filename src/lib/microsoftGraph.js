import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export const MICROSOFT_GRAPH_SESSION_COOKIE = "voiceiq_ms_graph_session";
export const MICROSOFT_GRAPH_AUTH_COOKIE = "voiceiq_ms_graph_auth";

const DEFAULT_TENANT = "common";
const DEFAULT_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"];
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_GRAPH_EVENT_TIMEZONE = "Central Standard Time";
const DEFAULT_BUSINESS_START_HOUR = 8;
const DEFAULT_BUSINESS_END_HOUR = 18;
const MONTH_NAME_TO_NUMBER = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const WEEKDAY_NAME_TO_INDEX = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function getCookieSecret() {
  return process.env.MICROSOFT_TOKEN_COOKIE_SECRET || "";
}

function getEncryptionKey() {
  return createHash("sha256").update(getCookieSecret()).digest();
}

function encryptPayload(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${base64UrlEncode(iv)}.${base64UrlEncode(tag)}.${base64UrlEncode(encrypted)}`;
}

function decryptPayload(value) {
  if (!value) {
    return null;
  }

  const [ivPart, tagPart, dataPart] = String(value).split(".");
  if (!ivPart || !tagPart || !dataPart) {
    return null;
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), base64UrlDecode(ivPart));
    decipher.setAuthTag(base64UrlDecode(tagPart));
    const decrypted = Buffer.concat([
      decipher.update(base64UrlDecode(dataPart)),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseOffsetMinutes(value) {
  const match = String(value || "").match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);

  const offsetText = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  return parseOffsetMinutes(offsetText);
}

function zonedDateTimeToUtc({ year, month, day, hour = 0, minute = 0, timeZone }) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
}

function getTenantId() {
  return normalizeText(process.env.MICROSOFT_TENANT_ID) || DEFAULT_TENANT;
}

export function hasMicrosoftGraphConfig() {
  return Boolean(
    normalizeText(process.env.MICROSOFT_CLIENT_ID) &&
      normalizeText(getCookieSecret())
  );
}

export function getMicrosoftScopeString() {
  return normalizeText(process.env.MICROSOFT_GRAPH_SCOPES) || DEFAULT_SCOPES.join(" ");
}

export function getMicrosoftRedirectUri(request) {
  const configured = normalizeText(process.env.MICROSOFT_GRAPH_REDIRECT_URI);
  if (configured) {
    return configured;
  }

  const url = new URL(request.url);
  return `${url.origin}/api/microsoft/callback`;
}

export function buildCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function createOAuthRequestState() {
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  const state = base64UrlEncode(randomBytes(24));

  return {
    state,
    verifier,
    challenge,
    createdAt: Date.now(),
  };
}

export function encodeAuthCookie(payload) {
  return encryptPayload(payload);
}

export function decodeAuthCookie(value) {
  return decryptPayload(value);
}

export function encodeMicrosoftSessionCookie(payload) {
  return encryptPayload(payload);
}

export function decodeMicrosoftSessionCookie(value) {
  return decryptPayload(value);
}

export function buildMicrosoftAuthorizeUrl(request, authState) {
  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/authorize`
  );

  authorizeUrl.searchParams.set("client_id", process.env.MICROSOFT_CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", getMicrosoftRedirectUri(request));
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", getMicrosoftScopeString());
  authorizeUrl.searchParams.set("state", authState.state);
  authorizeUrl.searchParams.set("code_challenge", authState.challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("prompt", "select_account");

  return authorizeUrl.toString();
}

async function exchangeToken(params) {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    scope: getMicrosoftScopeString(),
    ...params,
  });

  const clientSecret = normalizeText(process.env.MICROSOFT_CLIENT_SECRET);
  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${getTenantId()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      cache: "no-store",
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload?.error_description || payload?.error || "Microsoft token exchange failed."
    );
  }

  return payload;
}

function decodeJwtPayload(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
}

export async function fetchGraphMe(accessToken) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Unable to load Microsoft account profile.");
  }

  return payload;
}

export async function exchangeAuthorizationCodeForSession({ code, verifier, request }) {
  const tokenPayload = await exchangeToken({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: getMicrosoftRedirectUri(request),
  });

  const idTokenPayload = decodeJwtPayload(tokenPayload.id_token);
  let me = null;

  if (tokenPayload.access_token) {
    try {
      me = await fetchGraphMe(tokenPayload.access_token);
    } catch {
      me = null;
    }
  }

  return {
    refreshToken: tokenPayload.refresh_token,
    scope: tokenPayload.scope || getMicrosoftScopeString(),
    connectedAt: new Date().toISOString(),
    account: {
      displayName:
        me?.displayName ||
        idTokenPayload?.name ||
        "",
      email:
        me?.mail ||
        me?.userPrincipalName ||
        idTokenPayload?.preferred_username ||
        "",
    },
  };
}

export async function refreshMicrosoftAccessToken(session) {
  if (!session?.refreshToken) {
    throw new Error("Microsoft account is not connected.");
  }

  const tokenPayload = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });

  const nextSession = {
    ...session,
    refreshToken: tokenPayload.refresh_token || session.refreshToken,
    scope: tokenPayload.scope || session.scope || getMicrosoftScopeString(),
    refreshedAt: new Date().toISOString(),
  };

  return {
    accessToken: tokenPayload.access_token,
    session: nextSession,
  };
}

export function readMicrosoftSessionFromCookies(cookieStore) {
  const value = cookieStore.get(MICROSOFT_GRAPH_SESSION_COOKIE)?.value;
  return decodeMicrosoftSessionCookie(value);
}

export function looksLikeCalendarAvailabilityQuestion(question) {
  const text = normalizeText(question).toLowerCase();
  if (!text) {
    return false;
  }

  const mentionsCalendar =
    text.includes("outlook") ||
    text.includes("calendar") ||
    text.includes("availability") ||
    text.includes("available") ||
    text.includes("free time") ||
    text.includes("free slot") ||
    text.includes("opening") ||
    text.includes("schedule");

  const mentionsSelf =
    text.includes("my ") ||
    text.includes("i have") ||
    text.includes("am i ") ||
    text.includes("do i ");

  return mentionsCalendar && mentionsSelf;
}

export function looksLikeCalendarEventCreationRequest(question) {
  const text = normalizeText(question).toLowerCase();
  if (!text) {
    return false;
  }

  const mentionsCalendar =
    text.includes("outlook") ||
    text.includes("calendar") ||
    text.includes("meeting") ||
    text.includes("appointment") ||
    text.includes("event");

  const asksToCreate =
    text.includes("create") ||
    text.includes("add") ||
    text.includes("book") ||
    text.includes("schedule") ||
    text.includes("set up") ||
    text.includes("put ") ||
    text.includes("send invite") ||
    text.includes("meeting invite");

  return mentionsCalendar && asksToCreate;
}

export function extractAvailabilityDurationMinutes(question) {
  const text = normalizeText(question).toLowerCase();
  const match = text.match(/(\d+)\s*(minute|minutes|min|hour|hours|hr|hrs)/);

  if (match) {
    const value = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith("hour") || unit.startsWith("hr")) {
      return Math.max(30, value * 60);
    }

    return Math.max(30, value);
  }

  if (text.includes("half hour")) {
    return 30;
  }

  if (text.includes("two hour")) {
    return 120;
  }

  return 60;
}

function formatRequestedDateLabel(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function resolveSpokenDateYear(month, day, explicitYear) {
  if (explicitYear) {
    return explicitYear < 100 ? 2000 + explicitYear : explicitYear;
  }

  const now = new Date();
  let year = now.getFullYear();
  const today = new Date(year, now.getMonth(), now.getDate()).getTime();
  const candidate = new Date(year, month - 1, day).getTime();

  if (candidate < today) {
    year += 1;
  }

  return year;
}

function buildRequestedDateParts({ year, month, day }) {
  if (!month || !day || !year) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function resolveRequestedWeekday(weekdayIndex, qualifier) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let daysUntil = (weekdayIndex - today.getDay() + 7) % 7;

  if (daysUntil === 0 && qualifier !== "today") {
    daysUntil = 7;
  }

  const date = new Date(today);
  date.setDate(today.getDate() + daysUntil);

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function parseRequestedDate(question) {
  const text = normalizeText(question);
  const dateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (dateMatch) {
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    const yearValue = Number(dateMatch[3]);
    const year = yearValue < 100 ? 2000 + yearValue : yearValue;

    return buildRequestedDateParts({ year, month, day });
  }

  const monthNames = Object.keys(MONTH_NAME_TO_NUMBER).join("|");
  const monthDayMatch = text.match(
    new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`, "i")
  );
  if (monthDayMatch) {
    const month = MONTH_NAME_TO_NUMBER[monthDayMatch[1].toLowerCase()];
    const day = Number(monthDayMatch[2]);
    const explicitYear = monthDayMatch[3] ? Number(monthDayMatch[3]) : null;
    const year = resolveSpokenDateYear(month, day, explicitYear);

    return buildRequestedDateParts({ year, month, day });
  }

  const dayMonthMatch = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\.?\\s*(\\d{2,4})?\\b`, "i")
  );
  if (dayMonthMatch) {
    const day = Number(dayMonthMatch[1]);
    const month = MONTH_NAME_TO_NUMBER[dayMonthMatch[2].toLowerCase()];
    const explicitYear = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : null;
    const year = resolveSpokenDateYear(month, day, explicitYear);

    return buildRequestedDateParts({ year, month, day });
  }

  const weekdayNames = Object.keys(WEEKDAY_NAME_TO_INDEX).join("|");
  const weekdayMatch = text.match(
    new RegExp(`\\b(?:(next|this|coming)\\s+)?(${weekdayNames})\\b`, "i")
  );
  if (weekdayMatch) {
    const weekdayIndex = WEEKDAY_NAME_TO_INDEX[weekdayMatch[2].toLowerCase()];
    return resolveRequestedWeekday(weekdayIndex, weekdayMatch[1]?.toLowerCase() || "");
  }

  return null;
}

function parseRequestedTime(question) {
  const text = normalizeText(question).toLowerCase();
  const timeMatch = text.match(/\b(?:around|near|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!timeMatch) {
    return null;
  }

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3];

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  return {
    hour,
    minute,
    qualifier: text.includes("around") || text.includes("near") ? "around" : "at",
  };
}

export function extractAvailabilitySearchOptions(question, options = {}) {
  const timeZone = normalizeText(options.timeZone) || DEFAULT_TIMEZONE;
  const requestedDate = parseRequestedDate(question);
  const requestedTime = parseRequestedTime(question);

  if (!requestedDate && !requestedTime) {
    return {};
  }

  if (requestedDate) {
    const { year, month, day } = requestedDate;

    if (requestedTime) {
      const startHour = Math.max(DEFAULT_BUSINESS_START_HOUR, requestedTime.hour - 2);
      const endHour = Math.min(DEFAULT_BUSINESS_END_HOUR, requestedTime.hour + 2);
      const startAt = zonedDateTimeToUtc({
        year,
        month,
        day,
        hour: startHour,
        minute: requestedTime.minute,
        timeZone,
      });
      const endAt = zonedDateTimeToUtc({
        year,
        month,
        day,
        hour: endHour,
        minute: requestedTime.minute,
        timeZone,
      });

      return {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        requestedDateLabel: formatRequestedDateLabel(startAt, timeZone),
        requestedTimeLabel: new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
        }).format(
          zonedDateTimeToUtc({
            year,
            month,
            day,
            hour: requestedTime.hour,
            minute: requestedTime.minute,
            timeZone,
          })
        ),
      };
    }

    const startAt = zonedDateTimeToUtc({
      year,
      month,
      day,
      hour: DEFAULT_BUSINESS_START_HOUR,
      minute: 0,
      timeZone,
    });
    const endAt = zonedDateTimeToUtc({
      year,
      month,
      day,
      hour: DEFAULT_BUSINESS_END_HOUR,
      minute: 0,
      timeZone,
    });

    return {
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      requestedDateLabel: formatRequestedDateLabel(startAt, timeZone),
    };
  }

  return {};
}

async function graphJson(path, accessToken, init = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Prefer: `outlook.timezone="${DEFAULT_TIMEZONE}"`,
    },
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Microsoft Graph request failed.");
  }

  return payload;
}

function toGraphLocalDateTime(value, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function normalizeAttendees(attendees) {
  if (!Array.isArray(attendees)) {
    return [];
  }

  return attendees
    .map((attendee) => {
      const emailAddress =
        typeof attendee === "string"
          ? attendee
          : attendee?.email || attendee?.address || "";
      const name =
        typeof attendee === "string"
          ? ""
          : attendee?.name || attendee?.displayName || "";
      const email = normalizeText(emailAddress);

      if (!email || !email.includes("@")) {
        return null;
      }

      return {
        emailAddress: {
          address: email,
          name: normalizeText(name) || email,
        },
        type: "required",
      };
    })
    .filter(Boolean);
}

export async function createCalendarEvent(accessToken, event, options = {}) {
  const subject = normalizeText(event?.title || event?.subject);
  const localTimeZone = normalizeText(options.localTimeZone) || DEFAULT_TIMEZONE;
  const startDateTime = toGraphLocalDateTime(event?.startAt, localTimeZone);
  const endDateTime = toGraphLocalDateTime(event?.endAt, localTimeZone);
  const timeZone = normalizeText(options.timeZone) || DEFAULT_GRAPH_EVENT_TIMEZONE;

  if (!subject || !startDateTime || !endDateTime) {
    throw new Error("A title, start time, and end time are required to create an Outlook calendar event.");
  }

  const payload = {
    subject,
    body: {
      contentType: "Text",
      content: normalizeText(event?.description || ""),
    },
    start: {
      dateTime: startDateTime,
      timeZone,
    },
    end: {
      dateTime: endDateTime,
      timeZone,
    },
    location: normalizeText(event?.location)
      ? {
          displayName: normalizeText(event.location),
        }
      : undefined,
    attendees: normalizeAttendees(event?.attendees),
  };

  return graphJson("/me/events", accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function getTimeParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

function isWorkingSlot(date, timeZone) {
  const { weekday, hour } = getTimeParts(date, timeZone);
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  return hour >= 8 && hour < 18;
}

function formatSlotRange(startDate, endDate, timeZone) {
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(startDate);

  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  const zoneLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(startDate)
    .find((part) => part.type === "timeZoneName")?.value;

  return `${dayLabel} from ${timeFormatter.format(startDate)} to ${timeFormatter.format(endDate)}${zoneLabel ? ` ${zoneLabel}` : ""}`;
}

export async function findNearestAvailability(accessToken, options = {}) {
  const timeZone = normalizeText(options.timeZone) || DEFAULT_TIMEZONE;
  const durationMinutes = Math.max(30, Number(options.durationMinutes) || 60);
  const slotMinutes = 30;
  const blocksNeeded = Math.max(1, Math.ceil(durationMinutes / slotMinutes));
  const startUtc = options.startAt ? new Date(options.startAt) : new Date();
  const endUtc = options.endAt
    ? new Date(options.endAt)
    : new Date(startUtc.getTime() + (Number(options.days) || 14) * 24 * 60 * 60 * 1000);
  let scheduleAddress = normalizeText(options.scheduleAddress);

  if (!scheduleAddress) {
    const me = await fetchGraphMe(accessToken);
    scheduleAddress = normalizeText(me?.mail || me?.userPrincipalName);
  }

  if (!scheduleAddress) {
    throw new Error("Microsoft Graph did not return a mailbox address for the connected Outlook account.");
  }

  const payload = await graphJson("/me/calendar/getSchedule", accessToken, {
    method: "POST",
    body: JSON.stringify({
      schedules: [scheduleAddress],
      startTime: {
      dateTime: startUtc.toISOString(),
      timeZone: "UTC",
      },
      endTime: {
        dateTime: endUtc.toISOString(),
        timeZone: "UTC",
      },
      availabilityViewInterval: slotMinutes,
    }),
  });

  const schedule = payload?.value?.[0];
  const availabilityView = String(schedule?.availabilityView || "");
  if (!availabilityView) {
    return null;
  }

  const slotMs = slotMinutes * 60 * 1000;

  for (let index = 0; index <= availabilityView.length - blocksNeeded; index += 1) {
    const slotStart = new Date(startUtc.getTime() + index * slotMs);

    let fits = true;
    for (let block = 0; block < blocksNeeded; block += 1) {
      const blockStart = new Date(slotStart.getTime() + block * slotMs);
      if (availabilityView[index + block] !== "0" || !isWorkingSlot(blockStart, timeZone)) {
        fits = false;
        break;
      }
    }

    if (fits) {
      const slotEnd = new Date(slotStart.getTime() + blocksNeeded * slotMs);
      return {
        startAt: slotStart.toISOString(),
        endAt: slotEnd.toISOString(),
        durationMinutes,
        timeZone,
        label: formatSlotRange(slotStart, slotEnd, timeZone),
      };
    }
  }

  return null;
}

export function buildAvailabilityAnswer(slot, durationMinutes) {
  if (!slot) {
    return "I couldn't find an open Outlook slot within the next two weeks during standard business hours.";
  }

  return `Your next ${durationMinutes}-minute Outlook opening is ${slot.label}.`;
}

export function buildAvailabilityAnswerForQuestion(slot, durationMinutes, constraints = {}) {
  if (!slot) {
    if (constraints.requestedDateLabel && constraints.requestedTimeLabel) {
      return `I couldn't find an open ${durationMinutes}-minute Outlook slot on ${constraints.requestedDateLabel} around ${constraints.requestedTimeLabel}.`;
    }

    if (constraints.requestedDateLabel) {
      return `I couldn't find an open ${durationMinutes}-minute Outlook slot on ${constraints.requestedDateLabel} during standard business hours.`;
    }

    return buildAvailabilityAnswer(slot, durationMinutes);
  }

  if (constraints.requestedDateLabel && constraints.requestedTimeLabel) {
    return `On ${constraints.requestedDateLabel}, your next ${durationMinutes}-minute Outlook opening near ${constraints.requestedTimeLabel} is ${slot.label}.`;
  }

  if (constraints.requestedDateLabel) {
    return `On ${constraints.requestedDateLabel}, your next ${durationMinutes}-minute Outlook opening is ${slot.label}.`;
  }

  return buildAvailabilityAnswer(slot, durationMinutes);
}
