//src/app/page.js

"use client"; // Enables client-side rendering for this component
import React, { useEffect } from "react";
import Script from "next/script";
import CallComponent from "./components/CallComponent";
import AppFooter from "./components/AppFooter";
import DesktopBridgeDebug from "./components/DesktopBridgeDebug";
import { desktopBridgeScript, requestDesktopWindowState } from "@/lib/desktopBridge";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Check if the user is logged in by verifying the authToken
    const authToken = localStorage.getItem("authToken");
    if (!authToken) {
      // If no token, redirect to the login page
      router.push("/auth/login");
    }

    requestDesktopWindowState("normal", "dialer");
    // Optionally, you could add further token validation here, such as decoding the JWT.

    // Register the service worker
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/service-worker.js")
          .then((registration) => {
            console.log("ServiceWorker registration successful with scope: ", registration.scope);
          })
          .catch((error) => {
            console.log("ServiceWorker registration failed: ", error);
          });
      });
    }
  }, [router]);

  const handleLogout = () => {
    // Clear the token from localStorage
    localStorage.removeItem("authToken");

    // Redirect the user to the login page
    router.push("/auth/login");
  };

  return (
    <>
      <Script
        id="webview2-bridge"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: desktopBridgeScript }}
      />
      <div className="flex flex-col items-center min-h-screen p-8 sm:p-20">
        <DesktopBridgeDebug />
        <main className="flex flex-col gap-8 items-center w-full">
          {/* Render the CallComponent directly */}
          <CallComponent />
        </main>
        <AppFooter onLogout={handleLogout} />
      </div>
    </>
  );
}
