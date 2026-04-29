import { NextResponse } from "next/server";
import {
  MICROSOFT_GRAPH_AUTH_COOKIE,
  MICROSOFT_GRAPH_SESSION_COOKIE,
} from "@/lib/microsoftGraph";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ disconnected: true });
  response.cookies.delete(MICROSOFT_GRAPH_AUTH_COOKIE);
  response.cookies.delete(MICROSOFT_GRAPH_SESSION_COOKIE);
  return response;
}
