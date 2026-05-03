const QUBIT_WAKE_WORD_PATTERN =
  /\b(?:(?:hey|hi|okay|ok)\s+)?(?:qubit|cubit|q\s*bit|queue\s*bit)\b[\s,;:.-]*/i;

export function normalizeQubitCommandText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractQubitCommand(value) {
  const text = normalizeQubitCommandText(value);
  if (!text) {
    return null;
  }

  const match = text.match(QUBIT_WAKE_WORD_PATTERN);
  if (!match || typeof match.index !== "number") {
    return null;
  }

  const command = normalizeQubitCommandText(
    text
      .slice(match.index + match[0].length)
      .replace(/^[,;:.!?-]+/, "")
  );

  return {
    command,
    matchedText: normalizeQubitCommandText(match[0]),
  };
}
