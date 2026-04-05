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
let currentGhContact = null;
let callAttemptStartedAt;

const sipEventHandlers = {
  incomingCall: null,
  callProgress: null,
  callConfirmed: null,
  callEnded: null,
  callFailed: null,
  registrationState: null,
};

function getUserDetails() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (window.__TCE_USER_DETAILS__) {
    return window.__TCE_USER_DETAILS__;
  }

  try {
    const raw = localStorage.getItem('userDetails');
    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error('Unable to parse stored user details:', error);
    return null;
  }
}

export function hasUserDetails() {
  return !!getUserDetails();
}

function ensureUserDetails({ redirectToLogin = true } = {}) {
  const details = getUserDetails();

  if (!details) {
    if (redirectToLogin && typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }

    throw new Error('User details not found in local storage.');
  }

  return details;
}

function getConfiguration() {
  const userDetails = ensureUserDetails();

  return {
    uri: `sip:${userDetails.WebRTCName}@sip.tcesecure.com`,
    password: userDetails.WebRTCPw,
    session_timers: false,
    register: true,
    traceSip: true,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:turn.relay.metered.ca:443',
        username: userDetails.WebRTCName,
        credential: userDetails.WebRTCPw,
      },
      {
        urls: 'turn:turn.relay.metered.ca:443?transport=udp',
        username: userDetails.WebRTCName,
        credential: userDetails.WebRTCPw,
      },
      {
        urls: 'turn:turn.relay.metered.ca:443?transport=tcp',
        username: userDetails.WebRTCName,
        credential: userDetails.WebRTCPw,
      },
    ],
    sessionDescriptionHandlerFactoryOptions: {
      peerConnectionConfiguration: {
        bundlePolicy: 'max-bundle',
        iceGatheringTimeout: 1000,
      },
    },
  };
}

export function initializeAudio() {
  ringtone = new Audio('/sounds/ringtone.mp3');
  ringtone.loop = true;
}

export function playRingtone() {
  ringtone?.play().catch((error) => {
    console.warn('Unable to play ringtone automatically:', error);
  });
}

export function stopRingtone() {
  ringtone?.pause();
  if (ringtone) ringtone.currentTime = 0;
}

export function registerSipEventHandlers(handlers = {}) {
  Object.assign(sipEventHandlers, handlers);
}

export function answerCall(incomingSession) {
  if (!incomingSession) return;

  stopRingtone();
  session = incomingSession;
  starttime = new Date();

  try {
    session.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: getConfiguration().iceServers },
    });

    attachStream(session);
  } catch (error) {
    console.error('Failed to answer incoming call:', error);
  }
}

export function rejectCall(incomingSession) {
  if (!incomingSession) return;

  stopRingtone();

  try {
    incomingSession.terminate();
  } catch (error) {
    console.warn('Failed to reject incoming call cleanly:', error);
  }
}

export function initializeSIPClient() {
  if (ua) return true;

  const details = getUserDetails();
  if (!details) {
    console.warn('SIP initialization skipped: no stored user details in this profile yet.');
    sipEventHandlers.registrationState?.({
      connected: false,
      registered: false,
      unauthenticated: true,
    });
    return false;
  }

  const configuration = getConfiguration();
  const socket = new JsSIP.WebSocketInterface('wss://sip.tcesecure.com:8089/ws');
  configuration.sockets = [socket];
  ua = new JsSIP.UA(configuration);

  ua.on('connected', () => {
    console.log('SIP connected');
    isClientInitialized = true;
    sipEventHandlers.registrationState?.({
      connected: true,
      registered: isRegistered,
    });
  });

  ua.on('disconnected', () => {
    console.log('SIP disconnected');
    isClientInitialized = false;
    isRegistered = false;
    sipEventHandlers.registrationState?.({
      connected: false,
      registered: false,
    });
  });

  ua.on('registered', () => {
    console.log('SIP registered');
    isRegistered = true;
    sipEventHandlers.registrationState?.({
      connected: true,
      registered: true,
    });
    processQueuedCalls();
  });

  ua.on('registrationFailed', (e) => {
    console.error('SIP registration failed:', e.cause);
    isRegistered = false;
    sipEventHandlers.registrationState?.({
      connected: isClientInitialized,
      registered: false,
      cause: e.cause,
    });
  });

  ua.on('newRTCSession', (data) => {
    const newSession = data.session;
    session = newSession;

    registerSessionEvents(newSession);

    if (newSession.direction === 'incoming') {
      console.log('Incoming call from:', newSession.remote_identity?.uri?.toString?.() || 'unknown');
      playRingtone();

      sipEventHandlers.incomingCall?.({
        session: newSession,
        from: newSession.remote_identity?.uri?.user || '',
        rawUri: newSession.remote_identity?.uri?.toString?.() || '',
      });
    }
  });

  ua.start();
  return true;
}

