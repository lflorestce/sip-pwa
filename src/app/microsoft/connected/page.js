"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function MicrosoftConnectedContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status") || "success";
  const message = searchParams.get("message") || "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        {
          type: "voiceiq-microsoft-auth",
          status,
          message,
        },
        window.location.origin
      );
    }

    const timer = window.setTimeout(() => {
      window.close();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [message, status]);

  return (
    <main className="shell">
      <div className="card">
        <h1>{status === "success" ? "Microsoft connected" : "Microsoft connection issue"}</h1>
        <p>
          {status === "success"
            ? "VoiceIQ can now use your Outlook calendar for assisted scheduling."
            : message || "The Microsoft sign-in flow did not complete successfully."}
        </p>
        <p className="subtle">This window will close automatically.</p>
      </div>

      <style jsx>{`
        .shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: linear-gradient(135deg, #eef5ff 0%, #f8fbff 46%, #f1f8f0 100%);
          color: #17324d;
          font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        }
        .card {
          width: min(420px, 100%);
          padding: 28px;
          border-radius: 24px;
          border: 1px solid rgba(22, 56, 93, 0.08);
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 22px 54px rgba(41, 84, 131, 0.12);
        }
        h1 {
          margin: 0 0 12px;
          font-size: 28px;
        }
        p {
          margin: 0;
          line-height: 1.6;
          color: #4f6985;
        }
        .subtle {
          margin-top: 14px;
          font-size: 13px;
          color: #6f87a0;
        }
      `}</style>
    </main>
  );
}

export default function MicrosoftConnectedPage() {
  return (
    <Suspense fallback={null}>
      <MicrosoftConnectedContent />
    </Suspense>
  );
}
