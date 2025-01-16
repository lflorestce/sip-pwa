import JsSIP from 'jssip';
import axios from 'axios';

// Retrieve user details from local storage
const userDetails = JSON.parse(localStorage.getItem('userDetails'));

if (!userDetails) {
  // Redirect to login page if user details are not found
  window.location.href = '/login';
  throw new Error('User details not found in local storage. Redirecting to login page.');
}

console.log('User details:', userDetails); // Log user details to verify

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

const configuration = {
  uri: `sip:${userDetails.WebRTCName}@sip.tcesecure.com`,
  password: userDetails.WebRTCPw,
  session_timers: false,
  register: true,
  traceSip: true,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:turn.relay.metered.ca:443', username: userDetails.WebRTCName, credential: userDetails.WebRTCPw },
    { urls: 'turn:turn.relay.metered.ca:443?transport=udp', username: userDetails.WebRTCName, credential: userDetails.WebRTCPw },
    { urls: 'turn:turn.relay.metered.ca:443?transport=tcp', username: userDetails.WebRTCName, credential: userDetails.WebRTCPw },
  ],
  sessionDescriptionHandlerFactoryOptions: {
    peerConnectionConfiguration: {
      bundlePolicy: 'max-bundle',
      iceGatheringTimeout: 1000,
    }
  }
};

export function initializeAudio() {
  ringtone = new Audio('/sounds/ringtone.mp3');
  ringtone.loop = true;
}

export function playRingtone() {
  ringtone?.play();
}

export function stopRingtone() {
  ringtone?.pause();
  if (ringtone) ringtone.currentTime = 0;
}

export function answerCall(incomingSession) {
  if (incomingSession) {
    stopRingtone();
    session = incomingSession;
    session.answer({
      mediaConstraints: { audio: true, video: false },
      pcConfig: { iceServers: configuration.iceServers },
    });
    attachStream(session);
    registerSessionEvents(session);
  }
}

export function rejectCall(incomingSession) {
  if (incomingSession) {
    stopRingtone();
    incomingSession.terminate();
  }
}

export function registerIncomingCallHandler(handler) {
  if (!ua) return;
  
  ua.on('newRTCSession', (event) => {
    if (event.session.direction === 'incoming') {
      playRingtone();
      handler(event.session);
    }
  });
}

// Initialize SIP client
export function initializeSIPClient() {
  if (isClientInitialized) return;

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

// Queue calls until SIP client is registered
function queueCall(target) {
  return new Promise((resolve) => {
    callQueue.push({ target, resolve });
  });
}

// Process queued calls when SIP client is registered
function processQueuedCalls() {
  while (callQueue.length > 0) {
    const { target, resolve } = callQueue.shift();
    makeCall(target).then(resolve);
  }
}

// Format phone number to E.164, assuming U.S. numbers default to +1
function formatToE164(number) {
  if (!number) {
    console.warn("Attempted to format an undefined number to E.164.");
    return "";
  }
  let formattedNumber = number.replace(/\D/g, ''); // Remove non-numeric characters
  if (!formattedNumber.startsWith('1')) {
    formattedNumber = '1' + formattedNumber; // Assume U.S. if no country code
  }
  return `+${formattedNumber}`;
}

// Make a call
export async function makeCall(target) {
  if (!target) {
    console.warn("No target number provided to makeCall.");
    return;
  }

  await ensureRegistered(target);

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
    registerSessionEvents(session, target); // Pass target as ghContact
  } catch (error) {
    console.error('Failed to initiate call:', error);
  }
}

// End the call
export function endCall(ghContact) {
  if (session) {
    session.terminate();
    console.log('Call ended by user');
    stopCallTimer(ghContact);
  }
}

// Mute the call
export function muteCall() {
  if (session) {
    session.mute({ audio: true });
    console.log('Call muted');
  }
}

// Unmute the call
export function unmuteCall() {
  if (session) {
    session.unmute({ audio: true });
    console.log('Call unmuted');
  }
}

// Hold the call
export function holdCall() {
  if (session) {
    session.hold();
    console.log('Call on hold');
  }
}

// Resume the call from hold
export function resumeCall() {
  if (session) {
    session.unhold();
    console.log('Call resumed');
  }
}

// Attach media stream to audio element
function attachStream(session) {
  session.connection.addEventListener('addstream', (event) => {
    const audio = document.createElement('audio');
    audio.srcObject = event.stream;
    audio.play();
  });
}

// Register session events, including handling when the other party hangs up
function registerSessionEvents(session, ghContact) {
  session.on('progress', () => console.log('Call is in progress...'));
  
  session.on('confirmed', () => {
    console.log('Call confirmed');
    startCallTimer();
  });

  session.on('ended', (e) => {
    console.log('Call ended:', e.cause);
    //stopCallTimer(ghContact);
  });
  
  session.on('bye', () => {
    console.log('Other party hung up');
    stopCallTimer(ghContact);
  });

  session.on('failed', (e) => console.error('Call failed:', e.cause));

  session.on("icecandidate", function (event) {
    if (event.candidate?.type === "srflx" && event.candidate.relatedAddress && event.candidate.relatedPort) {
      event.ready();
    }
  });
}

// Start call duration timer
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
    console.log(`Call duration: ${minutes}m ${seconds}s`); // Log the timer values
  }, 1000);
}

// Stop call duration timer and send post-call data
function stopCallTimer(ghContact) {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
  isTimerRunning = false;

  const endtime = new Date().toISOString();
  const duration = `${minutes}m ${seconds}s`;
  
  console.log(`Call ended. Duration: ${duration}`); // Log the final duration

  // Extract specific fields from ghContact
  const { Id, FirstName, LastName, Email, Phone } = ghContact || {};
  const contactDetails = { Id, FirstName, LastName, Email, Phone };

  sendPostCallData({ starttime: starttime.toISOString(), endtime, duration, ghContact: JSON.stringify(contactDetails) });

  seconds = 0;
  minutes = 0;
}

// Ensure SIP client is registered before making a call
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

// Function to send post-call data to AI backend
async function sendPostCallData({ starttime, endtime, duration, ghContact }) {
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
    postCallNotes: "",
    postcallOption: "",
    context: ""
  };

  console.log('Sending post-call data:', payload); // Log the payload to verify

  try {
    const response = await axios.post('https://click-to-dial-postcall-1443.twil.io/logcall', payload);
    console.log("Post-call data sent successfully:", response.data);
  } catch (error) {
    console.error("Error sending post-call data:", error);
  }
}

// Check if SIP client is initialized
export function isInitialized() {
  return isClientInitialized;
}

// Send DTMF during an active call
export function sendDTMF(tone) {
  if (session && session.connection) {
    console.log(`Sending DTMF tone: ${tone}`);
    session.sendDTMF(tone);
  } else {
    console.warn("No active call session to send DTMF tone.");
  }
}