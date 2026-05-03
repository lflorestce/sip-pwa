import localFont from "next/font/local";
import Script from "next/script";
import DesktopBridgeDebug from "./components/DesktopBridgeDebug";
import { desktopBridgeScript } from "@/lib/desktopBridge";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata = {
  title: "Insight Call Genius AI",
  description: "AI powered call insights",  
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          id="webview2-bridge"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: desktopBridgeScript }}
        />
        <DesktopBridgeDebug />
        {children}
      </body>
    </html>
  );
}
