import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export function hasConfiguredAws() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } = process.env;
  return Boolean(
    AWS_ACCESS_KEY_ID &&
      AWS_SECRET_ACCESS_KEY &&
      AWS_REGION &&
      AWS_ACCESS_KEY_ID !== "replace_me" &&
      AWS_SECRET_ACCESS_KEY !== "replace_me"
  );
}

export function createDocumentClient() {
  const config = {
    region: process.env.AWS_REGION || "us-east-1",
  };

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return DynamoDBDocumentClient.from(new DynamoDBClient(config));
}

export function missingAwsResponse() {
  return {
    error: "AWS credentials are not configured.",
  };
}
