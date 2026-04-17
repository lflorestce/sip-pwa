import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TABLE_NAME = "User";

function hasConfiguredAws() {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } = process.env;
  return (
    AWS_ACCESS_KEY_ID &&
    AWS_SECRET_ACCESS_KEY &&
    AWS_REGION &&
    AWS_ACCESS_KEY_ID !== "replace_me" &&
    AWS_SECRET_ACCESS_KEY !== "replace_me"
  );
}

function createDocumentClient() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    })
  );
}

function normalizeUserProfile(item) {
  if (!item) {
    return null;
  }

  return {
    userId: item.UserId || "",
    firstName: item.FirstName || "",
    lastName: item.LastName || "",
    email: item.Email || "",
    companyId: item.CompanyId || "",
    ghUserId: item.GHUserId || "",
    outboundNumber: item.OutboundNumber || "",
    dateCreated: item.DateCreated || "",
    hasPassword: Boolean(item.Password),
  };
}

async function fetchUserProfile({ userId, email }) {
  if (!hasConfiguredAws()) {
    return {
      profile: null,
      warning: "AWS credentials are not configured. Set valid AWS env values to load the User table.",
    };
  }

  const client = createDocumentClient();

  if (userId) {
    const response = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { UserId: userId },
      })
    );

    if (response.Item) {
      return { profile: normalizeUserProfile(response.Item) };
    }
  }

  if (email) {
    const response = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "Email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        Limit: 1,
      })
    );

    if (response.Items?.length) {
      return { profile: normalizeUserProfile(response.Items[0]) };
    }
  }

  return {
    profile: null,
    warning: "No matching user record was found in the User table.",
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") || "";
    const email = searchParams.get("email") || "";
    const { profile, warning } = await fetchUserProfile({ userId, email });

    return NextResponse.json({
      profile,
      warning: warning || null,
      meta: {
        tableName: TABLE_NAME,
      },
    });
  } catch (error) {
    console.error("Failed to load user profile", error);
    return NextResponse.json(
      {
        error: "Unable to load user profile from DynamoDB.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
