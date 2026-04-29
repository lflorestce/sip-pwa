"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  makeCall,
  initializeSIPClient,
  endCall,
  muteCall,
  holdCall,
  sendDTMF,
  answerCall,
  rejectCall,
  registerIncomingCallHandler,
  initializeAudio,
  setAudioDevicePreferences,
  AUDIO_INPUT_DEVICE_STORAGE_KEY,
  AUDIO_OUTPUT_DEVICE_STORAGE_KEY,
  RING_OUTPUT_DEVICE_STORAGE_KEY,
} from "@/lib/sipClient";
import { fetchContactData } from "@/lib/glassHiveService";
import { requestDesktopWindowState } from "@/lib/desktopBridge";
import { createAssemblyAiLiveTranscriber } from "@/lib/assemblyAiLiveTranscription";
import { publishLiveTranscriptSnapshot } from "@/lib/liveTranscriptBridge";

const CallComponent = () => {
  const DESKTOP_AUTO_DIAL_STORAGE_KEY = "desktopAutoDialEnabled";
  const LAST_DIALED_NUMBER_STORAGE_KEY = "lastDialedNumber";
  const POST_CALL_AI_ENABLED_STORAGE_KEY = "postCallAiEnabled";
  const LIVE_TRANSCRIPT_ENABLED_STORAGE_KEY = "liveTranscriptEnabled";
  const VOICEIQ_ASSISTANT_ENABLED_STORAGE_KEY = "voiceIqAssistantEnabled";
  const [phoneNumber, setPhoneNumber] = useState("");
  const [contacts, setContacts] = useState([]);
  const [selectedContact, setSelectedContact] = useState(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [beepSound, setBeepSound] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [callEnded, setCallEnded] = useState(false);
  const [callConfirmed, setCallConfirmed] = useState(false);
  const [activeCallDigits, setActiveCallDigits] = useState("");
  const [isFlipped, setIsFlipped] = useState(false);
  const [desktopAutoDialEnabled, setDesktopAutoDialEnabled] = useState(false);
  const [postCallAiEnabled, setPostCallAiEnabled] = useState(false);
  const [liveTranscriptEnabled, setLiveTranscriptEnabled] = useState(false);
  const [voiceIqAssistantEnabled, setVoiceIqAssistantEnabled] = useState(false);
  const [lastDialedNumber, setLastDialedNumber] = useState("");
  const [shouldHighlightCallButton, setShouldHighlightCallButton] = useState(false);
  const [liveTranscriptRows, setLiveTranscriptRows] = useState([]);
  const [liveTranscriptState, setLiveTranscriptState] = useState("idle");
  const [licensePrompt, setLicensePrompt] = useState(null);
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState("");
  const [selectedAudioOutputDeviceId, setSelectedAudioOutputDeviceId] = useState("");
  const [selectedRingOutputDeviceId, setSelectedRingOutputDeviceId] = useState("");
  const [audioDeviceStatus, setAudioDeviceStatus] = useState("");
  const startOutgoingCallRef = useRef(null);
  const desktopAutoDialEnabledRef = useRef(false);
  const liveTranscriberRef = useRef(null);
  const latestCallMediaRef = useRef({
    localStream: null,
    remoteStream: null,
  });
  const liveTranscriptBufferRef = useRef(new Map());
  const transcriptWindowRef = useRef(null);

  const emitDialerLog = (message, payload = null) => {
    if (typeof window === "undefined") {
      return;
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      kind: "dialer",
      message,
      payload,
    };

    window.__desktopBridgeLogs = window.__desktopBridgeLogs || [];
    window.__desktopBridgeLogs.push(entry);
    if (window.__desktopBridgeLogs.length > 25) {
      window.__desktopBridgeLogs.shift();
    }

    window.dispatchEvent(
      new CustomEvent("desktop-bridge-log", {
        detail: entry,
      })
    );
  };

  const updateLiveTranscriptRows = (buffer) => {
    const rows = [...buffer.values()]
      .sort((left, right) => left.turnOrder - right.turnOrder)
      .slice(-2)
      .map((entry) => ({
        id: `${entry.turnOrder}-${entry.speakerLabel}`,
        speakerLabel: entry.speakerLabel || "UNKNOWN",
        text: entry.transcript,
      }));

    setLiveTranscriptRows(rows);
  };

  const getUserDetails = () => {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return JSON.parse(window.localStorage.getItem("userDetails") || "null");
    } catch (error) {
      console.warn("Unable to parse userDetails for feature licensing:", error);
      return null;
    }
  };

  const hasLiveTranscriptLicense = () => {
    const userDetails = getUserDetails();
    if (!userDetails) {
      return false;
    }

    return Boolean(
      userDetails.LiveTranscriptEnabled ||
      userDetails.liveTranscriptEnabled ||
      userDetails.live_transcript_enabled ||
      userDetails.FeatureLiveTranscriptEnabled ||
      userDetails?.featureFlags?.liveTranscriptEnabled ||
      userDetails?.Features?.LiveTranscriptEnabled
    );
  };

  const sendFeatureRequestEmail = (featureName) => {
    const userDetails = getUserDetails();
    const requesterName = [userDetails?.FirstName, userDetails?.LastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const requesterEmail = userDetails?.Email || "";
    const subject = encodeURIComponent(`Feature request: ${featureName}`);
    const body = encodeURIComponent(
      `Hello Support,\n\nPlease enable the ${featureName} feature for my TCE VoiceIQ account.\n\n` +
      `Requester: ${requesterName || "Unknown user"}\n` +
      `Email: ${requesterEmail || "Unknown email"}\n\nThank you.`
    );

    window.location.href = `mailto:support@tcecompany.com?subject=${subject}&body=${body}`;
  };

  const applyFeatureEnablement = ({ enableLiveTranscript, enableVoiceIqAssistant }) => {
    if (enableLiveTranscript) {
      setLiveTranscriptEnabled(true);
    }

    if (enableVoiceIqAssistant) {
      setVoiceIqAssistantEnabled(true);
    }
  };

  const requestLicensedFeatureEnablement = ({
    featureName,
    enableLiveTranscript,
    enableVoiceIqAssistant,
  }) => {
    if (hasLiveTranscriptLicense()) {
      applyFeatureEnablement({ enableLiveTranscript, enableVoiceIqAssistant });
      return;
    }

    setLicensePrompt({
      featureName,
      enableLiveTranscript,
      enableVoiceIqAssistant,
    });
  };

  const resetLiveTranscriptSession = () => {
    liveTranscriptBufferRef.current = new Map();
    setLiveTranscriptRows([]);
    setLiveTranscriptState("idle");

    if (typeof window !== "undefined") {
      window.__liveCallTranscript = [];
    }
  };

  const openTranscriptWindow = () => {
    if (typeof window === "undefined") {
      return;
    }

    if (transcriptWindowRef.current && !transcriptWindowRef.current.closed) {
      transcriptWindowRef.current.focus();
      return;
    }

    const features = [
      "popup=yes",
      "toolbar=no",
      "menubar=no",
      "location=no",
      "status=no",
      "scrollbars=no",
      "resizable=yes",
      "width=460",
      "height=720",
    ].join(",");

    transcriptWindowRef.current = window.open(
      "/live-transcript",
      "voiceiq-live-transcript",
      features
    );
  };

  const closeTranscriptWindow = () => {
    if (transcriptWindowRef.current && !transcriptWindowRef.current.closed) {
      transcriptWindowRef.current.close();
    }

    transcriptWindowRef.current = null;
  };

  const populateDialer = async (number) => {
    setPhoneNumber(number || "");

    if (!number) {
      setContacts([]);
      return;
    }

    console.log("Fetching contacts for", number);
    const data = await fetchContactData(number);
    if (data && data.length) {
      setContacts(data);
    } else {
      setContacts([]);
      console.log("No contacts found.");
    }
  };

  const applyOutputDeviceToElement = async (
    audioElement,
    outputDeviceId,
    { throwOnError = false } = {}
  ) => {
    if (!audioElement || !outputDeviceId || typeof audioElement.setSinkId !== "function") {
      return true;
    }

    try {
      await audioElement.setSinkId(outputDeviceId);
      return true;
    } catch (error) {
      if (throwOnError) {
        throw error;
      }

      if (error?.name !== "AbortError") {
        console.warn("Unable to apply selected audio output device:", error);
      }

      return false;
    }
  };

  const playAudioDeviceTest = async ({ outputDeviceId, source, label }) => {
    try {
      const audio = new Audio(source);
      audio.volume = 0.75;
      await applyOutputDeviceToElement(audio, outputDeviceId, { throwOnError: true });
      await audio.play();
      setAudioDeviceStatus(`${label} test is playing.`);

      window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
      }, 1800);
    } catch (error) {
      setAudioDeviceStatus(
        error instanceof Error ? error.message : `Unable to play ${label.toLowerCase()} test.`
      );
    }
  };

  const buildSelectedMicConstraints = () => ({
    audio: selectedAudioInputDeviceId
      ? {
          deviceId: {
            exact: selectedAudioInputDeviceId,
          },
        }
      : true,
    video: false,
  });

  const handleTestMicrophone = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAudioDeviceStatus("Microphone testing is not supported in this browser.");
      return;
    }

    let stream = null;
    let audioContext = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia(buildSelectedMicConstraints());
      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const samples = new Uint8Array(analyser.fftSize);
      source.connect(analyser);

      setAudioDeviceStatus("Listening to the selected microphone...");

      window.setTimeout(async () => {
        analyser.getByteTimeDomainData(samples);
        const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample - 128)), 0);

        stream?.getTracks().forEach((track) => track.stop());
        await audioContext?.close();

        setAudioDeviceStatus(
          peak > 3
            ? "Microphone test passed. Input was detected."
            : "Microphone is connected, but no input was detected."
        );
      }, 900);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (audioContext) {
        await audioContext.close();
      }
      setAudioDeviceStatus(
        error instanceof Error ? error.message : "Unable to test the selected microphone."
      );
    }
  };

  const loadAudioDevices = async ({ requestPermission = false } = {}) => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setAudioDeviceStatus("Audio device selection is not supported in this browser.");
      return;
    }

    try {
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((track) => track.stop());
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const outputs = devices.filter((device) => device.kind === "audiooutput");

      setAudioInputDevices(inputs);
      setAudioOutputDevices(outputs);
      setAudioDeviceStatus(
        inputs.some((device) => device.label) || outputs.some((device) => device.label)
          ? ""
          : "Allow microphone access to show device names."
      );
    } catch (error) {
      setAudioDeviceStatus(
        error instanceof Error ? error.message : "Unable to load audio devices."
      );
    }
  };

  const startOutgoingCall = (number, options = {}) => {
    if (!number) {
      emitDialerLog("Outgoing call request ignored because no number was provided.", options);
      return;
    }

    setLastDialedNumber(number);
    setSelectedContact(options.contact ?? null);
    setCallEnded(false);
    setCallDuration(0);
    setCallConfirmed(true);
    setActiveCallDigits("");
    setShouldHighlightCallButton(false);
    setIsCallActive(true);
    if (liveTranscriptEnabled) {
      resetLiveTranscriptSession();
      openTranscriptWindow();
    }

    emitDialerLog("Starting outgoing call.", {
      number,
      source: options.source ?? "manual",
      autoDial: !!options.autoDial,
      contactId: options.contact?.Id ?? null,
      postCallEnabled: postCallAiEnabled,
    });
    makeCall(number, {
      contact: options.contact ?? null,
      phoneNumber: number,
      postCallEnabled: postCallAiEnabled,
    });
  };

  startOutgoingCallRef.current = startOutgoingCall;
  desktopAutoDialEnabledRef.current = desktopAutoDialEnabled;

  useEffect(() => {
    initializeSIPClient();
    initializeAudio();

    registerIncomingCallHandler((session) => {
      setIncomingCall(session);
    });

    // Load beep sound
    const beep = new Audio('/sounds/beep.mp3');
    setBeepSound(beep);

    const storedAudioInputDeviceId = window.localStorage.getItem(AUDIO_INPUT_DEVICE_STORAGE_KEY) || "";
    const storedAudioOutputDeviceId = window.localStorage.getItem(AUDIO_OUTPUT_DEVICE_STORAGE_KEY) || "";
    const storedRingOutputDeviceId = window.localStorage.getItem(RING_OUTPUT_DEVICE_STORAGE_KEY) || "";
    setSelectedAudioInputDeviceId(storedAudioInputDeviceId);
    setSelectedAudioOutputDeviceId(storedAudioOutputDeviceId);
    setSelectedRingOutputDeviceId(storedRingOutputDeviceId);
    setAudioDevicePreferences({
      inputDeviceId: storedAudioInputDeviceId,
      outputDeviceId: storedAudioOutputDeviceId,
      ringOutputDeviceId: storedRingOutputDeviceId,
    });
    applyOutputDeviceToElement(beep, storedAudioOutputDeviceId);
    loadAudioDevices();

    const handleDeviceChange = () => loadAudioDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);

    const storedAutoDialPreference = window.localStorage.getItem(DESKTOP_AUTO_DIAL_STORAGE_KEY);
    if (storedAutoDialPreference === "1") {
      setDesktopAutoDialEnabled(true);
    }

    const storedPostCallAiPreference = window.localStorage.getItem(POST_CALL_AI_ENABLED_STORAGE_KEY);
    if (storedPostCallAiPreference === "1") {
      setPostCallAiEnabled(true);
    }

    const storedLiveTranscriptPreference = window.localStorage.getItem(LIVE_TRANSCRIPT_ENABLED_STORAGE_KEY);
    if (storedLiveTranscriptPreference === "1") {
      setLiveTranscriptEnabled(true);
    }

    const storedVoiceIqAssistantPreference = window.localStorage.getItem(VOICEIQ_ASSISTANT_ENABLED_STORAGE_KEY);
    if (storedVoiceIqAssistantPreference === "1") {
      setVoiceIqAssistantEnabled(true);
    }

    const storedLastDialedNumber = window.localStorage.getItem(LAST_DIALED_NUMBER_STORAGE_KEY);
    if (storedLastDialedNumber) {
      setLastDialedNumber(storedLastDialedNumber);
    }

    // Extract the phone number from URL query parameters
    const params = new URLSearchParams(window.location.search);
    const number = params.get("number");
    populateDialer(number || "");

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
    };
  }, []);

  useEffect(() => {
    applyOutputDeviceToElement(beepSound, selectedAudioOutputDeviceId);
  }, [beepSound, selectedAudioOutputDeviceId]);

  useEffect(() => {
    window.localStorage.setItem(
      DESKTOP_AUTO_DIAL_STORAGE_KEY,
      desktopAutoDialEnabled ? "1" : "0"
    );
  }, [desktopAutoDialEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      POST_CALL_AI_ENABLED_STORAGE_KEY,
      postCallAiEnabled ? "1" : "0"
    );
  }, [postCallAiEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      LIVE_TRANSCRIPT_ENABLED_STORAGE_KEY,
      liveTranscriptEnabled ? "1" : "0"
    );
  }, [liveTranscriptEnabled]);

  useEffect(() => {
    window.localStorage.setItem(
      VOICEIQ_ASSISTANT_ENABLED_STORAGE_KEY,
      voiceIqAssistantEnabled ? "1" : "0"
    );
  }, [voiceIqAssistantEnabled]);

  useEffect(() => {
    if (lastDialedNumber) {
      window.localStorage.setItem(LAST_DIALED_NUMBER_STORAGE_KEY, lastDialedNumber);
      return;
    }

    window.localStorage.removeItem(LAST_DIALED_NUMBER_STORAGE_KEY);
  }, [lastDialedNumber]);

  useEffect(() => {
    const handleDesktopDial = (event) => {
      const number = event.detail?.number;
      if (!number) {
        emitDialerLog("Desktop dial event ignored because the number was missing.", event.detail);
        return;
      }

      emitDialerLog("Desktop dial event received by the dialer.", event.detail);
      populateDialer(number);

      const shouldAutoDial =
        !!event.detail?.autoDial || desktopAutoDialEnabledRef.current;

      if (shouldAutoDial) {
        emitDialerLog("Desktop dial is starting automatically.", {
          ...event.detail,
          autoDialSettingEnabled: desktopAutoDialEnabledRef.current,
        });
        startOutgoingCallRef.current?.(number, {
          source: event.detail?.source ?? "desktop",
          autoDial: true,
        });
      }
    };

    window.__desktopDialListenerReady = true;
    emitDialerLog("Dialer listener registered for desktop-dial events.");
    window.addEventListener("desktop-dial", handleDesktopDial);

    const pending = window.__desktopDialQueue || [];
    if (pending.length) {
      pending.forEach((detail) => {
        console.log("Processing pending desktop dial request:", detail);
        emitDialerLog("Processing queued desktop dial request.", detail);
        handleDesktopDial({ detail });
      });
      window.__desktopDialQueue = [];
    }

    return () => {
      window.__desktopDialListenerReady = false;
      emitDialerLog("Dialer listener removed.");
      window.removeEventListener("desktop-dial", handleDesktopDial);
    };
  }, []);

  useEffect(() => {
    let timer;
    if (isCallActive) {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timer);
    }
    return () => clearInterval(timer);
  }, [isCallActive]);

  useEffect(() => {
    const transcript = [...liveTranscriptBufferRef.current.values()].sort(
      (left, right) => left.turnOrder - right.turnOrder
    );

    publishLiveTranscriptSnapshot({
      callActive: isCallActive,
      status: liveTranscriptState,
      rows: liveTranscriptRows,
      transcript,
      liveTranscriptEnabled,
      voiceIqAssistantEnabled,
      updatedAt: new Date().toISOString(),
    });
  }, [isCallActive, liveTranscriptRows, liveTranscriptState, liveTranscriptEnabled, voiceIqAssistantEnabled]);

  useEffect(() => {
    const handleCallMediaStreams = async (event) => {
      latestCallMediaRef.current = {
        localStream: event.detail?.localStream ?? null,
        remoteStream: event.detail?.remoteStream ?? null,
      };

      if (liveTranscriberRef.current) {
        try {
          await liveTranscriberRef.current.updateMediaStreams(latestCallMediaRef.current);
        } catch (error) {
          console.error("Failed to update live transcription media streams:", error);
        }
      }
    };

    const handleCallLiveState = async (event) => {
      if (event.detail?.active === false && liveTranscriberRef.current) {
        await liveTranscriberRef.current.stop();
        liveTranscriberRef.current = null;
        setLiveTranscriptState("stopped");
      }

      if (event.detail?.active === false) {
        setIsCallActive(false);
        setIsMuted(false);
        setIsOnHold(false);
        setCallEnded(true);
        setCallConfirmed(false);
        setActiveCallDigits("");
      }
    };

    window.addEventListener("sip-call-media-streams", handleCallMediaStreams);
    window.addEventListener("sip-call-live-state", handleCallLiveState);

    return () => {
      window.removeEventListener("sip-call-media-streams", handleCallMediaStreams);
      window.removeEventListener("sip-call-live-state", handleCallLiveState);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (!isCallActive || !liveTranscriptEnabled) {
      const stopExisting = async () => {
        if (liveTranscriberRef.current) {
          await liveTranscriberRef.current.stop();
          liveTranscriberRef.current = null;
        }
      };

      stopExisting();
      return undefined;
    }

    openTranscriptWindow();

    const startLiveTranscription = async () => {
      try {
        setLiveTranscriptState("connecting");

        const transcriber = await createAssemblyAiLiveTranscriber({
          onTurn: (turn) => {
            if (!turn?.transcript?.trim()) {
              return;
            }

            const nextBuffer = new Map(liveTranscriptBufferRef.current);
            nextBuffer.set(turn.turn_order, {
              turnOrder: turn.turn_order,
              transcript: turn.transcript.trim(),
              speakerLabel: turn.speaker_label || "UNKNOWN",
              endOfTurn: !!turn.end_of_turn,
            });

            liveTranscriptBufferRef.current = nextBuffer;
            updateLiveTranscriptRows(nextBuffer);

            const transcriptPreview = [...nextBuffer.values()].sort(
              (left, right) => left.turnOrder - right.turnOrder
            );

            window.__liveCallTranscript = transcriptPreview;
            console.log("AssemblyAI live transcript buffer:", transcriptPreview);
          },
          onStateChange: async ({ state }) => {
            if (isCancelled) {
              return;
            }

            setLiveTranscriptState(state);

            if (state === "ready" && liveTranscriberRef.current) {
              await liveTranscriberRef.current.updateMediaStreams(latestCallMediaRef.current);
            }
          },
          onError: (error) => {
            if (isCancelled) {
              return;
            }

            console.error("AssemblyAI live transcription error:", error);
            setLiveTranscriptState("error");
          },
        });

        if (isCancelled) {
          await transcriber.stop();
          return;
        }

        liveTranscriberRef.current = transcriber;
        await transcriber.updateMediaStreams(latestCallMediaRef.current);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error("Unable to start AssemblyAI live transcription:", error);
        setLiveTranscriptState("error");
      }
    };

    startLiveTranscription();

    return () => {
      isCancelled = true;

      const stopTranscriber = async () => {
        if (liveTranscriberRef.current) {
          await liveTranscriberRef.current.stop();
          liveTranscriberRef.current = null;
        }
      };

      stopTranscriber();
    };
  }, [isCallActive, liveTranscriptEnabled]);

  const handleAnswer = () => {
    if (incomingCall) {
      if (liveTranscriptEnabled) {
        resetLiveTranscriptSession();
        openTranscriptWindow();
      }
      answerCall(incomingCall, {
        phoneNumber: incomingCall.remote_identity?.uri?.user ?? "",
        postCallEnabled: postCallAiEnabled,
      });
      setIsCallActive(true);
      setActiveCallDigits("");
      setIncomingCall(null);
    }
  };

  const handleReject = () => {
    if (incomingCall) {
      rejectCall(incomingCall);
      setIncomingCall(null);
    }
  };

  const handleContactSelect = (contact) => {
    startOutgoingCall(contact.Phone, {
      contact,
      source: "contact",
    });
  };

  useEffect(() => {
    if (contacts.length === 1 && !isCallActive && !callConfirmed) {
      startOutgoingCallRef.current?.(contacts[0].Phone, {
        contact: contacts[0],
        source: "contact",
      });
    }
  }, [contacts, isCallActive, callConfirmed]);

  const handleEndCall = () => {
    if (selectedContact) {
      endCall({
        contact: selectedContact,
        phoneNumber: selectedContact.Phone,
        postCallEnabled: postCallAiEnabled,
      }); // Pass selected contact data for post-call webhook
    } else {
      endCall({
        phoneNumber,
        postCallEnabled: postCallAiEnabled,
      }); // If no contact, pass the phone number
    }
    setIsCallActive(false);
    setIsMuted(false);
    setIsOnHold(false);
    setActiveCallDigits("");
    setCallEnded(true);
  };

  const handleDialPadClick = (digit) => {
    if (beepSound) {
      beepSound.play();
    }
    if (isCallActive) {
      sendDTMF(digit); // Send DTMF tones during an active call
      setActiveCallDigits((prev) => prev + digit);
    } else {
      setShouldHighlightCallButton(false);
      setPhoneNumber((prev) => prev + digit); // Add digits to phone number if no active call
    }
  };

  const handleDelete = () => {
    if (isCallActive) {
      setActiveCallDigits((prev) => prev.slice(0, -1));
      return;
    }

    setShouldHighlightCallButton(false);
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleCall = () => {
    startOutgoingCall(phoneNumber, {
      source: "manual",
    });
  };

  const handleDesktopAutoDialToggle = () => {
    setDesktopAutoDialEnabled((current) => {
      const next = !current;
      emitDialerLog(`Desktop auto-dial ${next ? "enabled" : "disabled"} from dialer toggle.`, {
        enabled: next,
      });
      return next;
    });
  };

  const handleRedialPfk = () => {
    if (!lastDialedNumber) {
      emitDialerLog("Re-dial PFK pressed without a stored number.");
      return;
    }

    if (isCallActive) {
      emitDialerLog("Re-dial PFK ignored because a call is already active.", {
        lastDialedNumber,
      });
      return;
    }

    setCallEnded(false);
    setCallConfirmed(false);
    setSelectedContact(null);
    setActiveCallDigits("");
    setShouldHighlightCallButton(true);
    emitDialerLog("Re-dial PFK populated the last dialed number.", {
      number: lastDialedNumber,
    });
    populateDialer(lastDialedNumber);
  };

  const handlePostCallAiToggle = () => {
    setPostCallAiEnabled((current) => {
      const next = !current;
      emitDialerLog(`Post Call AI ${next ? "enabled" : "disabled"} from dialer toggle.`, {
        enabled: next,
      });
      return next;
    });
  };

  const handleLiveTranscriptToggle = () => {
    if (liveTranscriptEnabled) {
      setLiveTranscriptEnabled(false);
      setVoiceIqAssistantEnabled(false);
      closeTranscriptWindow();
      emitDialerLog("Live transcript disabled from dialer toggle.", {
        assistantDisabled: true,
      });
      return;
    }

    requestLicensedFeatureEnablement({
      featureName: "Live Transcript",
      enableLiveTranscript: true,
      enableVoiceIqAssistant: false,
    });
  };

  const handleVoiceIqAssistantToggle = () => {
    if (voiceIqAssistantEnabled) {
      setVoiceIqAssistantEnabled(false);
      emitDialerLog("VoiceIQ Assistant disabled from dialer toggle.");
      return;
    }

    requestLicensedFeatureEnablement({
      featureName: "Live Transcript and VoiceIQ Assistant",
      enableLiveTranscript: true,
      enableVoiceIqAssistant: true,
    });
  };

  const pfkButtons = [
    {
      id: "pfk-1-1",
      label: "Autodial",
      active: desktopAutoDialEnabled,
      interactive: true,
      onClick: handleDesktopAutoDialToggle,
      title: "Toggle desktop auto-dial for host-initiated numbers",
    },
    {
      id: "pfk-1-2",
      label: "Re-dial",
      active: false,
      interactive: !!lastDialedNumber && !isCallActive,
      onClick: handleRedialPfk,
      title: lastDialedNumber ? `Populate ${lastDialedNumber}` : "No recent number stored yet",
    },
    {
      id: "pfk-1-3",
      label: postCallAiEnabled ? "AI Enabled" : "AI Disabled",
      active: postCallAiEnabled,
      interactive: true,
      onClick: handlePostCallAiToggle,
      title: `The Transcript and Call analysis is set to ${postCallAiEnabled ? "ENABLED" : "DISABLED"}`,
    },
    {
      id: "pfk-2-1",
      label: "Live Transcript",
      active: liveTranscriptEnabled,
      interactive: true,
      onClick: handleLiveTranscriptToggle,
      title: liveTranscriptEnabled
        ? "Disable live transcript for future calls"
        : "Enable live transcript for future calls",
    },
    {
      id: "pfk-2-2",
      label: "VoiceIQ Assistant",
      active: voiceIqAssistantEnabled,
      interactive: true,
      onClick: handleVoiceIqAssistantToggle,
      title: voiceIqAssistantEnabled
        ? "Disable VoiceIQ Assistant on the transcript window"
        : "Enable VoiceIQ Assistant and Live Transcript",
    },
    {
      id: "pfk-2-3",
      label: "Not set",
      active: false,
      interactive: false,
      title: "Not configured",
    },
  ];

  const handleMute = () => {
    muteCall();
    setIsMuted((prev) => !prev);
  };

  const handleHold = () => {
    holdCall();
    setIsOnHold((prev) => !prev);
  };

  const handleClear = () => {
    closeTranscriptWindow();
    window.location.href = '/';
  };

  const handleGoToContact = () => {
    if (selectedContact) {
      window.location.href = `https://app.glasshive.com/Contacts/${selectedContact.Id}#Activities`;
    }
  };

  const handleGearClick = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleOpenCallLogs = () => {
    requestDesktopWindowState("maximized", "call-logs");
    window.location.href = "/call-logs";
  };

  const handleOpenProfile = () => {
    requestDesktopWindowState("maximized", "profile");
    window.location.href = "/profile";
  };

  const handleAudioInputDeviceChange = async (deviceId) => {
    setSelectedAudioInputDeviceId(deviceId);
    setAudioDeviceStatus(deviceId ? "Microphone selected." : "Using system default microphone.");
    await setAudioDevicePreferences({
      inputDeviceId: deviceId,
      outputDeviceId: selectedAudioOutputDeviceId,
      ringOutputDeviceId: selectedRingOutputDeviceId,
    });
  };

  const handleAudioOutputDeviceChange = async (deviceId) => {
    setSelectedAudioOutputDeviceId(deviceId);
    setAudioDeviceStatus(deviceId ? "Speaker selected." : "Using system default speaker.");
    await setAudioDevicePreferences({
      inputDeviceId: selectedAudioInputDeviceId,
      outputDeviceId: deviceId,
      ringOutputDeviceId: selectedRingOutputDeviceId,
    });
    await applyOutputDeviceToElement(beepSound, deviceId);
  };

  const handleRingOutputDeviceChange = async (deviceId) => {
    setSelectedRingOutputDeviceId(deviceId);
    setAudioDeviceStatus(deviceId ? "Ring device selected." : "Using system default ring device.");
    await setAudioDevicePreferences({
      inputDeviceId: selectedAudioInputDeviceId,
      outputDeviceId: selectedAudioOutputDeviceId,
      ringOutputDeviceId: deviceId,
    });
  };

  const handleTestSpeaker = () => {
    playAudioDeviceTest({
      outputDeviceId: selectedAudioOutputDeviceId,
      source: "/sounds/beep.mp3",
      label: "Speaker",
    });
  };

  const handleTestRing = () => {
    playAudioDeviceTest({
      outputDeviceId: selectedRingOutputDeviceId,
      source: "/sounds/ringtone.mp3",
      label: "Ring",
    });
  };

  const dialPadButtons = [
    { digit: "1", letters: "" },
    { digit: "2", letters: "ABC" },
    { digit: "3", letters: "DEF" },
    { digit: "4", letters: "GHI" },
    { digit: "5", letters: "JKL" },
    { digit: "6", letters: "MNO" },
    { digit: "7", letters: "PQRS" },
    { digit: "8", letters: "TUV" },
    { digit: "9", letters: "WXYZ" },
    { digit: "*", letters: "" },
    { digit: "0", letters: "+" },
    { digit: "#", letters: "" },
  ];

  const formatDuration = (duration) => {
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const displayValue = isCallActive ? activeCallDigits : phoneNumber;
  const displayPlaceholder = isCallActive ? "Enter extension" : "Enter a number";

  return (
    <div className={`call-container ${isFlipped ? 'flipped' : ''}`}>
      <div className="phone-interface">
        <div className={`front-side ${isFlipped ? 'front-side-hidden' : ''}`}>
            <div className="dialer-logo-frame">
              <img src="/img/TCEVoiceIQ-Vecotized-Logo1.svg" alt="TCE Voice IQ Logo" className="dialer-logo" />
            </div>
            {incomingCall && (
              <div className="incoming-call-modal">
                <h2>Incoming Call</h2>
                <p>From: {incomingCall.remote_identity.uri.user}</p>
                <div className="incoming-call-controls">
                  <button className="answer-button" onClick={handleAnswer}>
                    Answer
                  </button>
                  <button className="reject-button" onClick={handleReject}>
                    Reject
                  </button>
                </div>
              </div>
            )}

            {!isCallActive && !callEnded && (
              <div className="contacts">
                {contacts.length > 1 && (
                  <div className="multiple-contacts">
                    <p className="warning-text">
                      <span className="warning-icon">⚠️</span> Multiple contacts found
                    </p>
                    <p className="warning-text">Please select one:</p>
                  </div>
                )}
                {contacts.length === 1 && (
                  <div className="single-contact">
                    <p className="neutral-text">One contact found</p>
                  </div>
                )}
                <ul>
                  {contacts.map((contact) => (
                    <li key={contact.Id} className="contact-card" onClick={() => handleContactSelect(contact)}>
                      <div className="contact-name">
                        <span className="phone-icon">📞</span> {contact.FirstName} {contact.LastName}
                      </div>
                      <div className="contact-info">Last time called: {new Date(contact.LastCallDate).toLocaleDateString()}</div>
                      <div className="contact-info">Last called by: {contact.LastCaller}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isCallActive && (
              <div className="call-in-progress">
                <div className="waveform"></div>
                <div className="call-timer">{formatDuration(callDuration)}</div>
              </div>
            )}

            {callEnded && (
              <div className="call-ended">
                <p>Call ended</p>
                <button className="clear-button" onClick={handleClear}>Clear</button>
                <button className="go-to-contact-button" onClick={handleGoToContact}>Go to Contact</button>
              </div>
            )}

            {!callEnded && (
              <div className="dialer-dashboard">
                <div className="phone-number-display">
                  <input
                    type="text"
                    value={displayValue}
                    onChange={(e) => {
                      if (!isCallActive) {
                        setShouldHighlightCallButton(false);
                        setPhoneNumber(e.target.value);
                      }
                    }}
                    placeholder={displayPlaceholder}
                    readOnly={isCallActive}
                  />
                  <button onClick={handleDelete}>&#x232b;</button>
                </div>
                <div className="dialer-console">
                  <div className="pfk-column" aria-label="Programmable function keys">
                    {pfkButtons.map((button) =>
                      button.interactive ? (
                        <button
                          key={button.id}
                          type="button"
                          className={`pfk-key ${button.active ? "active" : ""}`}
                          onClick={button.onClick}
                          aria-pressed={button.active}
                          title={button.title ?? "Programmable function key"}
                        >
                          <span className={`pfk-led ${button.active ? "active" : ""}`} aria-hidden="true"></span>
                          <span className="pfk-label">{button.label}</span>
                        </button>
                      ) : (
                        <div key={button.id} className="pfk-key pfk-key-placeholder" aria-hidden="true">
                          <span className="pfk-led"></span>
                          <span className="pfk-label">{button.label}</span>
                        </div>
                      )
                    )}
                  </div>
                  <div className="dial-pad-container">
                    <div className="dial-pad">
                      {dialPadButtons.map(({ digit, letters }) => (
                        <button key={digit} onClick={() => handleDialPadClick(digit)}>
                          <div className="digit">{digit}</div>
                          <div className="letters">{letters}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {licensePrompt && (
              <div className="incoming-call-modal license-modal">
                <h2>Feature Not Licensed</h2>
                <p>
                  You are not licensed to have the {licensePrompt.featureName} feature yet.
                </p>
                <p>
                  For this demo, clicking <strong>OK</strong> will continue as if the feature were licensed.
                </p>
                <div className="incoming-call-controls">
                  <button
                    className="answer-button"
                    onClick={() => {
                      applyFeatureEnablement(licensePrompt);
                      setLicensePrompt(null);
                    }}
                  >
                    OK
                  </button>
                  <button
                    className="reject-button"
                    onClick={() => {
                      sendFeatureRequestEmail(licensePrompt.featureName);
                      setLicensePrompt(null);
                    }}
                  >
                    Send Feature Request
                  </button>
                </div>
              </div>
            )}
            <div className="call-controls">
              {!isCallActive && !callConfirmed && (
                <button className={`call-button ${contacts.length > 0 ? 'clear' : ''} ${shouldHighlightCallButton && contacts.length === 0 ? 'call-button-shimmer' : ''}`} onClick={contacts.length > 0 ? handleClear : handleCall}>
                  {contacts.length > 0 ? "Clear" : "Call"}
                </button>
              )}
              {isCallActive && (
                <>
                  <button className={`control-button ${isMuted ? 'active' : ''}`} onClick={handleMute}>
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button className="control-button end-call-button" onClick={handleEndCall}>
                    Hang Up
                  </button>
                  <button className={`control-button hold-button ${isOnHold ? 'active' : ''}`} onClick={handleHold}>
                    {isOnHold ? "Resume" : "Hold"}
                  </button>
                </>
              )}
            </div>
            <div className="gear-icon" onClick={handleGearClick}>
              ⚙️
            </div>
        </div>

        {/* Back side of the component */}
        {isFlipped && (
          <div className="back-side">
            <div className="content-container">
              <h2 className="settings-label">
                <span className="gear-icon-inline">⚙️</span> Settings
              </h2>
              <ul>
                <li onClick={handleOpenCallLogs}>My Call Logs</li>
                <li onClick={handleOpenProfile}>My Profile</li>
              </ul>
              <div className="audio-settings">
                <div className="audio-settings-header">
                  <span>Audio Devices</span>
                  <button type="button" onClick={() => loadAudioDevices({ requestPermission: true })}>
                    Refresh
                  </button>
                </div>
                <label className="audio-device-field">
                  <span className="audio-device-label">
                    Microphone
                    <button type="button" onClick={handleTestMicrophone}>
                      Test
                    </button>
                  </span>
                  <select
                    value={selectedAudioInputDeviceId}
                    onChange={(event) => handleAudioInputDeviceChange(event.target.value)}
                  >
                    <option value="">System default microphone</option>
                    {audioInputDevices.map((device, index) => (
                      <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="audio-device-field">
                  <span className="audio-device-label">
                    Speaker
                    <button type="button" onClick={handleTestSpeaker}>
                      Test
                    </button>
                  </span>
                  <select
                    value={selectedAudioOutputDeviceId}
                    onChange={(event) => handleAudioOutputDeviceChange(event.target.value)}
                    disabled={typeof HTMLMediaElement !== "undefined" && !HTMLMediaElement.prototype.setSinkId}
                  >
                    <option value="">System default speaker</option>
                    {audioOutputDevices.map((device, index) => (
                      <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                        {device.label || `Speaker ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="audio-device-field">
                  <span className="audio-device-label">
                    Ring
                    <button type="button" onClick={handleTestRing}>
                      Test
                    </button>
                  </span>
                  <select
                    value={selectedRingOutputDeviceId}
                    onChange={(event) => handleRingOutputDeviceChange(event.target.value)}
                    disabled={typeof HTMLMediaElement !== "undefined" && !HTMLMediaElement.prototype.setSinkId}
                  >
                    <option value="">System default ring device</option>
                    {audioOutputDevices.map((device, index) => (
                      <option key={device.deviceId || `ring-${index}`} value={device.deviceId}>
                        {device.label || `Ring device ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                {audioDeviceStatus ? <p className="audio-device-status">{audioDeviceStatus}</p> : null}
              </div>
            </div>
            <div className="gear-icon" onClick={handleGearClick}>
              🔙
            </div>
          </div>
        )}
      </div>
      <style jsx>{`
        .call-container {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          height: auto;
          background-color: #f0f2f5;
          padding: 12px 20px 8px;
          margin-top: 0;
          perspective: 1000px;
        }
        .phone-interface {
          background: white;
          padding: 18px 24px 16px;
          border-radius: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          width: min(100%, 460px);
          max-width: 460px;
          text-align: center;
          transition: transform 0.6s, height 0.6s;
          transform-style: preserve-3d;
          position: relative;
          height: auto; /* Ensure the height is auto to match the original dialer size */
        }
        .front-side {
          position: relative;
          backface-visibility: hidden;
        }
        .front-side-hidden {
          visibility: hidden;
          pointer-events: none;
        }
        .dialer-logo-frame {
          width: 100%;
          height: 126px;
          margin: 0 auto 12px;
          border-radius: 18px;
          overflow: hidden;
          background: #15192b;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dialer-logo {
          width: 100%;
          height: 190px;
          display: block;
          object-fit: cover;
          object-position: center;
          opacity: 0.9;
        }
        .flipped .phone-interface {
          transform: rotateY(180deg);
        }
        .back-side {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.9);
          padding: 20px;
          border-radius: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          backface-visibility: hidden;
          transform: rotateY(180deg);
          border: 1px solid #e0e0e0; /* Light grey border */
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          overflow: hidden; /* Ensures content doesn't spill outside */
        }
        .content-container {
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          align-items: center;
          width: 100%;
          height: 100%;
          overflow-y: auto;
          padding: 4px 2px 48px;
        }
        .gear-icon {
          position: absolute;
          bottom: 20px;
          right: 20px;
          font-size: 24px;
          color: grey;
          cursor: pointer;
          opacity: 0.7;
          z-index: 10; /* Ensure it stays clickable */
        }
        .gear-icon:hover {
          opacity: 1;
        }
        .settings-label {
          display: flex;
          align-items: center;
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .gear-icon-inline {
          margin-right: 10px;
          font-size: 24px;
        }
        .back-side ul {
          list-style: none;
          padding: 0;
          margin: 0;
          width: 100%; /* Ensure full width alignment */
          text-align: center; /* Center-align the list items */
        }
        .back-side li {
          margin: 10px 0;
          padding: 10px;
          cursor: pointer;
          background: #e0e7ff;
          border-radius: 8px;
          color: #007bff;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          transition: background 0.3s;
        }
        .back-side li:hover {
          text-decoration: underline;
          background: #d0d7ff;
        }
        .audio-settings {
          width: 100%;
          margin-top: 14px;
          padding: 12px;
          border: 1px solid #d8dee9;
          border-radius: 12px;
          background: #f8fafc;
          text-align: left;
        }
        .audio-settings-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .audio-settings-header button {
          border: 1px solid #c7d2fe;
          border-radius: 8px;
          background: #eef2ff;
          color: #3730a3;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 8px;
          cursor: pointer;
        }
        .audio-device-field {
          display: grid;
          gap: 6px;
          margin-top: 10px;
          color: #475569;
          font-size: 12px;
          font-weight: 700;
        }
        .audio-device-label {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .audio-device-label button {
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          background: #ecfdf5;
          color: #166534;
          font-size: 12px;
          font-weight: 800;
          padding: 5px 8px;
          cursor: pointer;
        }
        .audio-device-label button:hover {
          background: #dcfce7;
        }
        .audio-device-field select {
          width: 100%;
          min-height: 38px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: white;
          color: #0f172a;
          font-size: 13px;
          padding: 8px 10px;
        }
        .audio-device-field select:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .audio-device-status {
          margin: 10px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.35;
        }
        .phone-number-display {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
          background-color: #333;
          border-radius: 14px;
          padding: 6px 8px 6px 12px;
        }
        .phone-number-display input {
          font-size: 20px;
          padding: 8px 6px;
          border: none;
          background: none;
          color: #a9dfbf;
          width: 100%;
          text-align: center;
        }
        .phone-number-display button {
          margin-left: 10px;
          width: 54px;
          height: 48px;
          padding: 0;
          font-size: 18px;
          border: none;
          border-radius: 12px;
          background-color: #dc3545;
          color: white;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .phone-number-display button:hover {
          background-color: #c82333;
        }
        .dialer-dashboard {
          width: 100%;
        }
        .dialer-console {
          display: grid;
          grid-template-columns: 132px minmax(0, 1fr);
          gap: 18px;
          align-items: start;
          margin-bottom: 12px;
        }
        .pfk-column {
          display: grid;
          gap: 8px;
          padding-top: 6px;
        }
        .pfk-key {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: flex-start;
          width: 132px;
          min-height: 42px;
          padding: 8px 12px;
          border: 3px solid #ccc;
          border-radius: 16px;
          background-color: #f0f2f5;
          color: #334155;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
        }
        .pfk-key:hover {
          background-color: #e0e0e0;
          transform: translateY(-1px);
        }
        .pfk-key.active {
          border-color: #9fd6ab;
          background-color: #edf8ef;
          color: #166534;
        }
        .pfk-key-placeholder {
          cursor: default;
          color: #7b8794;
        }
        .pfk-key-placeholder:hover {
          transform: none;
          background-color: #f0f2f5;
        }
        .pfk-led {
          width: 8px;
          height: 8px;
          flex-shrink: 0;
          border-radius: 999px;
          background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.5), 0 0 0 2px rgba(148, 163, 184, 0.12);
        }
        .pfk-led.active {
          background: linear-gradient(180deg, #86efac 0%, #16a34a 100%);
          box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.55), 0 0 0 3px rgba(34, 197, 94, 0.14), 0 0 10px rgba(34, 197, 94, 0.28);
        }
        .pfk-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          line-height: 1.1;
          text-align: left;
        }
        .dial-pad-container {
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .dial-pad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .dial-pad button {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 66px;
          height: 66px;
          font-size: 18px;
          border: 3px solid #ccc;
          border-radius: 50%;
          background-color: #f0f2f5;
          color: #333;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .dial-pad button:hover {
          background-color: #e0e0e0;
        }
        .digit {
          font-size: 24px;
        }
        .letters {
          font-size: 12px;
          color: #666;
        }
        .call-controls {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .call-button, .control-button {
          padding: 10px 20px;
          font-size: 18px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          margin-top: 10px;
        }
        .call-button {
          background-color: #28a745;
          color: white;
          position: relative;
          overflow: hidden;
        }
        .call-button:hover {
          background-color: #218838;
        }
        .call-button-shimmer {
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15), 0 0 22px rgba(74, 222, 128, 0.28), 0 8px 18px rgba(34, 197, 94, 0.24);
        }
        .call-button-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 18%, rgba(255, 255, 255, 0.18) 45%, rgba(255, 255, 255, 0.55) 50%, rgba(255, 255, 255, 0.18) 55%, transparent 82%);
          transform: translateX(-135%);
          animation: callButtonShimmer 1.8s ease-in-out infinite;
          pointer-events: none;
        }
        .call-button.clear {
          background-color: #6c757d;
        }
        .call-button.clear:hover {
          background-color: #5a6268;
        }
        .control-button {
          background-color: #ffc107;
          color: white;
        }
        .control-button.active {
          background-color: #e0a800;
        }
        .control-button.end-call-button {
          background-color: #dc3545;
        }
        .control-button.end-call-button:hover {
          background-color: #c82333;
        }
        .control-button.hold-button {
          background-color: #800000;
        }
        .control-button.hold-button:hover {
          background-color: #660000;
        }
        .contacts {
          margin-top: 20px;
          width: 100%;
        }
        .contacts ul {
          list-style: none;
          padding: 0;
        }
        .contacts li {
          margin-bottom: 10px;
          padding: 10px;
          background-color: #e0e7ff;
          border: 1px solid #ccc;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          text-align: center;
        }
        .contacts li:hover {
          background-color: #d0d7ff;
        }
        .contact-name {
          font-weight: bold;
        }
        .contact-info {
          font-size: 12px;
          color: #333;
        }
        .multiple-contacts {
          text-align: center;
          background-color: #fff3cd;
          padding: 10px;
          border-radius: 8px;
          margin-bottom: 10px;
        }
        .single-contact {
          text-align: center;
          background-color: #e0e7ff;
          padding: 10px;
          border-radius: 8px;
          margin-bottom: 10px;
        }
        .neutral-text {
          color: #333;
        }
        .warning-text {
          color: #721c24;
        }
        .warning-icon {
          color: #ffc107;
          margin-right: 5px;
        }
        .phone-icon {
          color: #28a745;
          margin-right: 5px;
        }
        .call-in-progress {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          background-color: #333;
          color: #a9dfbf;
          padding: 18px 18px 14px;
          border-radius: 8px;
          margin-top: 20px;
          position: relative;
          overflow: hidden;
          min-height: 108px;
        }
        .waveform {
          position: absolute;
          inset: 0;
          left: 0;
          width: 120%;
          height: 100%;
          background: url('/waveform.png') repeat-x;
          animation: wave 1.5s linear infinite;
          opacity: 0.3;
        }
        @keyframes wave {
          0% {
            background-position: 0 50%;
          }
          100% {
            background-position: 100% 50%;
          }
        }
        .call-timer {
          position: absolute;
          right: 16px;
          bottom: 12px;
          font-size: 22px;
          margin-top: 0;
          z-index: 1;
          text-shadow: 0 0 8px rgba(74, 222, 128, 0.28);
        }
        .call-ended {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background-color: #333;
          color: #a9dfbf;
          padding: 20px;
          border-radius: 8px;
          margin-top: 20px;
        }
        .clear-button, .go-to-contact-button {
          background-color: #6c757d;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          margin-top: 10px;
        }
        .clear-button:hover, .go-to-contact-button:hover {
          background-color: #5a6268;
        }
        .incoming-call-modal {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
          z-index: 1000;
          width: 80%;
          max-width: 300px;
          text-align: center;
        }
        .license-modal {
          max-width: 360px;
        }

        .incoming-call-controls {
          display: flex;
          justify-content: space-around;
          margin-top: 20px;
        }

        .answer-button {
          background-color: #28a745;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        .reject-button {
          background-color: #dc3545;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        .answer-button:hover {
          background-color: #218838;
        }

        .reject-button:hover {
          background-color: #c82333;
        }
        @keyframes callButtonShimmer {
          0% {
            transform: translateX(-135%);
          }
          65%,
          100% {
            transform: translateX(135%);
          }
        }
        @media (max-width: 420px) {
          .phone-interface {
            width: calc(100% - 20px);
            max-width: 360px;
            padding: 20px;
          }
          .dialer-logo-frame {
            height: 104px;
          }
          .dialer-logo {
            height: 158px;
          }
          .dialer-console {
            grid-template-columns: 104px minmax(0, 1fr);
            gap: 8px;
          }
          .pfk-column {
            gap: 8px;
            padding-top: 2px;
          }
          .pfk-key {
            width: 104px;
            min-height: 40px;
            padding: 6px 8px;
            border-radius: 14px;
          }
          .pfk-label {
            font-size: 9px;
          }
          .dial-pad {
            gap: 6px;
          }
          .dial-pad button {
            width: 60px;
            height: 60px;
          }
        }
      `}</style>
    </div>
  );
};

export default CallComponent;
