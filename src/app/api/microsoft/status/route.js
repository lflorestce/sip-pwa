import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  MICROSOFT_GRAPH_SESSION_COOKIE,
  buildCookieOptions,
  decodeMicrosoftSessionCookie,
  encodeMicrosoftSessionCookie,
  hasMicrosoftGraphConfig,
  refreshMicrosoftAccessToken,
} from "@/lib/microsoftGraph";

export const dynamic = "force-dynamic";

async function fetchGraphMe(accessToken) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Unable to load Microsoft account profile.");
  }

  return payload;
}

export async function GET() {
  try {
    if (!hasMicrosoftGraphConfig()) {
      return NextResponse.json({
        connected: false,
        configured: false,
        profile: null,
        warning: "Microsoft Graph is not configured on the server yet.",
      });
    }

    const cookieStore = cookies();
    const session = decodeMicrosoftSessionCookie(
      cookieStore.get(MICROSOFT_GRAPH_SESSION_COOKIE)?.value
    );

    if (!session?.refreshToken) {
      return NextResponse.json({
        connected: false,
        configured: true,
        profile: null,
      });
    }

    const refreshed = await refreshMicrosoftAccessToken(session);
    const me = await fetchGraphMe(refreshed.accessToken);
    const nextSession = {
      ...refreshed.session,
      account: {
        displayName: me?.displayName || refreshed.session?.account?.displayName || "",
        email:
          me?.mail ||
          me?.userPrincipalName ||
          refreshed.session?.account?.email ||
          "",
      },
    };

    const response = NextResponse.json({
      connected: true,
      configured: true,
      profile: nextSession.account,
      connectedAt: nextSession.connectedAt || null,
      refreshedAt: nextSession.refreshedAt || null,
      scopes: nextSession.scope || "",
    });

    response.cookies.set(
      MICROSOFT_GRAPH_SESSION_COOKIE,
      encodeMicrosoftSessionCookie(nextSession),
      buildCookieOptions()
    );

    return response;
  } catch (error) {
    const response = NextResponse.json({
      connected: false,
      configured: true,
      profile: null,
      warning:
        error instanceof Error
          ? error.message
          : "Microsoft Graph status could not be verified.",
    });
    response.cookies.delete(MICROSOFT_GRAPH_SESSION_COOKIE);
    return response;
  }
}
