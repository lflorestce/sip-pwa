"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestDesktopWindowState } from "@/lib/desktopBridge";
import styles from "./page.module.css";

const NAV_ITEMS = [
  { id: "profile", label: "Profile" },
  { id: "calling", label: "Calling" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
];

function cx(...values) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ProfileClient() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState("profile");
  const [profile, setProfile] = useState(null);
  const [localUserDetails, setLocalUserDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [microsoftStatus, setMicrosoftStatus] = useState({
    loading: true,
    configured: false,
    connected: false,
    profile: null,
    warning: "",
    connectedAt: null,
  });

  useEffect(() => {
    requestDesktopWindowState("maximized", "profile");

    const authToken = localStorage.getItem("authToken");
    if (!authToken) {
      router.push("/auth/login");
      return;
    }

    const parsedUserDetails = JSON.parse(localStorage.getItem("userDetails") || "null");
    setLocalUserDetails(parsedUserDetails);

    let isMounted = true;

    async function loadProfile() {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        const userId =
          parsedUserDetails?.UserId ||
          parsedUserDetails?.userId ||
          parsedUserDetails?.UserID ||
          "";
        const email = parsedUserDetails?.Email || parsedUserDetails?.email || "";

        if (userId) {
          params.set("userId", userId);
        }

        if (email) {
          params.set("email", email);
        }

        const response = await fetch(`/api/user-profile?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load user profile.");
        }

        if (isMounted) {
          setProfile(payload.profile || null);
          setWarning(payload.warning || "");
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load user profile.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    async function loadMicrosoftStatus() {
      try {
        const response = await fetch("/api/microsoft/status", { cache: "no-store" });
        const payload = await response.json();

        if (!isMounted) {
          return;
        }

        setMicrosoftStatus({
          loading: false,
          configured: Boolean(payload.configured),
          connected: Boolean(payload.connected),
          profile: payload.profile || null,
          warning: payload.warning || "",
          connectedAt: payload.connectedAt || null,
        });
      } catch (statusError) {
        if (!isMounted) {
          return;
        }

        setMicrosoftStatus({
          loading: false,
          configured: false,
          connected: false,
          profile: null,
          warning:
            statusError instanceof Error
              ? statusError.message
              : "Unable to verify Microsoft Graph status.",
          connectedAt: null,
        });
      }
    }

    loadMicrosoftStatus();

    const handleMicrosoftAuth = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      if (event.data?.type !== "voiceiq-microsoft-auth") {
        return;
      }

      loadMicrosoftStatus();
    };

    window.addEventListener("message", handleMicrosoftAuth);
    return () => {
      isMounted = false;
      window.removeEventListener("message", handleMicrosoftAuth);
    };
  }, []);

  const displayProfile = useMemo(() => {
    if (!profile && !localUserDetails) {
      return null;
    }

    return {
      firstName: profile?.firstName || localUserDetails?.FirstName || "",
      lastName: profile?.lastName || localUserDetails?.LastName || "",
      email: profile?.email || localUserDetails?.Email || "",
      userId: profile?.userId || localUserDetails?.UserId || localUserDetails?.userId || "",
      companyId: profile?.companyId || localUserDetails?.CompanyId || "",
      ghUserId: profile?.ghUserId || localUserDetails?.GHUserId || localUserDetails?.ghUserID || "",
      outboundNumber: profile?.outboundNumber || localUserDetails?.OutboundNumber || "",
      dateCreated: profile?.dateCreated || localUserDetails?.DateCreated || "",
      hasPassword: profile?.hasPassword ?? Boolean(localUserDetails?.Password),
      webRtcName: localUserDetails?.WebRTCName || "",
      webRtcPw: localUserDetails?.WebRTCPw ? "Configured" : "",
    };
  }, [localUserDetails, profile]);

  function handleBackToDialer() {
    requestDesktopWindowState("normal", "dialer");
    router.push("/");
  }

  function handleConnectMicrosoft() {
    const popup = window.open(
      "/api/microsoft/connect",
      "voiceiq-microsoft-connect",
      "width=560,height=760,resizable=yes,scrollbars=yes"
    );

    if (!popup) {
      setMicrosoftStatus((current) => ({
        ...current,
        warning: "The browser blocked the Microsoft sign-in popup. Please allow popups and try again.",
      }));
    }
  }

  async function handleDisconnectMicrosoft() {
    try {
      await fetch("/api/microsoft/disconnect", {
        method: "POST",
      });

      setMicrosoftStatus({
        loading: false,
        configured: microsoftStatus.configured,
        connected: false,
        profile: null,
        warning: "",
        connectedAt: null,
      });
    } catch (disconnectError) {
      setMicrosoftStatus((current) => ({
        ...current,
        warning:
          disconnectError instanceof Error
            ? disconnectError.message
            : "Unable to disconnect Microsoft Outlook right now.",
      }));
    }
  }

  function renderHero() {
    return (
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrowRow}>
            <p className={styles.eyebrow}>User Settings</p>
            <span className={styles.chip}>AWS User Table</span>
          </div>
          <h1 className={styles.heroTitle}>My Profile</h1>
          <p className={styles.heroText}>
            A classic account-settings workspace with your personal identity, calling configuration,
            and security status pulled from the User table and enriched with the active session details.
          </p>
        </div>
        <button className={styles.primaryButton} onClick={handleBackToDialer}>
          Back to Dialer
        </button>
      </div>
    );
  }

  function renderProfileSection() {
    return (
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Personal Details</h2>
              <div className={styles.subtle}>Core identity fields from the User table.</div>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              First Name
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.firstName || ""} readOnly />
            </label>
            <label className={styles.field}>
              Last Name
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.lastName || ""} readOnly />
            </label>
            <label className={cx(styles.field, styles.fieldFull)}>
              Email
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.email || ""} readOnly />
            </label>
            <label className={styles.field}>
              User ID
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.userId || ""} readOnly />
            </label>
            <label className={styles.field}>
              Date Created
              <input className={cx(styles.input, styles.readonly)} value={formatDate(displayProfile?.dateCreated)} readOnly />
            </label>
          </div>
        </section>

        <aside className={styles.accentCard}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Account Snapshot</h2>
              <div className={styles.subtle}>Quick status at a glance.</div>
            </div>
          </div>
          <div className={styles.sectionStack}>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Company</span>
              <div className={styles.miniValue}>{displayProfile?.companyId || "-"}</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>GlassHive User</span>
              <div className={styles.miniValue}>{displayProfile?.ghUserId || "-"}</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Password On File</span>
              <div className={styles.miniValue}>{displayProfile?.hasPassword ? "Yes" : "No"}</div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  function renderCallingSection() {
    return (
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Calling Setup</h2>
              <div className={styles.subtle}>Outbound and telephony fields associated with your account.</div>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              Outbound Number
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.outboundNumber || ""} readOnly />
            </label>
            <label className={styles.field}>
              Company ID
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.companyId || ""} readOnly />
            </label>
            <label className={styles.field}>
              GlassHive User ID
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.ghUserId || ""} readOnly />
            </label>
            <label className={styles.field}>
              WebRTC Name
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.webRtcName || "Not stored in User table"} readOnly />
            </label>
          </div>
        </section>

        <aside className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Provisioning Notes</h2>
              <div className={styles.subtle}>What this page knows today.</div>
            </div>
          </div>
          <div className={styles.sectionStack}>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>AWS Record</span>
              <div className={styles.miniValue}>{profile ? "Connected" : "Session Only"}</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>SIP Credentials</span>
              <div className={styles.miniValue}>{displayProfile?.webRtcPw || "Unavailable"}</div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  function renderSecuritySection() {
    return (
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Security Preferences</h2>
              <div className={styles.subtle}>A typical settings-page security summary.</div>
            </div>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              Password Status
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.hasPassword ? "Password configured" : "No password found"} readOnly />
            </label>
            <label className={styles.field}>
              Login Email
              <input className={cx(styles.input, styles.readonly)} value={displayProfile?.email || ""} readOnly />
            </label>
            <label className={cx(styles.field, styles.fieldFull)}>
              Session Token
              <input className={cx(styles.input, styles.readonly)} value={"Active in current browser session"} readOnly />
            </label>
          </div>
        </section>

        <aside className={styles.accentCard}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Next Phase</h2>
              <div className={styles.subtle}>Ready for later enhancements.</div>
            </div>
          </div>
          <div className={styles.sectionStack}>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Password Reset</span>
              <div className={styles.miniValue}>Placeholder</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>2FA</span>
              <div className={styles.miniValue}>Placeholder</div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  function renderIntegrationsSection() {
    return (
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Microsoft Outlook</h2>
              <div className={styles.subtle}>
                Connect your Microsoft 365 account so VoiceIQ can answer availability questions and create calendar events during a live call.
              </div>
            </div>
            <span className={cx(styles.statusBadge, microsoftStatus.connected ? styles.statusConnected : styles.statusDisconnected)}>
              {microsoftStatus.loading
                ? "Checking"
                : microsoftStatus.connected
                  ? "Connected"
                  : microsoftStatus.configured
                    ? "Not Connected"
                    : "Not Configured"}
            </span>
          </div>

          <div className={styles.integrationGrid}>
            <div className={styles.integrationCard}>
              <span className={styles.integrationLabel}>Connected account</span>
              <strong>{microsoftStatus.profile?.email || "-"}</strong>
              <p>{microsoftStatus.profile?.displayName || "No Microsoft account linked in this browser yet."}</p>
            </div>

            <div className={styles.integrationCard}>
              <span className={styles.integrationLabel}>Availability access</span>
              <strong>Read and write</strong>
              <p>VoiceIQ can look up open Outlook slots and create calendar events when you ask.</p>
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleConnectMicrosoft}
              disabled={!microsoftStatus.configured}
            >
              {microsoftStatus.connected ? "Reconnect Outlook" : "Connect Outlook"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDisconnectMicrosoft}
              disabled={!microsoftStatus.connected}
            >
              Disconnect
            </button>
          </div>

          {microsoftStatus.warning ? (
            <div className={cx(styles.message, styles.warning)}>{microsoftStatus.warning}</div>
          ) : null}
        </section>

        <aside className={styles.accentCard}>
          <div className={styles.cardHeader}>
            <div>
              <h2>What VoiceIQ Can Do</h2>
              <div className={styles.subtle}>Outlook scheduling support for the live assistant.</div>
            </div>
          </div>
          <div className={styles.sectionStack}>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Live prompt</span>
              <div className={styles.integrationNote}>Find my nearest availability in my Outlook calendar.</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Connection scope</span>
              <div className={styles.integrationNote}>Calendars.ReadWrite plus basic Microsoft profile access.</div>
            </div>
            <div className={styles.miniCard}>
              <span className={styles.miniLabel}>Connected since</span>
              <div className={styles.integrationNote}>{formatDate(microsoftStatus.connectedAt)}</div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <img src="/img/TCEVoiceIQ-Vecotized-Logo1.svg" alt="TCE VoiceIQ logo" className={styles.logo} />
          <p className={styles.eyebrow}>TCE VoiceIQ</p>
          <h2 className={styles.title}>My Profile</h2>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={cx(styles.navItem, activeSection === item.id && styles.navItemActive)}
              onClick={() => setActiveSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className={styles.content}>
        <section className={styles.panel}>
          <div className={styles.panelInner}>
            {renderHero()}
            <div className={styles.summaryGrid}>
              <article className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Current User</span>
                <strong className={styles.summaryValue}>
                  {displayProfile ? `${displayProfile.firstName || ""} ${displayProfile.lastName || ""}`.trim() || "-" : "-"}
                </strong>
              </article>
              <article className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Outbound Number</span>
                <strong className={styles.summaryValue}>{displayProfile?.outboundNumber || "-"}</strong>
              </article>
              <article className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Profile Source</span>
                <strong className={styles.summaryValue}>{profile ? "AWS User" : "Session"}</strong>
              </article>
              <article className={styles.summaryCard}>
                <span className={styles.summaryLabel}>Outlook Link</span>
                <strong className={styles.summaryValue}>
                  {microsoftStatus.connected ? "Connected" : microsoftStatus.loading ? "Checking" : "Off"}
                </strong>
              </article>
            </div>

            {warning ? <div className={cx(styles.message, styles.warning)}>{warning}</div> : null}
            {error ? <div className={cx(styles.message, styles.error)}>{error}</div> : null}
            {loading ? <div className={cx(styles.message, styles.neutral)}>Loading user settings from DynamoDB...</div> : null}

            {!loading && activeSection === "profile" ? renderProfileSection() : null}
            {!loading && activeSection === "calling" ? renderCallingSection() : null}
            {!loading && activeSection === "security" ? renderSecuritySection() : null}
            {!loading && activeSection === "integrations" ? renderIntegrationsSection() : null}
          </div>
        </section>
      </main>
    </div>
  );
}
