"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  makeCall,
  initializeSIPClient,
  endCall,
  muteCall,
  unmuteCall,
  holdCall,
  resumeCall,
  sendDTMF,
  answerCall,
  rejectCall,
  initializeAudio,
  registerSipEventHandlers,
} from "@/lib/sipClient";
import { fetchContactData } from "@/lib/glassHiveService";
import { postDesktopMessage, subscribeDesktopMessages } from "@/lib/desktopBridge";

const CallComponent = () => {
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
  const [isFlipped, setIsFlipped] = useState(false);
  const [callStatus, setCallStatus] = useState("idle");
  const [registrationState, setRegistrationState] = useState({
    connected: false,
    registered: false,
  });

  const isCallActiveRef = useRef(false);
  const callConfirmedRef = useRef(false);

  useEffect(() => {
    isCallActiveRef.current = isCallActive;
  }, [isCallActive]);

  useEffect(() => {
    callConfirmedRef.current = callConfirmed;
  }, [callConfirmed]);

  const fetchContactsForNumber = async (number) => {
    if (!number?.trim()) {
      setContacts([]);
      return [];
    }

    try {
      console.log("Fetching contacts for", number);
      const data = await fetchContactData(number);
      const safeData = Array.isArray(data) ? data : [];
      setContacts(safeData);
      return safeData;
    } catch (error) {
      console.error("Contact lookup failed:", error);
      setContacts([]);
      return [];
    }
  };

  const startDirectCall = async (number) => {
    if (!number?.trim()) return;

    setSelectedContact(null);
    setCallEnded(false);
    setCallDuration(0);
    setCallStatus("dialing");

    try {
      await makeCall(number, null);
    } catch (error) {
      console.error("Failed to place outbound call:", error);
      setCallStatus("failed");
    }
  };

  const processDialRequest = async ({ number, source = "manual", autoDial = false } = {}) => {
    if (!number?.trim()) return;

    setPhoneNumber(number);
    setSelectedContact(null);
    setCallEnded(false);
    setCallConfirmed(false);
    setCallDuration(0);
    setCallStatus(source === "tel" ? "lookup" : "ready");

    const matches = await fetchContactsForNumber(number);

    if (matches.length === 1 && !isCallActiveRef.current && !callConfirmedRef.current) {
      await handleContactSelect(matches[0]);
      return;
    }

    if (matches.length === 0 && autoDial && !isCallActiveRef.current && !callConfirmedRef.current) {
      await startDirectCall(number);
      return;
    }

    setCallStatus(matches.length > 1 ? "contact-selection" : "ready");
    postDesktopMessage("shellLog", {
      message:
        matches.length > 1
          ? `Multiple contacts found for ${number}`
          : `Dial request loaded for ${number}` ,
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    initializeSIPClient();
    initializeAudio();

    registerSipEventHandlers({
      incomingCall: ({ session }) => {
        setIncomingCall(session);
        setCallEnded(false);
        setCallConfirmed(false);
        setIsCallActive(false);
        setCallDuration(0);
        setCallStatus("incoming");
      },

      callProgress: () => {
        setCallStatus("progress");
      },

      callConfirmed: () => {
        setIsCallActive(true);
        setCallConfirmed(true);
        setCallEnded(false);
        setCallStatus("confirmed");
      },

      callEnded: () => {
        setIsCallActive(false);
        setIsMuted(false);
        setIsOnHold(false);
        setIncomingCall(null);
        setCallConfirmed(false);
        setCallEnded(true);
        setCallStatus("ended");
      },

      callFailed: ({ cause }) => {
        console.error("Call failed from component callback:", cause);
        setIsCallActive(false);
        setIsMuted(false);
        setIsOnHold(false);
        setIncomingCall(null);
        setCallConfirmed(false);
        setCallEnded(false);
        setCallStatus(`failed${cause ? `: ${cause}` : ""}`);
      },

      registrationState: (state) => {
        setRegistrationState(state);
      },
    });

    const beep = new Audio("/sounds/beep.mp3");
    setBeepSound(beep);

    const unsubscribe = subscribeDesktopMessages((message) => {
      if (message?.type === "dial") {
        processDialRequest(message);
      }
    });

    postDesktopMessage("dialerReady", {
      page: window.location.pathname,
    });

    const params = new URLSearchParams(window.location.search);
    const number = params.get("number");
    if (number) {
      processDialRequest({ number, source: "query", autoDial: false });
    }

    return () => {
      unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (contacts.length === 1 && !isCallActive && !callConfirmed) {
      handleContactSelect(contacts[0]);
    }
  }, [contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let timer;

    if (isCallActive && callConfirmed) {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isCallActive, callConfirmed]);

  useEffect(() => {
    postDesktopMessage("callStatus", {
      status: callStatus,
      phoneNumber,
      selectedContactId: selectedContact?.Id || null,
    });
  }, [callStatus, phoneNumber, selectedContact]);

  useEffect(() => {
    postDesktopMessage("registrationState", registrationState);
  }, [registrationState]);

  const handleAnswer = () => {
    if (!incomingCall) return;

    answerCall(incomingCall);
    setIncomingCall(null);
    setCallDuration(0);
    setCallEnded(false);
    setCallStatus("answering");
  };

  const handleReject = () => {
    if (!incomingCall) return;

    rejectCall(incomingCall);
    setIncomingCall(null);
    setIsCallActive(false);
    setCallConfirmed(false);
    setCallStatus("rejected");
  };

  const handleContactSelect = async (contact) => {
    if (!contact?.Phone) return;

    setSelectedContact(contact);
    setCallEnded(false);
    setCallDuration(0);
    setCallStatus("dialing");

    try {
      await makeCall(contact.Phone, contact);
    } catch (error) {
      console.error("Failed to place call to selected contact:", error);
      setCallStatus("failed");
    }
  };

  const handleEndCall = () => {
    endCall();
    setCallStatus("ending");
  };

  const handleDialPadClick = (digit) => {
    if (beepSound) {
      beepSound.currentTime = 0;
      beepSound.play().catch((error) => {
        console.warn("Failed to play keypad beep:", error);
      });
    }

    if (isCallActive) {
      sendDTMF(digit);
    } else {
      setPhoneNumber((prev) => prev + digit);
    }
  };

  const handleDelete = () => {
    setPhoneNumber((prev) => prev.slice(0, -1));
  };

  const handleCall = async () => {
    if (!phoneNumber?.trim()) return;

    setSelectedContact(null);
    setCallEnded(false);
    setCallDuration(0);
    setCallStatus("dialing");

    try {
      await makeCall(phoneNumber, null);
    } catch (error) {
      console.error("Failed to place outbound call:", error);
      setCallStatus("failed");
    }
  };

  const handleMute = () => {
    if (isMuted) {
      unmuteCall();
    } else {
      muteCall();
    }

    setIsMuted((prev) => !prev);
  };

  const handleHold = () => {
    if (isOnHold) {
      resumeCall();
    } else {
      holdCall();
    }

    setIsOnHold((prev) => !prev);
  };

  const handleClear = () => {
    window.location.href = "/";
  };

  const handleGoToContact = () => {
    if (selectedContact?.Id) {
      window.location.href = `https://app.glasshive.com/Contacts/${selectedContact.Id}#Activities`;
    }
  };

  const handleGearClick = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleMyProfileClick = () => {
    window.location.href = "/userDetails";
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
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div className={`call-container ${isFlipped ? "flipped" : ""}`}>
      <div className="phone-interface">
        {!isFlipped && (
          <>
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
                    <li
                      key={contact.Id}
                      className="contact-card"
                      onClick={() => handleContactSelect(contact)}
                    >
                      <div className="contact-name">
                        <span className="phone-icon">📞</span> {contact.FirstName} {contact.LastName}
                      </div>
                      <div className="contact-info">
                        Last time called: {new Date(contact.LastCallDate).toLocaleDateString()}
                      </div>
                      <div className="contact-info">Last called by: {contact.LastCaller}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(callStatus !== "idle" || registrationState.connected) && (
              <div style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
                SIP: {registrationState.connected ? "Connected" : "Disconnected"} | Registered:{" "}
                {registrationState.registered ? "Yes" : "No"} | Status: {callStatus}
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
                <button
                  className="go-to-contact-button"
                  onClick={handleGoToContact}
                  disabled={!selectedContact?.Id}
                >
                  Go to Contact
                </button>
              </div>
            )}

            {!isCallActive && !callConfirmed && (
              <div className="phone-number-display">
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Enter a number"
                  disabled={isCallActive}
                />
                <button onClick={handleDelete}>&#x232b;</button>
              </div>
            )}

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

            <div className="call-controls">
              {!isCallActive && !callConfirmed && (
                <button
                  className={`call-button ${contacts.length > 0 ? "clear" : ""}`}
                  onClick={contacts.length > 0 ? handleClear : handleCall}
                >
                  {contacts.length > 0 ? "Clear" : "Call"}
                </button>
              )}

              {isCallActive && (
                <>
                  <button
                    className={`control-button ${isMuted ? "active" : ""}`}
                    onClick={handleMute}
                  >
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button className="control-button end-call-button" onClick={handleEndCall}>
                    Hang Up
                  </button>
                  <button
                    className={`control-button hold-button ${isOnHold ? "active" : ""}`}
                    onClick={handleHold}
                  >
                    {isOnHold ? "Resume" : "Hold"}
                  </button>
                </>
              )}
            </div>

            <div className="gear-icon" onClick={handleGearClick}>
              ⚙️
            </div>
          </>
        )}

        {isFlipped && (
          <div className="back-side">
            <div className="content-container">
              <h2 className="settings-label">
                <span className="gear-icon-inline">⚙️</span> Settings
              </h2>
              <ul>
                <li onClick={() => alert("My Call Logs")}>My Call Logs</li>
                <li onClick={handleMyProfileClick}>My Profile</li>
              </ul>
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
          height: 100vh;
          background-color: #f0f2f5;
          padding: 20px;
          margin-top: 0;
          perspective: 1000px;
        }
        .phone-interface {
          background: white;
          padding: 20px;
          border-radius: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          width: calc(100% - 50px);
          max-width: 350px;
          text-align: center;
          transition: transform 0.6s, height 0.6s;
          transform-style: preserve-3d;
          position: relative;
          height: auto;
        }
        .flipped .phone-interface {
          transform: rotateY(180deg);
          height: 568px;
        }
        .back-side {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(255, 255, 255, 0.9);
          padding: 20px;
          border-radius: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          backface-visibility: hidden;
          transform: rotateY(180deg);
          border: 1px solid #e0e0e0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .content-container {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          width: 100%;
          height: 100%;
        }
        .gear-icon {
          position: absolute;
          bottom: 20px;
          right: 20px;
          font-size: 24px;
          color: grey;
          cursor: pointer;
          opacity: 0.7;
          z-index: 10;
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
          width: 100%;
          text-align: center;
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
        .phone-number-display {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
          background-color: #333;
          border-radius: 8px;
          padding: 10px;
        }
        .phone-number-display input {
          font-size: 24px;
          padding: 10px;
          border: none;
          background: none;
          color: #a9dfbf;
          width: 100%;
          text-align: center;
        }
        .phone-number-display button {
          margin-left: 10px;
          padding: 10px;
          font-size: 18px;
          border: none;
          border-radius: 8px;
          background-color: #dc3545;
          color: white;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .phone-number-display button:hover {
          background-color: #c82333;
        }
        .dial-pad-container {
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }
        .dial-pad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 5px;
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
          margin-top: 20px;
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
        }
        .call-button:hover {
          background-color: #218838;
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
          justify-content: center;
          background-color: #333;
          color: #a9dfbf;
          padding: 20px;
          border-radius: 8px;
          margin-top: 20px;
          position: relative;
          overflow: hidden;
        }
        .waveform {
          position: absolute;
          top: 45;
          left: 0;
          width: 120%;
          height: 100%;
          background: url('/waveform.png') repeat-x;
          animation: wave 1.5s linear infinite;
          opacity: 0.5;
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
          font-size: 24px;
          margin-top: 10px;
          z-index: 1;
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
        .go-to-contact-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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
      `}</style>
    </div>
  );
};

export default CallComponent;