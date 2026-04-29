"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { ChevronUp, Headset, LogOut, Mail, ShieldCheck, X } from "lucide-react";

export default function AppFooter({ onLogout }) {
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const drawerRef = useRef(null);

  const openDrawer = () => {
    setIsDrawerOpen(true);
  };

  const handleDrawerBlur = (event) => {
    const nextFocused = event.relatedTarget;

    if (drawerRef.current?.contains(nextFocused)) {
      return;
    }

    setIsDrawerOpen(false);
  };

  return (
    <>
      <div
        ref={drawerRef}
        className="relative mt-16 w-full"
        onBlurCapture={handleDrawerBlur}
        onFocusCapture={openDrawer}
      >
        <div className="absolute inset-x-0 -top-5 flex justify-center">
          <button
            type="button"
            onClick={() => setIsDrawerOpen((current) => !current)}
            onFocus={openDrawer}
            aria-expanded={isDrawerOpen}
            aria-controls="app-footer-drawer"
            aria-label={isDrawerOpen ? "Collapse footer drawer" : "Expand footer drawer"}
            className="group inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-2 text-cyan-200 shadow-[0_12px_24px_rgba(2,8,23,0.35)] transition hover:border-cyan-400/40 hover:text-cyan-100"
          >
            <span className="h-1.5 w-8 rounded-full bg-gradient-to-r from-cyan-300/60 via-cyan-100 to-cyan-300/60" />
            <ChevronUp
              className={`h-4 w-4 transition-transform duration-200 ${isDrawerOpen ? "" : "rotate-180"}`}
            />
          </button>
        </div>

        <footer
          id="app-footer-drawer"
          className={`relative overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950 text-slate-100 shadow-[0_30px_80px_rgba(2,8,23,0.45)] transition-all duration-300 ${
            isDrawerOpen
              ? "max-h-[320px] opacity-100"
              : "max-h-0 opacity-0 pointer-events-none border-transparent"
          }`}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_30%),linear-gradient(180deg,rgba(2,6,23,0.96),rgba(15,23,42,0.98))]" />
          <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(71,85,105,0.34)_1px,transparent_1px),linear-gradient(90deg,rgba(71,85,105,0.34)_1px,transparent_1px)] [background-size:24px_24px]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

          <div className="relative flex flex-col items-center justify-center gap-4 px-6 py-8 text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm font-semibold">
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-slate-100 transition hover:text-cyan-200"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
              <span className="text-slate-600">|</span>
              <Link
                href="/terms-of-use"
                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-slate-100 transition hover:text-cyan-200"
              >
                <ShieldCheck className="h-4 w-4" />
                Terms of Use
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setIsSupportOpen(true)}
                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-slate-100 transition hover:text-cyan-200"
              >
                <Headset className="h-4 w-4" />
                Call Support
              </button>
              <span className="text-slate-600">|</span>
              <a
                href="mailto:service@tcecompany.com"
                className="inline-flex items-center gap-2 rounded-full px-2 py-1 text-slate-100 transition hover:text-cyan-200"
              >
                <Mail className="h-4 w-4" />
                Email
              </a>
            </div>

            <p className="text-xs tracking-[0.18em] text-slate-400 uppercase">
              &copy; {new Date().getFullYear()} TCE Voice IQ. All rights reserved.
            </p>
          </div>
        </footer>
      </div>

      {isSupportOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-700 bg-[#0b1324] p-6 text-slate-100 shadow-[0_30px_90px_rgba(2,8,23,0.55)]">
            <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(56,189,248,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.14)_1px,transparent_1px)] [background-size:24px_24px]" />

            <button
              type="button"
              onClick={() => setIsSupportOpen(false)}
              className="absolute right-4 top-4 rounded-full border border-slate-700 bg-slate-900/80 p-2 text-slate-300 transition hover:border-slate-500 hover:text-white"
              aria-label="Close support message"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                <Headset className="h-3.5 w-3.5" />
                Support Routing
              </div>
              <h2 className="text-2xl font-semibold text-white">Contact Support</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                If you think that the reason of your call can be routed to the Support Team via email instead, please use:
              </p>

              <a
                href="mailto:service@tcecompany.com"
                className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-400/15"
              >
                <Mail className="h-4 w-4" />
                service@tcecompany.com
              </a>

              <p className="mt-4 text-sm leading-6 text-slate-400">
                For urgent voice support, you can also call{" "}
                <a href="tel:+18003838001" className="font-semibold text-emerald-300 underline decoration-emerald-400/40 underline-offset-4">
                  (800) 383-8001
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
