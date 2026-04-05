"use client";

import React, { useEffect, useState } from "react";
import CallComponent from "./components/CallComponent";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const authToken = localStorage.getItem("authToken");
    const userDetails = localStorage.getItem("userDetails");
    const authenticated = !!authToken && !!userDetails;

    setIsAuthenticated(authenticated);
    setAuthChecked(true);

    if (!authenticated) {
      router.replace("/auth/login");
      return;
    }

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
    if (typeof window !== "undefined") {
      localStorage.removeItem("authToken");
      localStorage.removeItem("userDetails");
      setIsAuthenticated(false);
      router.replace("/auth/login");
    }
  };

  if (!authChecked) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Redirecting to login...
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center min-h-screen p-8 sm:p-20">
      <main className="flex flex-col gap-8 items-center w-full">
        <CallComponent />
        <button
          onClick={handleLogout}
          className="text-red-500 underline mt-4"
        >
          Logout
        </button>
      </main>
      <footer className="mt-auto text-center w-full">
        &copy; {new Date().getFullYear()} Insight Call Genius AI
      </footer>
    </div>
  );
}
