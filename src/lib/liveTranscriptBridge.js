const LIVE_TRANSCRIPT_CHANNEL = "voiceiq-live-transcript";
const LIVE_TRANSCRIPT_STORAGE_KEY = "voiceiqLiveTranscriptSnapshot";

function isBrowser() {
  return typeof window !== "undefined";
}

export function readLiveTranscriptSnapshot() {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LIVE_TRANSCRIPT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Unable to read live transcript snapshot:", error);
    return null;
  }
}

export function publishLiveTranscriptSnapshot(snapshot) {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(
      LIVE_TRANSCRIPT_STORAGE_KEY,
      JSON.stringify(snapshot)
    );
  } catch (error) {
    console.warn("Unable to persist live transcript snapshot:", error);
  }

  if (typeof window.BroadcastChannel === "undefined") {
    return;
  }

  const channel = new window.BroadcastChannel(LIVE_TRANSCRIPT_CHANNEL);
  channel.postMessage(snapshot);
  channel.close();
}

export function subscribeToLiveTranscript(onMessage) {
  if (!isBrowser()) {
    return () => {};
  }

  let channel = null;
  const handleStorage = (event) => {
    if (event.key !== LIVE_TRANSCRIPT_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      onMessage(JSON.parse(event.newValue));
    } catch (error) {
      console.warn("Unable to parse live transcript storage payload:", error);
    }
  };

  if (typeof window.BroadcastChannel !== "undefined") {
    channel = new window.BroadcastChannel(LIVE_TRANSCRIPT_CHANNEL);
    channel.onmessage = (event) => {
      onMessage(event.data);
    };
  }

  window.addEventListener("storage", handleStorage);

  return () => {
    if (channel) {
      channel.close();
    }
    window.removeEventListener("storage", handleStorage);
  };
}
