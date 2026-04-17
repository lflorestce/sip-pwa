import { DynamoDBClient, ScanCommand as RawScanCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";
import {
  buildAgentBreakdown,
  buildCallLogMetrics,
  buildDailyVolume,
  normalizeCallLog,
} from "@/lib/callLogTransforms";

export const dynamic = "force-dynamic";

const TABLE_NAME = process.env.CALL_LOGS_TABLE || "CallLogsV2";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const SCAN_BATCH_SIZE = 100;
const MAX_SCAN_PASSES = 20;

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

function parsePageSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(MAX_PAGE_SIZE, Math.floor(parsed));
}

function decodeCursor(cursor) {
  if (!cursor) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(cursor, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

function encodeCursor(key) {
  if (!key) {
    return null;
  }

  return Buffer.from(JSON.stringify(key)).toString("base64");
}

function buildSampleKeys(items) {
  return [...new Set(items.flatMap((item) => Object.keys(item || {})))].sort();
}

function matchesFilters(log, filters) {
  const { startDate, endDate, search } = filters;

  const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
  const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() : null;
  const query = search.trim().toLowerCase();

  const matchesStart = start === null || log.startedAtEpoch >= start;
  const matchesEnd = end === null || log.startedAtEpoch <= end;
  const searchable = [
    log.agent,
    log.from,
    log.to,
    log.customer,
    log.status,
    log.disposition,
    log.id,
    log.direction,
  ]
    .join(" ")
    .toLowerCase();
  const matchesSearch = !query || searchable.includes(query);

  return matchesStart && matchesEnd && matchesSearch;
}

async function describeTable(client) {
  try {
    const response = await client.send(new RawScanCommand({ TableName: TABLE_NAME, Limit: 1 }));
    return {
      sampleKeys: buildSampleKeys(response.Items || []),
    };
  } catch {
    return {
      sampleKeys: [],
    };
  }
}

async function fetchCallLogs({ cursor, pageSize, startDate, endDate, search }) {
  if (!hasConfiguredAws()) {
    return {
      logs: [],
      warning: "AWS credentials are not configured. Set valid AWS env values to load CallLogsV2.",
      nextCursor: null,
      sampleKeys: [],
    };
  }

  const client = createDocumentClient();
  const filters = {
    startDate: startDate || "",
    endDate: endDate || "",
    search: search || "",
  };
  const matchedItems = [];
  const sampledItems = [];
  let exclusiveStartKey = decodeCursor(cursor);
  let scanPasses = 0;
  let lastEvaluatedKey = exclusiveStartKey;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: SCAN_BATCH_SIZE,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    if (response.Items?.length) {
      sampledItems.push(...response.Items.slice(0, Math.max(0, 25 - sampledItems.length)));

      const normalizedBatch = response.Items
        .map((item, index) => normalizeCallLog(item, index))
        .filter((log) => matchesFilters(log, filters));

      matchedItems.push(...normalizedBatch);
    }

    exclusiveStartKey = response.LastEvaluatedKey;
    lastEvaluatedKey = response.LastEvaluatedKey;
    scanPasses += 1;
  } while (exclusiveStartKey && matchedItems.length < pageSize && scanPasses < MAX_SCAN_PASSES);

  const logs = matchedItems
    .sort((left, right) => right.startedAtEpoch - left.startedAtEpoch);

  const pageLogs = logs.slice(0, pageSize);
  const diagnostics = sampledItems.length ? { sampleKeys: buildSampleKeys(sampledItems) } : await describeTable(client);

  return {
    logs: pageLogs,
    nextCursor: encodeCursor(lastEvaluatedKey),
    sampleKeys: diagnostics.sampleKeys,
    scannedCount: matchedItems.length,
    scanPasses,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const pageSize = parsePageSize(searchParams.get("pageSize"));
    const cursor = searchParams.get("cursor");
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";
    const search = searchParams.get("search") || "";
    const { logs, warning, nextCursor, sampleKeys, scannedCount, scanPasses } = await fetchCallLogs({
      cursor,
      pageSize,
      startDate,
      endDate,
      search,
    });
    const metrics = buildCallLogMetrics(logs);
    const dailyVolume = buildDailyVolume(logs, 14);
    const topAgents = buildAgentBreakdown(logs, 5);

    return NextResponse.json({
      logs,
      metrics,
      dailyVolume,
      topAgents,
      warning: warning || null,
      meta: {
        tableName: TABLE_NAME,
        recordCount: logs.length,
        pageSize,
        nextCursor,
        filters: {
          startDate,
          endDate,
          search,
        },
        schemaDiagnostics: {
          sampleKeys,
        },
        scannedCount,
        scanPasses,
      },
    });
  } catch (error) {
    console.error("Failed to load call logs from DynamoDB", error);
    return NextResponse.json(
      {
        error: "Unable to load call logs from DynamoDB.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
