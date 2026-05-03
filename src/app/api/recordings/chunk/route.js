import { NextResponse } from "next/server";
import { hasConfiguredAws, missingAwsResponse } from "@/lib/server/dynamoDb";
import {
  createS3Client,
  getRecordingsBucket,
  sanitizeS3Segment,
} from "@/lib/server/s3Recordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseChunkIndex(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk");
    const sessionId = sanitizeS3Segment(formData.get("sessionId"), "");
    const chunkIndex = parseChunkIndex(formData.get("chunkIndex"));

    if (!sessionId || chunkIndex === null || !chunk || typeof chunk.arrayBuffer !== "function") {
      return NextResponse.json(
        { error: "sessionId, chunkIndex, and chunk file are required." },
        { status: 400 }
      );
    }

    const bucket = getRecordingsBucket();
    const s3 = createS3Client();
    const key = `local-recording-staging/${sessionId}/chunks/${String(chunkIndex).padStart(6, "0")}.webm`;
    const buffer = Buffer.from(await chunk.arrayBuffer());

    await s3
      .putObject({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: chunk.type || "audio/webm",
        Metadata: {
          sessionid: sessionId,
          chunkindex: String(chunkIndex),
        },
      })
      .promise();

    return NextResponse.json({
      success: true,
      bucket,
      key,
      chunkIndex,
      size: buffer.length,
    });
  } catch (error) {
    console.error("Recording chunk upload failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Recording chunk upload failed.",
      },
      { status: 500 }
    );
  }
}
