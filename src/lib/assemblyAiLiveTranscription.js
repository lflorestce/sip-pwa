const STREAM_SAMPLE_RATE = 16000;
const STREAM_FRAME_SIZE = 4096;
const STREAM_ENDPOINT = "wss://streaming.assemblyai.com/v3/ws";

function toQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  return searchParams.toString();
}

function downsampleTo16k(buffer, inputSampleRate) {
  if (inputSampleRate === STREAM_SAMPLE_RATE) {
    return buffer;
  }

  const sampleRateRatio = inputSampleRate / STREAM_SAMPLE_RATE;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPcm(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return buffer;
}

async function fetchTemporaryToken() {
  const response = await fetch("/api/assemblyai-streaming-token", {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to fetch AssemblyAI streaming token.");
  }

  const payload = await response.json();
  if (!payload.token) {
    throw new Error("AssemblyAI streaming token response did not include a token.");
  }

  return payload.token;
}

export async function createAssemblyAiLiveTranscriber({
  onTurn,
  onStateChange,
  onError,
}) {
  const token = await fetchTemporaryToken();
  const queryString = toQueryString({
    token,
    sample_rate: STREAM_SAMPLE_RATE,
    encoding: "pcm_s16le",
    speech_model: "universal-streaming-english",
    speaker_labels: true,
    format_turns: true,
    vad_threshold: 0.4,
    min_turn_silence: 400,
    max_turn_silence: 1280,
    max_speakers: 2,
  });

  const ws = new WebSocket(`${STREAM_ENDPOINT}?${queryString}`);
  ws.binaryType = "arraybuffer";

  let isReady = false;
  let isStopped = false;
  let currentStreamSignature = "";
  let audioContext = null;
  let processorNode = null;
  let sinkNode = null;
  let mixNode = null;
  let sourceNodes = [];

  const notifyState = (state, extra = {}) => {
    onStateChange?.({ state, ...extra });
  };

  const cleanupAudioGraph = async () => {
    sourceNodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {}
    });
    sourceNodes = [];

    if (processorNode) {
      processorNode.onaudioprocess = null;
      try {
        processorNode.disconnect();
      } catch {}
      processorNode = null;
    }

    if (mixNode) {
      try {
        mixNode.disconnect();
      } catch {}
      mixNode = null;
    }

    if (sinkNode) {
      try {
        sinkNode.disconnect();
      } catch {}
      sinkNode = null;
    }

    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
      audioContext = null;
    }
  };

  const updateMediaStreams = async ({ localStream, remoteStream }) => {
    if (isStopped || !isReady) {
      return;
    }

    const signature = [
      localStream?.id || "no-local",
      remoteStream?.id || "no-remote",
      localStream?.getAudioTracks?.().length || 0,
      remoteStream?.getAudioTracks?.().length || 0,
    ].join(":");

    if (signature === currentStreamSignature) {
      return;
    }

    currentStreamSignature = signature;
    await cleanupAudioGraph();

    const availableStreams = [localStream, remoteStream].filter(
      (stream) => stream && stream.getAudioTracks().length > 0
    );

    if (!availableStreams.length) {
      notifyState("waiting-for-audio");
      return;
    }

    audioContext = new window.AudioContext();
    mixNode = audioContext.createGain();
    mixNode.gain.value = 0.8;

    processorNode = audioContext.createScriptProcessor(STREAM_FRAME_SIZE, 1, 1);
    sinkNode = audioContext.createGain();
    sinkNode.gain.value = 0;

    availableStreams.forEach((stream) => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(mixNode);
      sourceNodes.push(source);
    });

    mixNode.connect(processorNode);
    processorNode.connect(sinkNode);
    sinkNode.connect(audioContext.destination);

    processorNode.onaudioprocess = (event) => {
      if (isStopped || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const channelData = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleTo16k(channelData, audioContext.sampleRate);
      const pcm16 = floatTo16BitPcm(downsampled);
      ws.send(pcm16);
    };

    await audioContext.resume();
    notifyState("streaming");
  };

  ws.onopen = () => {
    notifyState("connecting");
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === "Begin") {
        isReady = true;
        notifyState("ready", { sessionId: payload.id });
        return;
      }

      if (payload.type === "Turn") {
        onTurn?.(payload);
        return;
      }

      if (payload.type === "Termination") {
        notifyState("terminated", payload);
      }
    } catch (error) {
      onError?.(error);
    }
  };

  ws.onerror = (event) => {
    onError?.(new Error("AssemblyAI live transcription socket error."));
    notifyState("error", { event });
  };

  ws.onclose = (event) => {
    notifyState("closed", { code: event.code, reason: event.reason });
  };

  const stop = async () => {
    if (isStopped) {
      return;
    }

    isStopped = true;
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "Terminate" }));
      }
    } catch {}

    try {
      ws.close();
    } catch {}

    await cleanupAudioGraph();
  };

  return {
    updateMediaStreams,
    stop,
  };
}