function queueCall(target) {
  return new Promise((resolve) => {
    callQueue.push({ target, resolve });
  });
}

function processQueuedCalls() {
  while (callQueue.length > 0) {
    const { target, resolve } = callQueue.shift();
    makeCall(target).then(resolve).catch((error) => {
      console.error('Queued call failed:', error);
      resolve();
    });
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

export async function makeCall(target, ghContact = null) {
  if (!target) {
    console.warn('No target number provided to makeCall.');
    return;
  }

  await ensureRegistered(target);

  const normalizedTarget = formatToE164(target);
  const sipUri = `sip:${normalizedTarget}@sip.tcesecure.com`;
  console.log(`Attempting to call: ${sipUri}`);

  starttime = new Date();
  callAttemptStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  currentGhContact = ghContact;

  try {
    session = ua.call(sipUri, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: getConfiguration().iceServers },
    });

    attachStream(session);
    registerSessionEvents(session);
  } catch (error) {
    console.error('Failed to initiate call:', error);
    sipEventHandlers.callFailed?.({
      cause: error?.message || 'Failed to initiate call',
      direction: 'outgoing',
    });
    throw error;
  }
}

export function endCall() {
  if (!session) {
    console.warn('No active session to terminate.');
    return;
  }

  try {
    console.log('Current session status before terminate:', {
      hasSession: !!session,
      isEnded: typeof session?.isEnded === 'function' ? session.isEnded() : 'n/a',
      direction: session?.direction,
    });

    const alreadyEnded =
      typeof session.isEnded === 'function' ? session.isEnded() : false;

    if (alreadyEnded) {
      console.log('Session already ended, skipping terminate()');
      return;
    }

    console.log('Attempting to end call from app...');
    session.terminate();
  } catch (error) {
    console.warn('Failed to terminate session cleanly:', error);
  }
}

export function muteCall() {
  if (session) {
    session.mute({ audio: true });
    console.log('Call muted');
  }
}

export function unmuteCall() {
  if (session) {
    session.unmute({ audio: true });
    console.log('Call unmuted');
  }
}

export function holdCall() {
  if (session) {
    session.hold();
    console.log('Call on hold');
  }
}

export function resumeCall() {
  if (session) {
    session.unhold();
    console.log('Call resumed');
  }
}

function attachStream(currentSession) {
  if (!currentSession?.connection) return;

  currentSession.connection.addEventListener('addstream', (event) => {
    const audio = document.createElement('audio');
    audio.srcObject = event.stream;
    audio.autoplay = true;

    audio.play().catch((error) => {
      console.warn('Failed to autoplay remote audio:', error);
    });
  });

  currentSession.connection.addEventListener('track', () => {
    console.log('PeerConnection track event received.');
  });

  currentSession.connection.addEventListener('icegatheringstatechange', () => {
    console.log('ICE gathering state:', currentSession.connection.iceGatheringState);
  });

  currentSession.connection.addEventListener('iceconnectionstatechange', () => {
    console.log('ICE connection state:', currentSession.connection.iceConnectionState);
  });

  currentSession.connection.addEventListener('connectionstatechange', () => {
    console.log('Peer connection state:', currentSession.connection.connectionState);
  });
}

