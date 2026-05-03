import AWS from "aws-sdk";

const DEFAULT_RECORDINGS_BUCKET = "tce-voice-recordings";

export function getRecordingsBucket() {
  return (
    process.env.RECORDINGS_S3_BUCKET ||
    process.env.S3_BUCKET ||
    DEFAULT_RECORDINGS_BUCKET
  );
}

export function createS3Client() {
  const config = {
    region: process.env.AWS_REGION || "us-east-1",
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    config.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  }

  return new AWS.S3(config);
}

export function sanitizeS3Segment(value, fallback = "unknown") {
  const segment = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._=-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || fallback;
}

export function buildS3HttpsUrl(bucket, key) {
  return `https://${bucket}.s3.amazonaws.com/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

export function getRecordingContentType(format) {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}
