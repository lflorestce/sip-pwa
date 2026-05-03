import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  createDocumentClient,
  hasConfiguredAws,
  missingAwsResponse,
} from "@/lib/server/dynamoDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COMPANY_TABLE = process.env.CUSTOMER_TABLE || "Customer";

function normalizeText(value) {
  return String(value || "").trim();
}

async function createTwilioSubaccount(friendlyName) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN || process.env.AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return null;
  }

  const body = new URLSearchParams({
    FriendlyName: friendlyName || "TCE VoiceIQ Customer",
  });

  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts.json", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    let details = "Twilio subaccount creation failed.";
    try {
      const payload = await response.json();
      details = payload?.message || details;
    } catch {
      // Keep fallback.
    }
    throw new Error(details);
  }

  const payload = await response.json();
  return payload?.sid || null;
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  try {
    const body = await request.json();
    const CompanyName = normalizeText(body?.CompanyName);
    const FriendlyName = normalizeText(body?.FriendlyName);

    if (!CompanyName) {
      return NextResponse.json(
        { error: "CompanyName is required." },
        { status: 400 }
      );
    }

    const CustomerId = Date.now();
    const now = new Date().toISOString();
    const twAccountSid = await createTwilioSubaccount(FriendlyName || CompanyName);

    const item = {
      CustomerId,
      CompanyName,
      FriendlyName,
      Address1: normalizeText(body?.Address1),
      Address2: normalizeText(body?.Address2),
      City: normalizeText(body?.City),
      State: normalizeText(body?.State),
      ZipCode: normalizeText(body?.ZipCode),
      Active: body?.Active ?? true,
      DateCreated: now,
      DateUpdated: now,
    };

    if (twAccountSid) {
      item.twAccountSid = twAccountSid;
    }

    const client = createDocumentClient();
    await client.send(
      new PutCommand({
        TableName: COMPANY_TABLE,
        Item: item,
        ConditionExpression: "attribute_not_exists(CustomerId)",
      })
    );

    return NextResponse.json(
      {
        message: "Company created successfully.",
        CustomerId,
        twAccountSid,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating company:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to create company.",
      },
      { status: 500 }
    );
  }
}
