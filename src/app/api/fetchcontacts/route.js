import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    contacts: [],
    contact: null,
    matched: false,
    message: "Contact lookup is disabled. Treat this call as no-contact.",
  });
}
