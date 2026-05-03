import crypto from "crypto";
import { GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  createDocumentClient,
  hasConfiguredAws,
  missingAwsResponse,
} from "@/lib/server/dynamoDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const USER_TABLE = process.env.USER_TABLE || "User";
const CUSTOMER_TABLE = process.env.CUSTOMER_TABLE || "Customer";

function normalizeText(value) {
  return String(value || "").trim();
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload, secret, { expiresInSeconds = 28800 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const claims = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsigned}.${signature}`;
}

async function findUserByEmail(client, email) {
  try {
    const response = await client.send(
      new QueryCommand({
        TableName: USER_TABLE,
        IndexName: "EmailIndex",
        KeyConditionExpression: "Email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        Limit: 1,
      })
    );

    if (response.Items?.length) {
      return response.Items[0];
    }
  } catch (error) {
    console.warn("EmailIndex query failed, falling back to scan:", error);
  }

  const response = await client.send(
    new ScanCommand({
      TableName: USER_TABLE,
      FilterExpression: "Email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
      Limit: 1,
    })
  );

  return response.Items?.[0] || null;
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  try {
    const body = await request.json();
    const Email = normalizeText(body?.Email).toLowerCase();
    const Password = String(body?.Password || "");

    if (!Email || !Password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const client = createDocumentClient();
    const user = await findUserByEmail(client, Email);
    const bcryptModule = await import("bcrypt");
    const bcrypt = bcryptModule.default || bcryptModule;

    if (!user || !(await bcrypt.compare(Password, user.Password || ""))) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401 }
      );
    }

    let customer = null;
    if (user.CompanyId) {
      const customerResponse = await client.send(
        new GetCommand({
          TableName: CUSTOMER_TABLE,
          Key: { CustomerId: Number(user.CompanyId) },
        })
      );
      customer = customerResponse.Item || null;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret || secret === "replace_me") {
      return NextResponse.json(
        { error: "JWT_SECRET is not configured." },
        { status: 500 }
      );
    }

    const token = signJwt(
      { userId: user.UserId, email: user.Email },
      secret,
      { expiresInSeconds: 8 * 60 * 60 }
    );

    return NextResponse.json({
      message: "Login successful",
      token,
      userDetails: {
        UserId: user.UserId,
        CompanyId: user.CompanyId,
        WebRTCName: user.WebRTCName,
        WebRTCPw: user.WebRTCPw,
        twAccountSid: customer?.twAccountSid || "",
        Email: user.Email,
        FirstName: user.FirstName,
        LastName: user.LastName,
        OutboundNumber: user.OutboundNumber || "",
        LiveTranscriptEnabled: user.LiveTranscriptEnabled ?? true,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error during login.",
      },
      { status: 500 }
    );
  }
}
