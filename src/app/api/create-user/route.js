import crypto from "crypto";
import { GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  createDocumentClient,
  hasConfiguredAws,
  missingAwsResponse,
} from "@/lib/server/dynamoDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const USER_TABLE = process.env.USER_TABLE || "User";
const COMPANY_TABLE = process.env.CUSTOMER_TABLE || "Customer";

function normalizeText(value) {
  return String(value || "").trim();
}

async function emailAlreadyExists(client, email) {
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

  return Boolean(response.Items?.length);
}

export async function POST(request) {
  if (!hasConfiguredAws()) {
    return NextResponse.json(missingAwsResponse(), { status: 500 });
  }

  try {
    const body = await request.json();
    const Email = normalizeText(body?.Email).toLowerCase();
    const Password = String(body?.Password || "");
    const ConfirmPassword = String(body?.ConfirmPassword || "");
    const FirstName = normalizeText(body?.FirstName);
    const LastName = normalizeText(body?.LastName);
    const CompanyId = normalizeText(body?.CompanyId);

    if (!Email || !Password || !FirstName || !LastName || !CompanyId) {
      return NextResponse.json(
        { error: "Email, password, name, and CompanyId are required." },
        { status: 400 }
      );
    }

    if (ConfirmPassword && Password !== ConfirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match." },
        { status: 400 }
      );
    }

    const client = createDocumentClient();
    const companyResponse = await client.send(
      new GetCommand({
        TableName: COMPANY_TABLE,
        Key: { CustomerId: Number(CompanyId) },
      })
    );

    if (!companyResponse.Item) {
      return NextResponse.json(
        { error: "Company not found." },
        { status: 404 }
      );
    }

    if (await emailAlreadyExists(client, Email)) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const bcryptModule = await import("bcrypt");
    const bcrypt = bcryptModule.default || bcryptModule;
    const WebRTCPw = crypto.randomBytes(12).toString("hex");
    const user = {
      UserId: crypto.randomUUID(),
      Email,
      Password: await bcrypt.hash(Password, 10),
      FirstName,
      LastName,
      CompanyId: String(CompanyId),
      OutboundNumber: normalizeText(body?.OutboundNumber),
      WebRTCName: normalizeText(body?.WebRTCName),
      WebRTCPw,
      DateCreated: now,
      DateUpdated: now,
    };

    await client.send(
      new PutCommand({
        TableName: USER_TABLE,
        Item: user,
        ConditionExpression: "attribute_not_exists(UserId)",
      })
    );

    return NextResponse.json(
      {
        message: "User registered successfully.",
        UserId: user.UserId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error registering user:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Error registering user.",
      },
      { status: 500 }
    );
  }
}
