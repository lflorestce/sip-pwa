import JsSIP from 'jssip';
import axios from 'axios';

let ua;
let session;
let isClientInitialized = false;
let isRegistered = false;
let callQueue = [];
let callTimer;
let isTimerRunning = false;
let seconds = 0;
let minutes = 0;
let starttime;
let ringtone;
let incomingCallHandlerRegistered = false;
let currentCallContext = null;
const registeredSessions = new WeakSet();
const sessionContexts = new WeakMap();
const remoteStreams = new WeakMap();
const remoteAudioElements = new Set();
let activeCallFinalized = false;
let preferredAudioInputDeviceId = '';
let preferredAudioOutputDeviceId = '';
let preferredRingOutputDeviceId = '';

export const AUDIO_INPUT_DEVICE_STORAGE_KEY = 'voiceiqAudioInputDeviceId';
export const AUDIO_OUTPUT_DEVICE_STORAGE_KEY = 'voiceiqAudioOutputDeviceId';
export const RING_OUTPUT_DEVICE_STORAGE_KEY = 'voiceiqRingOutputDeviceId';

function emitBrowserEvent(name, detail) {
  if (!isBrowser()) return;

  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function getSessionMediaStreams(activeSession) {
  if (!activeSession?.connection) {
    return {
      localStream: null,
      remoteStream: null,
    };
  }

  const senderTracks = activeSession.connection
    .getSenders()
    .map((sender) => sender.track)
    .filter((track) => track && track.kind === 'audio');

  const receiverTracks = activeSession.connection
    .getReceivers()
    .map((receiver) => receiver.track)
    .filter((track) => track && track.kind === 'audio');

  const localStream = senderTracks.length ? new MediaStream(senderTracks) : null;
  const remoteStream =
    remoteStreams.get(activeSession) ||
    (receiverTracks.length ? new MediaStream(receiverTracks) : null);

  return {
    localStream,
    remoteStream,
  };
}

function emitSessionMediaStreams(activeSession) {
  if (!isBrowser()) return;

  const { localStream, remoteStream } = getSessionMediaStreams(activeSession);
  emitBrowserEvent('sip-call-media-streams', {
    hasLocalStream: !!localStream,
    hasRemoteStream: !!remoteStream,
    localStream,
    remoteStream,
  });
}

function cleanupSessionAudio(activeSession) {
  const remoteStream = remoteStreams.get(activeSession);
  remoteStreams.delete(activeSession);

  if (!remoteStream) {
    return;
  }

  remoteAudioElements.forEach((audioElement) => {
    if (audioElement.srcObject === remoteStream) {
      audioElement.srcObject = null;
      remoteAudioElements.delete(audioElement);
    }
  });
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getUserDetails() {
  if (!isBrowser()) return null;

  try {
    return JSON.parse(localStorage.getItem('userDetails') || 'null');
  } catch (error) {
    console.error('Failed to parse userDetails from localStorage:', error);
    return null;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function createCallSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `call-${crypto.randomUUID()}`;
  }

  return `call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function initializeBrowserCallSession(recordingSessionId) {
  if (!isBrowser()) {
    return recordingSessionId || createCallSessionId();
  }

  const resolvedSessionId = recordingSessionId || createCallSessionId();
  window.__voiceIqRecordingSessionId = resolvedSessionId;
  return resolvedSessionId;
}

function readBrowserPostCallAiEnabled() {
  if (!isBrowser()) {
    return null;
  }

  if (typeof window.__voiceIqPostCallAiEnabled === 'boolean') {
    return window.__voiceIqPostCallAiEnabled;
  }

  const stored = window.localStorage?.getItem?.('postCallAiEnabled');
  if (stored === '1') {
    return true;
  }
  if (stored === '0') {
    return false;
  }

  return null;
}

function buildIceServers(userDetails) {
  const stunUrl =
    normalizeText(process.env.NEXT_PUBLIC_ICE_STUN_URL) ||
    'stun:stun.l.google.com:19302';
  const turnUrl =
    normalizeText(process.env.NEXT_PUBLIC_ICE_TURN_URL) ||
    normalizeText(process.env.NEXT_PUBLIC_TURN_URL) ||
    'turn:turn.relay.metered.ca:443';
  const turnUsername =
    normalizeText(process.env.NEXT_PUBLIC_ICE_TURN_USERNAME) ||
    normalizeText(process.env.NEXT_PUBLIC_TURN_USERNAME) ||
    normalizeText(userDetails?.WebRTCName);
  const turnCredential =
    normalizeText(process.env.NEXT_PUBLIC_ICE_TURN_CREDENTIAL) ||
    normalizeText(process.env.NEXT_PUBLIC_TURN_PASSWORD) ||
    normalizeText(userDetails?.WebRTCPw);

  const iceServers = [];
  if (stunUrl) {
    iceServers.push({ urls: stunUrl });
  }

  if (turnUrl && turnUsername && turnCredential) {
    iceServers.push(
      {
        urls: turnUrl,
        username: turnUsername,
        credential: turnCredential,
      },
      {
        urls: `${turnUrl}?transport=udp`,
        username: turnUsername,
        credential: turnCredential,
      },
      {
        urls: `${turnUrl}?transport=tcp`,
        username: turnUsername,
        credential: turnCredential,
      }
    );
  }

  return iceServers;
}

function getConfiguration() {
  const userDetails = getUserDetails();
  if (!userDetails) return null;

  return {
    uri: `sip:${userDetails.WebRTCName}@sip.tcesecure.com`,
    password: userDetails.WebRTCPw,
    session_timers: false,
    register: true,
    traceSip: true,
    iceServers: buildIceServers(userDetails),
    sessionDescriptionHandlerFactoryOptions: {
      peerConnectionConfiguration: {
        bundlePolicy: 'max-bundle',
        iceGatheringTimeout: 1000,
      },
    },
  };
}

function loadAudioDevicePreferences() {
  if (!isBrowser()) return;

  preferredAudioInputDeviceId = localStorage.getItem(AUDIO_INPUT_DEVICE_STORAGE_KEY) || '';
  preferredAudioOutputDeviceId = localStorage.getItem(AUDIO_OUTPUT_DEVICE_STORAGE_KEY) || '';
  preferredRingOutputDeviceId = localStorage.getItem(RING_OUTPUT_DEVICE_STORAGE_KEY) || '';
}

function getAudioConstraints() {
  if (!preferredAudioInputDeviceId) {
    return true;
  }

  return {
    deviceId: {
      exact: preferredAudioInputDeviceId,
    },
  };
}

async function applyAudioOutputDevice(audioElement) {
  if (!audioElement || !preferredAudioOutputDeviceId || typeof audioElement.setSinkId !== 'function') {
    return;
  }

  try {
    await audioElement.setSinkId(preferredAudioOutputDeviceId);
  } catch (error) {
    console.warn('Unable to apply selected speaker device:', error);
  }
}

async function applyRingOutputDevice() {
  if (!ringtone || !preferredRingOutputDeviceId || typeof ringtone.setSinkId !== 'function') {
    return;
  }

  try {
    await ringtone.setSinkId(preferredRingOutputDeviceId);
  } catch (error) {
    console.warn('Unable to apply selected ring device:', error);
  }
}

async function applyAudioOutputDevices() {
  await applyRingOutputDevice();

  for (const audioElement of remoteAudioElements) {
    await applyAudioOutputDevice(audioElement);
  }
}

export async function setAudioDevicePreferences({
  inputDeviceId = '',
  outputDeviceId = '',
  ringOutputDeviceId = '',
} = {}) {
  if (!isBrowser()) return;

  preferredAudioInputDeviceId = inputDeviceId;
  preferredAudioOutputDeviceId = outputDeviceId;
  preferredRingOutputDeviceId = ringOutputDeviceId;

  if (inputDeviceId) {
    localStorage.setItem(AUDIO_INPUT_DEVICE_STORAGE_KEY, inputDeviceId);
  } else {
    localStorage.removeItem(AUDIO_INPUT_DEVICE_STORAGE_KEY);
  }

  if (outputDeviceId) {
    localStorage.setItem(AUDIO_OUTPUT_DEVICE_STORAGE_KEY, outputDeviceId);
  } else {
    localStorage.removeItem(AUDIO_OUTPUT_DEVICE_STORAGE_KEY);
  }

  if (ringOutputDeviceId) {
    localStorage.setItem(RING_OUTPUT_DEVICE_STORAGE_KEY, ringOutputDeviceId);
  } else {
    localStorage.removeItem(RING_OUTPUT_DEVICE_STORAGE_KEY);
  }

  await applyAudioOutputDevices();
  await replaceActiveMicrophoneTrack();
}

async function replaceActiveMicrophoneTrack() {
  if (!isBrowser() || !session?.connection || !preferredAudioInputDeviceId) {
    return;
  }

  const sender = session.connection
    .getSenders()
    .find((currentSender) => currentSender.track?.kind === 'audio');

  if (!sender) {
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: getAudioConstraints(),
      video: false,
    });
    const [track] = stream.getAudioTracks();
    if (!track) {
      return;
    }

    const previousTrack = sender.track;
    await sender.replaceTrack(track);
    previousTrack?.stop();
    emitSessionMediaStreams(session);
  } catch (error) {
    console.warn('Unable to switch active microphone device:', error);
  }
}

export function initializeAudio() {
  if (!isBrowser()) return;

  loadAudioDevicePreferences();
  ringtone = new Audio('/sounds/ringtone.mp3');
  ringtone.loop = true;
  applyRingOutputDevice();
}

export function playRingtone() {
  if (!isBrowser()) return;
  ringtone?.play().catch((error) => {
    console.warn('Unable to play ringtone:', error);
  });
}

export function stopRingtone() {
  ringtone?.pause();
  if (ringtone) ringtone.currentTime = 0;
}

export function answerCall(incomingSession, options = {}) {
  const configuration = getConfiguration();
  if (!incomingSession || !configuration) {
    console.warn('Cannot answer call: missing session or SIP configuration.');
    return;
  }

  stopRingtone();
  starttime = new Date();
  activeCallFinalized = false;
  currentCallContext = {
    recordingSessionId: initializeBrowserCallSession(options.recordingSessionId),
    phoneNumber: options.phoneNumber ?? incomingSession.remote_identity?.uri?.user ?? '',
    postCallEnabled: !!options.postCallEnabled,
  };
  session = incomingSession;
  session.answer({
    mediaConstraints: { audio: getAudioConstraints(), video: false },
    pcConfig: { iceServers: configuration.iceServers },
  });
  attachStream(session);
  registerSessionEvents(session, currentCallContext);
}

export function rejectCall(incomingSession) {
  if (!incomingSession) return;

  stopRingtone();
  incomingSession.terminate();
}

export function registerIncomingCallHandler(handler) {
  if (!ua || incomingCallHandlerRegistered) return;

  ua.on('newRTCSession', (event) => {
    if (event.session.direction === 'incoming') {
      playRingtone();
      handler(event.session);
    }
  });

  incomingCallHandlerRegistered = true;
}

export function initializeSIPClient() {
  if (!isBrowser()) return;
  if (isClientInitialized) return;

  const configuration = getConfiguration();
  if (!configuration) {
    console.warn('SIP initialization skipped: userDetails not available yet.');
    return;
  }

  const socket = new JsSIP.WebSocketInterface('wss://sip.tcesecure.com:8089/ws');
  configuration.sockets = [socket];
  ua = new JsSIP.UA(configuration);

  ua.on('connected', () => {
    console.log('SIP connected');
    isClientInitialized = true;
  });

  ua.on('disconnected', () => {
    console.log('SIP disconnected');
    isClientInitialized = false;
    isRegistered = false;
  });

  ua.on('registered', () => {
    console.log('SIP registered');
    isRegistered = true;
    processQueuedCalls();
  });

  ua.on('registrationFailed', (e) => {
    console.error('SIP registration failed:', e.cause);
    isRegistered = false;
  });

  ua.on('newRTCSession', (data) => {
    session = data.session;
    if (session.direction === 'incoming') {
      console.log('Incoming call from:', session.remote_identity.uri.toString());
      playRingtone();
    }
    registerSessionEvents(session);
  });

  ua.start();
}

function queueCall(target, options = {}) {
  return new Promise((resolve) => {
    callQueue.push({ target, options, resolve });
  });
}

function processQueuedCalls() {
  while (callQueue.length > 0) {
    const { target, options, resolve } = callQueue.shift();
    makeCall(target, options).then(resolve);
  }
}

function formatToE164(number) {
  if (!number) {
    console.warn('Attempted to format an undefined number to E.164.');
    return '';
  }

  let formattedNumber = String(number).replace(/\D/g, '');
  if (!formattedNumber.startsWith('1')) {
    formattedNumber = '1' + formattedNumber;
  }

  return `+${formattedNumber}`;
}

export async function makeCall(target, options = {}) {
  if (!target) {
    console.warn('No target number provided to makeCall.');
    return;
  }

  await ensureRegistered(target, options);

  const configuration = getConfiguration();
  if (!configuration || !ua) {
    console.warn('Cannot place call: SIP client is not ready.');
    return;
  }

  const normalizedTarget = formatToE164(target);
  const sipUri = `sip:${normalizedTarget}@sip.tcesecure.com`;
  console.log(`Attempting to call: ${sipUri}`);

  starttime = new Date();
  activeCallFinalized = false;
  currentCallContext = {
    recordingSessionId: initializeBrowserCallSession(options.recordingSessionId),
    phoneNumber: options.phoneNumber ?? target,
    postCallEnabled: !!options.postCallEnabled,
  };

  try {
    session = ua.call(sipUri, {
      mediaConstraints: { audio: getAudioConstraints(), video: false },
      pcConfig: { iceServers: configuration.iceServers },
    });
    attachStream(session);
    registerSessionEvents(session, currentCallContext);
  } catch (error) {
    console.error('Failed to initiate call:', error);
  }
}

export function endCall(callContextOverride) {
  const activeSession = session;
  const resolvedContext = resolveCallContext(callContextOverride);

  if (!activeSession) {
    stopCallTimer(resolvedContext);
    return;
  }

  const terminatedStates = new Set([
    activeSession.C?.STATUS_CANCELED,
    activeSession.C?.STATUS_TERMINATED,
  ]);

  if (terminatedStates.has(activeSession.status)) {
    console.log('Hang up ignored because the session is already terminated.', {
      status: activeSession.status,
    });
    stopCallTimer(resolvedContext);
    return;
  }

  try {
    activeSession.terminate();
    console.log('Call ended by user');
  } catch (error) {
    console.warn('Unable to terminate the active session cleanly:', error);
  }

  stopCallTimer(resolvedContext);
}

export function muteCall() {
  if (!session) return;

  session.mute({ audio: true });
  console.log('Call muted');
}

export function unmuteCall() {
  if (!session) return;

  session.unmute({ audio: true });
  console.log('Call unmuted');
}

export function holdCall() {
  if (!session) return;

  session.hold();
  console.log('Call on hold');
}

export function resumeCall() {
  if (!session) return;

  session.unhold();
  console.log('Call resumed');
}

function attachStream(activeSession) {
  if (!isBrowser() || !activeSession?.connection) return;

  const handleRemoteStream = (stream) => {
    if (!stream) return;

    remoteStreams.set(activeSession, stream);
    const audio = document.createElement('audio');
    audio.srcObject = stream;
    remoteAudioElements.add(audio);
    applyAudioOutputDevice(audio);
    audio.play().catch((error) => {
      console.warn('Unable to play remote audio stream:', error);
    });
    emitSessionMediaStreams(activeSession);
  };

  activeSession.connection.addEventListener('addstream', (event) => {
    handleRemoteStream(event.stream);
  });

  activeSession.connection.addEventListener('track', (event) => {
    const [stream] = event.streams || [];
    if (stream) {
      handleRemoteStream(stream);
      return;
    }

    if (event.track?.kind === 'audio') {
      handleRemoteStream(new MediaStream([event.track]));
    }
  });

  emitSessionMediaStreams(activeSession);
}

function registerSessionEvents(activeSession, callContext) {
  if (!activeSession) return;

  if (callContext) {
    sessionContexts.set(activeSession, resolveCallContext(callContext));
  }

  if (registeredSessions.has(activeSession)) {
    return;
  }

  registeredSessions.add(activeSession);

  activeSession.on('progress', () => console.log('Call is in progress...'));

  activeSession.on('confirmed', () => {
    console.log('Call confirmed');
    startCallTimer();
    emitSessionMediaStreams(activeSession);
    emitBrowserEvent('sip-call-live-state', { active: true });
  });

  activeSession.on('ended', (e) => {
    console.log('Call ended:', e.cause);
    stopCallTimer(sessionContexts.get(activeSession));
    cleanupSessionAudio(activeSession);
    emitBrowserEvent('sip-call-live-state', { active: false, reason: e.cause || 'ended' });
  });

  activeSession.on('bye', () => {
    console.log('Other party hung up');
    stopCallTimer(sessionContexts.get(activeSession));
    cleanupSessionAudio(activeSession);
    emitBrowserEvent('sip-call-live-state', { active: false, reason: 'bye' });
  });

  activeSession.on('failed', (e) => {
    console.error('Call failed:', e.cause);
    stopCallTimer(sessionContexts.get(activeSession));
    cleanupSessionAudio(activeSession);
    emitBrowserEvent('sip-call-live-state', { active: false, reason: e.cause || 'failed' });
  });

  activeSession.on('icecandidate', (event) => {
    if (
      event.candidate?.type === 'srflx' &&
      event.candidate.relatedAddress &&
      event.candidate.relatedPort
    ) {
      event.ready();
    }
  });
}

function resolveCallContext(callContextOverride) {
  const source = callContextOverride ?? currentCallContext ?? {};
  const browserPostCallEnabled = readBrowserPostCallAiEnabled();

  if (typeof source === 'string') {
    return {
      phoneNumber: source,
      postCallEnabled: browserPostCallEnabled ?? false,
      recordingSessionId: isBrowser() ? window.__voiceIqRecordingSessionId : '',
    };
  }

  return {
    phoneNumber: source.phoneNumber ?? source.contact?.Phone ?? source.ghContact?.Phone ?? '',
    postCallEnabled:
      browserPostCallEnabled !== null ? browserPostCallEnabled : !!source.postCallEnabled,
    recordingSessionId:
      source.recordingSessionId ||
      (isBrowser() ? window.__voiceIqRecordingSessionId : ''),
  };
}

function startCallTimer() {
  if (isTimerRunning) return;

  isTimerRunning = true;
  seconds = 0;
  minutes = 0;

  callTimer = setInterval(() => {
    seconds++;
    if (seconds === 60) {
      seconds = 0;
      minutes++;
    }
    console.log(`Call duration: ${minutes}m ${seconds}s`);
  }, 1000);
}

function stopCallTimer(callContext) {
  if (activeCallFinalized) {
    return;
  }

  activeCallFinalized = true;

  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }

  isTimerRunning = false;

  const endtime = new Date().toISOString();
  const duration = `${minutes}m ${seconds}s`;

  console.log(`Call ended. Duration: ${duration}`);

  const resolvedCallContext = resolveCallContext(callContext);

  if (starttime) {
    sendPostCallData({
      starttime: starttime.toISOString(),
      endtime,
      duration,
      phoneNumber: resolvedCallContext.phoneNumber || '',
      postCallEnabled: resolvedCallContext.postCallEnabled,
      recordingSessionId: resolvedCallContext.recordingSessionId || '',
    });
  }

  seconds = 0;
  minutes = 0;
  starttime = null;
  currentCallContext = null;
  session = null;
}

async function ensureRegistered(target, options = {}) {
  if (!isClientInitialized) {
    console.log('SIP Client not initialized. Initializing...');
    initializeSIPClient();
  }

  if (!isRegistered) {
    console.log('Waiting for SIP client to register...');
    await queueCall(target, options);
  }
}

async function sendPostCallData({ starttime, endtime, duration, phoneNumber, postCallEnabled, recordingSessionId }) {
  const userDetails = getUserDetails();
  if (!userDetails) {
    console.warn('Skipping post-call data: userDetails not available.');
    return;
  }

  const liveTranscript = Array.isArray(window.__liveCallTranscript)
    ? window.__liveCallTranscript
    : [];
  const latestPostCallEnabled = readBrowserPostCallAiEnabled();
  const shouldRunPostCallAi =
    latestPostCallEnabled !== null ? latestPostCallEnabled : !!postCallEnabled;

  const payload = {
    transcriptId: recordingSessionId || undefined,
    recordingSessionId: recordingSessionId || undefined,
    starttime,
    endtime,
    duration,
    twAccountSid: userDetails.twAccountSid,
    firstName: userDetails.FirstName,
    lastName: userDetails.LastName,
    email: userDetails.Email,
    phoneNumber,
    liveTranscript,
    'post-call': shouldRunPostCallAi ? 'true' : 'false',
    postCallEnabled: shouldRunPostCallAi,
    postCallNotes: '',
    postcallOption: '',
    context: '',
  };

  console.log('Sending post-call data:', payload);

  try {
    const response = await axios.post(
      '/api/logcall',
      payload
    );
    console.log('Post-call data sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending post-call data:', error);
  }
}

export function isInitialized() {
  return isClientInitialized;
}

export function sendDTMF(tone) {
  if (session && session.connection) {
    console.log(`Sending DTMF tone: ${tone}`);
    session.sendDTMF(tone);
  } else {
    console.warn('No active call session to send DTMF tone.');
  }
}
