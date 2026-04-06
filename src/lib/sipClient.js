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

function getConfiguration() {
  const userDetails = getUserDetails();
  if (!userDetails) return null;

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
  if (!isBrowser()) return;

  ringtone = new Audio('/sounds/ringtone.mp3');
  ringtone.loop = true;
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

export function answerCall(incomingSession) {
  const configuration = getConfiguration();
  if (!incomingSession || !configuration) {
    console.warn('Cannot answer call: missing session or SIP configuration.');
    return;
  }

  stopRingtone();
  session = incomingSession;
  session.answer({
    mediaConstraints: { audio: true, video: false },
    pcConfig: { iceServers: configuration.iceServers },
  });
  attachStream(session);
  registerSessionEvents(session);
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

function queueCall(target) {
  return new Promise((resolve) => {
    callQueue.push({ target, resolve });
  });
}

function processQueuedCalls() {
  while (callQueue.length > 0) {
    const { target, resolve } = callQueue.shift();
    makeCall(target).then(resolve);
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

export async function makeCall(target) {
  if (!target) {
    console.warn('No target number provided to makeCall.');
    return;
  }

  await ensureRegistered(target);

  const configuration = getConfiguration();
  if (!configuration || !ua) {
    console.warn('Cannot place call: SIP client is not ready.');
    return;
  }

  const normalizedTarget = formatToE164(target);
  const sipUri = `sip:${normalizedTarget}@sip.tcesecure.com`;
  console.log(`Attempting to call: ${sipUri}`);

  starttime = new Date();

  try {
    session = ua.call(sipUri, {
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: configuration.iceServers },
    });
    attachStream(session);
    registerSessionEvents(session, target);
  } catch (error) {
    console.error('Failed to initiate call:', error);
  }
}

export function endCall(ghContact) {
  if (!session) return;

  session.terminate();
  console.log('Call ended by user');
  stopCallTimer(ghContact);
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

  activeSession.connection.addEventListener('addstream', (event) => {
    const audio = document.createElement('audio');
    audio.srcObject = event.stream;
    audio.play().catch((error) => {
      console.warn('Unable to play remote audio stream:', error);
    });
  });
}

function registerSessionEvents(activeSession, ghContact) {
  if (!activeSession) return;

  activeSession.on('progress', () => console.log('Call is in progress...'));

  activeSession.on('confirmed', () => {
    console.log('Call confirmed');
    startCallTimer();
  });

  activeSession.on('ended', (e) => {
    console.log('Call ended:', e.cause);
  });

  activeSession.on('bye', () => {
    console.log('Other party hung up');
    stopCallTimer(ghContact);
  });

  activeSession.on('failed', (e) => console.error('Call failed:', e.cause));

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

  isTimerRunning = false;

  const endtime = new Date().toISOString();
  const duration = `${minutes}m ${seconds}s`;

  console.log(`Call ended. Duration: ${duration}`);

  const { Id, FirstName, LastName, Email, Phone } = ghContact || {};
  const contactDetails = { Id, FirstName, LastName, Email, Phone };

  if (starttime) {
    sendPostCallData({
      starttime: starttime.toISOString(),
      endtime,
      duration,
      ghContact: JSON.stringify(contactDetails),
    });
  }

  seconds = 0;
  minutes = 0;
}

async function ensureRegistered(target) {
  if (!isClientInitialized) {
    console.log('SIP Client not initialized. Initializing...');
    initializeSIPClient();
  }

  if (!isRegistered) {
    console.log('Waiting for SIP client to register...');
    await queueCall(target);
  }
}

async function sendPostCallData({ starttime, endtime, duration, ghContact }) {
  const userDetails = getUserDetails();
  if (!userDetails) {
    console.warn('Skipping post-call data: userDetails not available.');
    return;
  }

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