import crypto from "crypto";
import fsSync from "fs";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { spawn } from "child_process";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  createDocumentClient,
  hasConfiguredAws,
  missingAwsResponse,
} from "@/lib/server/dynamoDb";
import {
  buildS3HttpsUrl,
  createS3Client,
  getRecordingContentType,
  getRecordingsBucket,
  sanitizeS3Segment,
} from "@/lib/server/s3Recordings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const CALL_LOGS_TABLE = process.env.CALL_LOGS_TABLE || "CallLogsV2";

function getFfmpegPath() {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }

  const platformPackage =
    process.platform === "win32" && process.arch === "x64"
      ? path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe")
      : "";

  if (platformPackage && fsSync.existsSync(platformPackage)) {
    return platformPackage;
  }

  try {
    return require("@ffmpeg-installer/ffmpeg").path;
  } catch {
    return "ffmpeg";
  }
}

function normalizeFormat(value) {
  return String(value || "mp3").toLowerCase() === "wav" ? "wav" : "mp3";
}

async function listChunkKeys(s3, bucket, sessionId) {
  const prefix = `local-recording-staging/${sessionId}/chunks/`;
  const keys = [];
  let ContinuationToken;

  do {
    const response = await s3
      .listObjectsV2({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken,
      })
      .promise();

    keys.push(
      ...(response.Contents || [])
        .map((item) => item.Key)
        .filter((key) => key && key.endsWith(".webm"))
    );
    ContinuationToken = response.NextContinuationToken;
  } while (ContinuationToken);

  return keys.sort();
}

async function appendS3ObjectToFile(s3, bucket, key, writable) {
  const object = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  if (!object.Body) {
    return;
  }

  await new Promise((resolve, reject) => {
    writable.write(Buffer.from(object.Body), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function combineChunks(s3, bucket, keys, inputPath) {
  const writable = createWriteStream(inputPath);

  try {
    for (const key of keys) {
      await appendS3ObjectToFile(s3, bucket, key, writable);
    }
  } finally {
    await new Promise((resolve, reject) => {
      writable.end((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function runFfmpeg({ inputPath, outputPath, format }) {
  const args =
    format === "wav"
      ? ["-y", "-i", inputPath, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", outputPath]
      : ["-y", "-i", inputPath, "-vn", "-acodec", "libmp3lame", "-b:a", "128k", outputPath];

  await new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function updateCallLogRecording({ callLogId, recordingUrl, finalKey, format, status }) {
  if (!callLogId) {
    return;
  }

  const client = createDocumentClient();
  const maxAttempts = 20;
  const delayMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await client.send(
        new UpdateCommand({
          TableName: CALL_LOGS_TABLE,
          Key: {
            TranscriptId: callLogId,
          },
          UpdateExpression: `
            SET CallRecordingId = :recordingUrl,
                RecordingStorage = :storage,
                RecordingFormat = :format,
                RecordingFinalizationStatus = :status,
                RecordingS3Key = :key,
                UpdatedAt = :updatedAt
          `,
          ExpressionAttributeValues: {
            ":recordingUrl": recordingUrl,
            ":storage": "local-browser-s3",
            ":format": format,
            ":status": status,
            ":key": finalKey,
            ":updatedAt": new Date().toISOString(),
          },
          ConditionExpression: "attribute_exists(TranscriptId)",
        })
      );
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn("Recording finalized, but call log update failed:", error);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  const tempDir = path.join(os.tmpdir(), `voiceiq-recording-${crypto.randomUUID()}`);

  try {
    const body = await request.json();
    const sessionId = sanitizeS3Segment(body?.sessionId, "");
    const callLogId = sanitizeS3Segment(body?.callLogId || sessionId, "");
    const twAccountSid = sanitizeS3Segment(body?.twAccountSid, "unknown-account");
    const userId = sanitizeS3Segment(body?.userId || body?.email, "unknown-user");
    const format = normalizeFormat(body?.format);

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required." },
        { status: 400 }
      );
    }

    const bucket = getRecordingsBucket();
    const s3 = createS3Client();
    const chunkKeys = await listChunkKeys(s3, bucket, sessionId);

    if (!chunkKeys.length) {
      return NextResponse.json(
        { error: "No recording chunks were found for this session." },
        { status: 404 }
      );
    }

    await fs.mkdir(tempDir, { recursive: true });
    const inputPath = path.join(tempDir, `${sessionId}.webm`);
    const outputPath = path.join(tempDir, `${sessionId}.${format}`);

    await combineChunks(s3, bucket, chunkKeys, inputPath);
    await runFfmpeg({ inputPath, outputPath, format });

    const finalKey = `local-recordings/${twAccountSid}/${userId}/${callLogId}.${format}`;
    const finalBuffer = await fs.readFile(outputPath);

    await s3
      .putObject({
        Bucket: bucket,
        Key: finalKey,
        Body: finalBuffer,
        ContentType: getRecordingContentType(format),
        Metadata: {
          sessionid: sessionId,
          calllogid: callLogId,
        },
      })
      .promise();

    const recordingUrl = buildS3HttpsUrl(bucket, finalKey);
    await updateCallLogRecording({
      callLogId,
      recordingUrl,
      finalKey,
      format,
      status: "completed",
    });

    return NextResponse.json({
      success: true,
      recordingUrl,
      bucket,
      key: finalKey,
      format,
      chunkCount: chunkKeys.length,
    });
  } catch (error) {
    console.error("Recording finalization failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Recording finalization failed.",
      },
      { status: 500 }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
