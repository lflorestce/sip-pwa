import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey || apiKey === "replace_me") {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  try {
    const params = new URLSearchParams({
      expires_in_seconds: "60",
      max_session_duration_seconds: "3600",
    });

    const response = await fetch(`${TOKEN_URL}?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          error: "Failed to generate AssemblyAI streaming token.",
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach AssemblyAI streaming token endpoint.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
