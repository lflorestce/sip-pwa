import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  MICROSOFT_GRAPH_AUTH_COOKIE,
  MICROSOFT_GRAPH_SESSION_COOKIE,
  buildCookieOptions,
  decodeAuthCookie,
  encodeMicrosoftSessionCookie,
  exchangeAuthorizationCodeForSession,
  hasMicrosoftGraphConfig,
} from "@/lib/microsoftGraph";

export const dynamic = "force-dynamic";

function buildCompletionUrl(request, status, message = "") {
  const url = new URL("/microsoft/connected", request.url);
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  return url;
}

export async function GET(request) {
  if (!hasMicrosoftGraphConfig()) {
    return NextResponse.redirect(
      buildCompletionUrl(request, "error", "Microsoft Graph is not configured on the server.")
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") || "";
  const state = searchParams.get("state") || "";
  const error = searchParams.get("error") || "";
  const errorDescription = searchParams.get("error_description") || "";
  const cookieStore = cookies();

  if (error) {
    const response = NextResponse.redirect(
      buildCompletionUrl(request, "error", errorDescription || error)
    );
    response.cookies.delete(MICROSOFT_GRAPH_AUTH_COOKIE);
    return response;
  }

  const authCookie = decodeAuthCookie(cookieStore.get(MICROSOFT_GRAPH_AUTH_COOKIE)?.value);
  if (!authCookie || !code || !state || authCookie.state !== state) {
    const response = NextResponse.redirect(
      buildCompletionUrl(request, "error", "Microsoft authentication state could not be verified.")
    );
    response.cookies.delete(MICROSOFT_GRAPH_AUTH_COOKIE);
    return response;
  }

  try {
    const session = await exchangeAuthorizationCodeForSession({
      code,
      verifier: authCookie.verifier,
      request,
    });

    const response = NextResponse.redirect(buildCompletionUrl(request, "success"));
    response.cookies.delete(MICROSOFT_GRAPH_AUTH_COOKIE);
    response.cookies.set(
      MICROSOFT_GRAPH_SESSION_COOKIE,
      encodeMicrosoftSessionCookie(session),
      buildCookieOptions()
    );
    return response;
  } catch (exchangeError) {
    const response = NextResponse.redirect(
      buildCompletionUrl(
        request,
        "error",
        exchangeError instanceof Error ? exchangeError.message : "Microsoft authentication failed."
      )
    );
    response.cookies.delete(MICROSOFT_GRAPH_AUTH_COOKIE);
    return response;
  }
}
