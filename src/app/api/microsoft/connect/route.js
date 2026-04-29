import { NextResponse } from "next/server";
import {
  MICROSOFT_GRAPH_AUTH_COOKIE,
  buildCookieOptions,
  buildMicrosoftAuthorizeUrl,
  createOAuthRequestState,
  encodeAuthCookie,
  hasMicrosoftGraphConfig,
} from "@/lib/microsoftGraph";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!hasMicrosoftGraphConfig()) {
    return NextResponse.redirect(
      new URL("/microsoft/connected?status=error&message=Microsoft%20Graph%20is%20not%20configured%20on%20the%20server.", request.url)
    );
  }

  const authState = createOAuthRequestState();
  const response = NextResponse.redirect(buildMicrosoftAuthorizeUrl(request, authState));
  response.cookies.set(
    MICROSOFT_GRAPH_AUTH_COOKIE,
    encodeAuthCookie(authState),
    buildCookieOptions(60 * 10)
  );

  return response;
}
