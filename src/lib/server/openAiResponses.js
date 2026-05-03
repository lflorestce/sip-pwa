const OPENAI_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

export function hasConfiguredOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  return Boolean(key && key !== "replace_me");
}

export function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanMarkdownAnalysis(value) {
  return String(value || "")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
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

export async function createPostCallAnalysis({ transcriptText, callContext }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                `Call metadata:\n${JSON.stringify(callContext, null, 2)}\n\n` +
                `Live transcript:\n${transcriptText || "No live transcript text was captured."}`,
            },
          ],
        },
      ],
      instructions:
        "You are an IT support operations assistant for TCE Company, a Managed Service Provider. " +
        "Generate a professional post-call analysis using only the supplied live transcript and metadata. " +
        "Do not invent facts. Include: Service Summary, Work Performed, Next Steps / Action Items, and Opportunities / Recommendations only when supported by the transcript.",
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

  return cleanMarkdownAnalysis(
    extractResponseText(await response.json()) || "No analysis returned."
  );
}