function registerSessionEvents(currentSession) {
  if (!currentSession || currentSession._tceEventsRegistered) return;
  currentSession._tceEventsRegistered = true;

  currentSession.on('progress', () => {
    const elapsed = callAttemptStartedAt
      ? Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - callAttemptStartedAt)
      : null;
    console.log('Call is in progress...', elapsed !== null ? `elapsed=${elapsed}ms` : '');
    sipEventHandlers.callProgress?.({
      direction: currentSession.direction,
    });
  });

  currentSession.on('confirmed', () => {
    const elapsed = callAttemptStartedAt
      ? Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - callAttemptStartedAt)
      : null;
    console.log('Call confirmed', elapsed !== null ? `elapsed=${elapsed}ms` : '');

    if (!starttime) {
      starttime = new Date();
    }

    startCallTimer();

    sipEventHandlers.callConfirmed?.({
      direction: currentSession.direction,
    });
  });

  currentSession.on('ended', (e) => {
    console.log('Call ended:', e.cause);

    const details = stopCallTimer(currentGhContact);

    sipEventHandlers.callEnded?.({
      cause: e.cause,
      direction: currentSession.direction,
      duration: details?.duration || '0m 0s',
      starttime: details?.starttime,
      endtime: details?.endtime,
    });

    cleanupSessionState(currentSession);
  });

  currentSession.on('bye', () => {
    console.log('Other party hung up');
  });

  currentSession.on('failed', (e) => {
    console.error('Call failed:', e.cause);

    const details = stopCallTimer(currentGhContact);

    sipEventHandlers.callFailed?.({
      cause: e.cause,
      direction: currentSession.direction,
      duration: details?.duration || '0m 0s',
      starttime: details?.starttime,
      endtime: details?.endtime,
    });

    cleanupSessionState(currentSession);
  });

  currentSession.on('icecandidate', (event) => {
    if (
      event.candidate?.type === 'srflx' &&
      event.candidate.relatedAddress &&
      event.candidate.relatedPort
    ) {
      event.ready();
    }
  });
}

function cleanupSessionState(currentSession) {
  if (session === currentSession) {
    session = null;
  }
  currentGhContact = null;
  callAttemptStartedAt = undefined;
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

function stopCallTimer(ghContact) {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }

  if (!isTimerRunning && !starttime) {
    return null;
  }

  isTimerRunning = false;

  const safeStarttime = starttime ? starttime.toISOString() : new Date().toISOString();
  const endtime = new Date().toISOString();
  const duration = `${minutes}m ${seconds}s`;

  console.log(`Call ended. Duration: ${duration}`);

  const { Id, FirstName, LastName, Email, Phone } = ghContact || {};
  const contactDetails = { Id, FirstName, LastName, Email, Phone };

  sendPostCallData({
    starttime: safeStarttime,
    endtime,
    duration,
    ghContact: JSON.stringify(contactDetails),
  });

  const result = {
    starttime: safeStarttime,
    endtime,
    duration,
  };

  seconds = 0;
  minutes = 0;
  starttime = undefined;

  return result;
}

async function ensureRegistered(target) {
  if (!isClientInitialized && !ua) {
    console.log('SIP Client not initialized. Initializing...');
    const initialized = initializeSIPClient();
    if (!initialized) {
      throw new Error('SIP client is not authenticated yet.');
    }
  }

  if (!isRegistered) {
    console.log('Waiting for SIP client to register...');
    await queueCall(target);
  }
}

async function sendPostCallData({ starttime, endtime, duration, ghContact }) {
  const userDetails = ensureUserDetails({ redirectToLogin: false });

  const payload = {
    starttime,
    endtime,
    duration,
    twAccountSid: userDetails.twAccountSid,
    ghToken: userDetails.ghToken,
    ghUserID: userDetails.ghUserID,
    ghUserFirstName: userDetails.FirstName,
    ghUserLastName: userDetails.LastName,
    ghUserEmail: userDetails.Email,
    ghContact,
    postCallNotes: '',
    postcallOption: '',
    context: '',
  };

  console.log('Sending post-call data:', payload);

  try {
    const response = await axios.post(
      'https://click-to-dial-postcall-1443.twil.io/logcall',
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
