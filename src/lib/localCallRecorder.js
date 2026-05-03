const DEFAULT_CHUNK_MS = 15000;
const DEFAULT_RECORDING_FORMAT = "mp3";

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  const options = [
    "audio/webm;codecs=opus",
    "audio/webm",
  ];

  return options.find((option) => MediaRecorder.isTypeSupported(option)) || "";
}

function makeChunkBlob(event, mimeType) {
  if (event.data?.type) {
    return event.data;
  }

  return new Blob([event.data], {
    type: mimeType || "audio/webm",
  });
}

export function createLocalCallRecorder({
  sessionId,
  getMetadata,
  onStatus,
  chunkMs = DEFAULT_CHUNK_MS,
  outputFormat = DEFAULT_RECORDING_FORMAT,
}) {
  let audioContext = null;
  let destination = null;
  let mediaRecorder = null;
  let chunkIndex = 0;
  let stopped = false;
  let started = false;
  let stopPromise = null;
  let uploadChain = Promise.resolve();
  const connectedStreamIds = new Set();
  const sourceNodes = [];
  const mimeType = getSupportedMimeType();

  const emitStatus = (status, details = {}) => {
    onStatus?.({
      status,
      sessionId,
      ...details,
    });
  };

  const uploadChunk = (blob, index) => {
    if (!blob?.size) {
      return Promise.resolve();
    }

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("chunkIndex", String(index));
    formData.append("chunk", blob, `${String(index).padStart(6, "0")}.webm`);

    return fetch("/api/recordings/chunk", {
      method: "POST",
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        let message = "Recording chunk upload failed.";
        try {
          const payload = await response.json();
          message = payload?.error || message;
        } catch {
          // Keep fallback.
        }
        throw new Error(message);
      }

      return response.json();
    });
  };

  const enqueueChunk = (event) => {
    if (!event.data?.size) {
      return;
    }

    const currentIndex = chunkIndex;
    chunkIndex += 1;
    const blob = makeChunkBlob(event, mimeType);

    uploadChain = uploadChain
      .then(() => uploadChunk(blob, currentIndex))
      .then(() => {
        emitStatus("chunk_uploaded", { chunkIndex: currentIndex });
      })
      .catch((error) => {
        emitStatus("error", {
          message: error instanceof Error ? error.message : "Recording chunk upload failed.",
        });
        throw error;
      });
  };

  const ensureAudioGraph = () => {
    if (audioContext && destination) {
      return;
    }

    audioContext = new AudioContext();
    destination = audioContext.createMediaStreamDestination();
  };

  const startRecorder = () => {
    if (started || !destination) {
      return;
    }

    const stream = destination.stream;
    if (!stream.getAudioTracks().length) {
      return;
    }

    const options = mimeType ? { mimeType } : undefined;
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = enqueueChunk;
    mediaRecorder.onerror = (event) => {
      emitStatus("error", {
        message: event?.error?.message || "MediaRecorder failed.",
      });
    };
    mediaRecorder.start(chunkMs);
    started = true;
    emitStatus("recording");
  };

  const connectStream = (stream) => {
    if (!stream?.getAudioTracks?.().length) {
      return;
    }

    const streamId = stream.id || stream.getAudioTracks().map((track) => track.id).join(":");
    if (connectedStreamIds.has(streamId)) {
      return;
    }

    ensureAudioGraph();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(destination);
    sourceNodes.push(sourceNode);
    connectedStreamIds.add(streamId);
    startRecorder();
  };

  const finalize = async () => {
    await uploadChain;
    const metadata = getMetadata?.() || {};
    const response = await fetch("/api/recordings/finalize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...metadata,
        sessionId,
        callLogId: metadata.callLogId || sessionId,
        format: metadata.format || outputFormat,
        email: metadata.email || "",
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || "Recording finalization failed.");
    }

    emitStatus("finalized", payload);
    return payload;
  };

  return {
    sessionId,
    updateMediaStreams({ localStream, remoteStream } = {}) {
      if (stopped) {
        return;
      }

      connectStream(localStream);
      connectStream(remoteStream);
    },
    async stop() {
      if (stopPromise) {
        return stopPromise;
      }

      stopped = true;

      stopPromise = new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") {
          finalize().then(resolve).catch(reject);
          return;
        }

        mediaRecorder.onstop = () => {
          finalize().then(resolve).catch(reject);
        };

        try {
          mediaRecorder.requestData();
          mediaRecorder.stop();
        } catch (error) {
          reject(error);
        }
      }).finally(async () => {
        sourceNodes.forEach((node) => node.disconnect());
        await audioContext?.close?.().catch(() => {});
        audioContext = null;
        destination = null;
        mediaRecorder = null;
      });

      return stopPromise;
    },
  };
}
