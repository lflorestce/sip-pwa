import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function isLocalHost(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function isLocalRequest(request) {
  const host = request.headers.get("host") || "";
  const hostname = host.split(":")[0];
  return isLocalHost(hostname);
}

function normalizeState(value) {
  return value === "maximized" ? "maximized" : "normal";
}

function normalizeDimension(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function buildWindowStateScript({ state, width, height }) {
  const safeState = state === "maximized" ? "maximized" : "normal";

  return `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TceTelWindowTools {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
"@

$process = Get-Process -Name "TceTelShell" -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

if (-not $process) {
  @{ ok = $false; reason = "tce_tel_shell_not_found" } | ConvertTo-Json -Compress
  exit 0
}

$hwnd = [IntPtr]$process.MainWindowHandle
$state = "${safeState}"

if ($state -eq "maximized") {
  [TceTelWindowTools]::ShowWindowAsync($hwnd, 3) | Out-Null
  [TceTelWindowTools]::SetForegroundWindow($hwnd) | Out-Null
  @{ ok = $true; state = "maximized"; processId = $process.Id } | ConvertTo-Json -Compress
  exit 0
}

[TceTelWindowTools]::ShowWindowAsync($hwnd, 9) | Out-Null

$width = ${width}
$height = ${height}
$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$x = [Math]::Max($workingArea.Left, $workingArea.Left + [Math]::Floor(($workingArea.Width - $width) / 2))
$y = [Math]::Max($workingArea.Top, $workingArea.Top + [Math]::Floor(($workingArea.Height - $height) / 2))

[TceTelWindowTools]::SetWindowPos($hwnd, [IntPtr]::Zero, [int]$x, [int]$y, [int]$width, [int]$height, 0x0040) | Out-Null
[TceTelWindowTools]::SetForegroundWindow($hwnd) | Out-Null

@{ ok = $true; state = "normal"; processId = $process.Id; width = $width; height = $height } | ConvertTo-Json -Compress
`;
}

export async function POST(request) {
  if (process.platform !== "win32") {
    return NextResponse.json({ ok: false, reason: "windows_only" }, { status: 200 });
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json({ ok: false, reason: "localhost_only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const state = normalizeState(body?.state);
  const width = normalizeDimension(body?.width, 540, 420, 900);
  const height = normalizeDimension(body?.height, 820, 600, 1100);
  const script = buildWindowStateScript({ state, width, height });

  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        timeout: 7000,
        windowsHide: true,
      }
    );

    const output = stdout.trim();
    const payload = output ? JSON.parse(output) : { ok: true, state };

    return NextResponse.json({
      ...payload,
      warning: stderr?.trim() || undefined,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        reason: "desktop_window_state_failed",
        error: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
