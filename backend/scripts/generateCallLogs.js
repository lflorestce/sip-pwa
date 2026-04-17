#!/usr/bin/env node

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = process.env.CALL_LOGS_TABLE || "CallLogsV2";

// Initialize DynamoDB Document Client
const config = {
  region: process.env.AWS_REGION || "us-east-1",
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient(config));

// Realistic IT/Telecom Support Scenarios
const SCENARIOS = [
  {
    type: "Network Issues",
    descriptions: [
      "Customer reports intermittent VoIP drops during business hours",
      "Network latency affecting call quality, experiencing echo",
      "Internet connectivity issues causing call disconnections",
      "Firewall blocking SIP traffic to VoIP service",
      "DNS resolution problems preventing service registration",
    ],
    outcomes: ["Resolved", "Escalated to ISP", "Pending Hardware", "Resolved", "Resolved"],
  },
  {
    type: "Account Setup",
    descriptions: [
      "New user setup for enterprise account",
      "Adding extension to existing PBX system",
      "User requesting additional DID numbers",
      "Account migration from legacy system",
      "Setting up busy lamp field (BLF) capabilities",
    ],
    outcomes: ["Completed", "Completed", "Completed", "In Progress", "Completed"],
  },
  {
    type: "Authentication & Access",
    descriptions: [
      "User locked out of account after password reset",
      "Multi-factor authentication setup assistance",
      "API key generation for integration",
      "Permission configuration for team members",
      "Single sign-on setup consultation",
    ],
    outcomes: ["Resolved", "Resolved", "Resolved", "Resolved", "Completed"],
  },
  {
    type: "Integration & Compatibility",
    descriptions: [
      "Integration with Microsoft Teams troubleshooting",
      "CRM integration callback setup issues",
      "CTI integration with phone system",
      "Mobile app synchronization problems",
      "Third-party API authentication failed",
    ],
    outcomes: ["Resolved", "Resolved", "In Progress", "Resolved", "Escalated"],
  },
  {
    type: "Call Routing & Features",
    descriptions: [
      "Call routing to wrong extension configured",
      "Call queuing not working properly",
      "Voicemail setup and configuration",
      "Auto-attendant menu not responding",
      "Call transfer between departments failing",
    ],
    outcomes: ["Resolved", "Resolved", "Resolved", "Resolved", "Resolved"],
  },
  {
    type: "Recording & Compliance",
    descriptions: [
      "Call recording storage quota exceeded",
      "Compliance audit for recorded calls",
      "GDPR data retention policy questions",
      "Recording permission not being honored",
      "Transcription service quality concerns",
    ],
    outcomes: ["Resolved", "Completed", "Informational", "Resolved", "Pending Review"],
  },
  {
    type: "Performance & Quality",
    descriptions: [
      "Call quality metrics showing degradation",
      "Jitter and packet loss investigation",
      "Peak hours performance planning",
      "Bandwidth optimization recommendations",
      "Audio codec selection for better quality",
    ],
    outcomes: ["Resolved", "Informational", "Completed", "Completed", "Resolved"],
  },
  {
    type: "Hardware & Equipment",
    descriptions: [
      "IP phone registration problems",
      "VoIP gateway configuration issues",
      "SIP trunk provisioning assistance",
      "Hardware replacement shipping coordination",
      "Desk phone firmware update deployment",
    ],
    outcomes: ["Resolved", "Resolved", "Completed", "Scheduled", "Completed"],
  },
  {
    type: "Billing & Reporting",
    descriptions: [
      "Invoice discrepancy investigation",
      "Usage report generation request",
      "Cost optimization consultation",
      "Billing cycle extension request",
      "Rate plan upgrade assistance",
    ],
    outcomes: ["Resolved", "Completed", "Informational", "Approved", "Completed"],
  },
  {
    type: "Emergency & Support",
    descriptions: [
      "Service outage incident response",
      "Emergency access to system during crisis",
      "Disaster recovery activation",
      "Priority support escalation",
      "Critical system restoration",
    ],
    outcomes: ["Resolved", "Resolved", "In Progress", "Resolved", "Resolved"],
  },
];

const AGENTS = [
  "Sarah Chen",
  "Michael Rodriguez",
  "Jennifer Park",
  "David Thompson",
  "Emily Watson",
  "James Mitchell",
  "Lisa Anderson",
  "Robert Jackson",
  "Michelle Brown",
  "Kevin O'Neill",
];

const COMPANY_NAMES = [
  "Acme Corporation",
  "TechVentures Inc",
  "Global Solutions Ltd",
  "DataStream Systems",
  "CloudNet Services",
  "InnovateTech Corp",
  "DigitalFirst Co",
  "NextGen Consulting",
  "Apex Technologies",
  "VisionWorks Media",
];

const STATUSES = ["completed", "connected", "answered", "no-answer", "failed"];
const DISPOSITIONS = ["Resolved", "Pending Follow-up", "Escalated", "Informational", "Technical Issue"];

// Helper to generate random phone number
function generatePhoneNumber() {
  const areaCode = Math.floor(Math.random() * 900) + 200;
  const exchange = Math.floor(Math.random() * 900) + 200;
  const line = Math.floor(Math.random() * 9000) + 1000;
  return `+1${areaCode}${exchange}${line}`;
}

// Helper to generate duration with ~2:30 average (150 seconds)
// Range: 10 seconds to 600 seconds (10 minutes)
function generateDuration() {
  // Use weighted distribution to target 2:30 average
  const random = Math.random();
  if (random < 0.15) {
    // 15% very short calls (10-30 sec)
    return Math.floor(Math.random() * 20) + 10;
  } else if (random < 0.35) {
    // 20% short calls (30-60 sec)
    return Math.floor(Math.random() * 30) + 30;
  } else if (random < 0.7) {
    // 35% medium calls (60-180 sec = 1-3 min)
    return Math.floor(Math.random() * 120) + 60;
  } else if (random < 0.9) {
    // 20% longer calls (180-360 sec = 3-6 min)
    return Math.floor(Math.random() * 180) + 180;
  } else {
    // 10% very long calls (360-600 sec = 6-10 min)
    return Math.floor(Math.random() * 240) + 360;
  }
}

// Generate realistic AI analysis
function generateAIAnalysis(scenario, description) {
  const analyses = [
    `Customer issue: ${description}. Agent provided technical guidance and troubleshooting steps. Resolution confirmed by customer. High satisfaction score.`,
    `Support request regarding ${scenario}. Agent identified root cause and provided comprehensive solution. Customer confirmed resolution works as expected.`,
    `Inbound support call for ${scenario.toLowerCase()}. Agent followed escalation procedures appropriately. Issue tracked for follow-up.`,
    `Customer contacted regarding ${description}. Agent demonstrated product knowledge and provided clear next steps. Estimated 48-hour resolution timeline.`,
    `Support interaction: ${scenario}. Agent provided detailed documentation reference and remote assistance. Customer feels confident proceeding independently.`,
  ];
  return analyses[Math.floor(Math.random() * analyses.length)];
}

// Generate call transcript snippets
function generateTranscript(description) {
  const transcripts = [
    `Customer: "${description}". Agent: "I understand your concern. Let me access your account and investigate." ... [Detailed troubleshooting] ... "The issue has been resolved. Let's verify everything is working correctly."`,
    `Agent: "Hello, how can I assist you today?". Customer: "${description}". Agent: "I'll help you with that right away. Here's what we can do..."`,
    `Agent: "Thank you for contacting support. I see you're experiencing ${description.toLowerCase()}. Let me run a diagnostic."`,
    `Customer: "We've been having problems with ${description.toLowerCase()}." Agent: "That's a known issue. Here's the latest resolution from our team..."`,
    `Support Record: ${description}. [Technical walkthrough completed] [Customer satisfied with resolution] [Follow-up scheduled if needed]`,
  ];
  return transcripts[Math.floor(Math.random() * transcripts.length)];
}

// Generate a single call log record
function generateCallLog(index) {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const descIndex = Math.floor(Math.random() * scenario.descriptions.length);
  const description = scenario.descriptions[descIndex];
  const outcome = scenario.outcomes[descIndex];

  // Random timestamp within last 30 days
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 30);
  const hoursAgo = Math.floor(Math.random() * 24);
  const minutesAgo = Math.floor(Math.random() * 60);

  const startTime = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000 - minutesAgo * 60 * 1000);
  const durationSeconds = generateDuration();
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);

  const callId = `call-${Date.now()}-${index}`;
  const fromNumber = generatePhoneNumber();
  const toNumber = generatePhoneNumber();
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const company = COMPANY_NAMES[Math.floor(Math.random() * COMPANY_NAMES.length)];
  const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
  const disposition = DISPOSITIONS[Math.floor(Math.random() * DISPOSITIONS.length)];

  return {
    CallId: callId,
    id: callId,
    TranscriptId: `transcript-${callId}`,
    StartTime: startTime.toISOString(),
    startTime: startTime.toISOString(),
    callStartTime: startTime.toISOString(),
    StartedAt: startTime.toISOString(),
    startedAt: startTime.toISOString(),
    startedAtEpoch: startTime.getTime(),
    EndTime: endTime.toISOString(),
    endTime: endTime.toISOString(),
    EndedAt: endTime.toISOString(),
    endedAt: endTime.toISOString(),
    endedAtEpoch: endTime.getTime(),
    Duration: durationSeconds,
    durationSeconds: durationSeconds,
    billsec: durationSeconds,
    direction: Math.random() > 0.4 ? "Inbound" : "Outbound",
    from: fromNumber,
    fromNumber: fromNumber,
    ani: fromNumber,
    to: toNumber,
    toNumber: toNumber,
    dnis: toNumber,
    LastCaller: agent,
    agent: agent,
    agentName: agent,
    customer: company,
    GHContact: company,
    customerName: company,
    callTranscript: generateTranscript(description),
    TranscriptContent: generateTranscript(description),
    aiAnalysis: generateAIAnalysis(scenario.type, description),
    AIAnalysis: generateAIAnalysis(scenario.type, description),
    TranscriptStatus: status,
    status: status,
    callStatus: status,
    PostCallOption: outcome,
    disposition: outcome,
    callDisposition: outcome,
    notes: `${scenario.type}: ${description}`,
    CallNotes: `${scenario.type}: ${description}`,
    sentiment: Math.random() * 100,
    engagementRate: 50 + Math.random() * 50,
    ContactId: `contact-${Math.floor(Math.random() * 10000)}`,
    RecordingUrl: `https://recordings.example.com/call-${callId}.mp3`,
    createdAt: startTime.toISOString(),
    CreatedAt: startTime.toISOString(),
    updatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString(),
  };
}

// Batch write to DynamoDB
async function batchWriteCallLogs(records) {
  const BATCH_SIZE = 25; // DynamoDB batch write max is 25
  let processed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const requestItems = batch.map((record) => ({
      PutRequest: {
        Item: record,
      },
    }));

    try {
      await client.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: requestItems,
          },
        })
      );

      processed += batch.length;
      console.log(`✓ Inserted ${batch.length} records (Total: ${processed}/${records.length})`);
    } catch (error) {
      console.error(`✗ Error inserting batch at index ${i}:`, error.message);
      throw error;
    }
  }
}

// Main execution
async function main() {
  console.log(`\n📞 Generating 100 realistic IT/Telecom support call logs...\n`);
  console.log(`📊 Configuration:`);
  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Region: ${process.env.AWS_REGION || "us-east-1"}`);
  console.log(`   Credentials: ${process.env.AWS_ACCESS_KEY_ID ? "✓ Configured" : "✗ Not found"}\n`);

  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error("✗ AWS credentials not configured. Please check your .env file.");
    process.exit(1);
  }

  try {
    // Generate 100 call logs
    const callLogs = Array.from({ length: 100 }, (_, index) => generateCallLog(index));

    console.log(`Generated ${callLogs.length} call log records\n`);

    // Display sample
    console.log(`📋 Sample Record:`);
    console.log(JSON.stringify(callLogs[0], null, 2));
    console.log(`\n${"─".repeat(60)}\n`);

    // Insert into DynamoDB
    console.log(`Inserting records into DynamoDB...`);
    await batchWriteCallLogs(callLogs);

    console.log(`\n✅ Successfully inserted ${callLogs.length} call logs to ${TABLE_NAME}!\n`);

    // Show statistics
    const avgDuration = Math.round(callLogs.reduce((sum, log) => sum + log.durationSeconds, 0) / callLogs.length);
    const minDuration = Math.min(...callLogs.map((log) => log.durationSeconds));
    const maxDuration = Math.max(...callLogs.map((log) => log.durationSeconds));

    console.log(`📈 Statistics:`);
    console.log(`   Average Duration: ${Math.floor(avgDuration / 60)}:${String(avgDuration % 60).padStart(2, "0")} (target: 2:30)`);
    console.log(`   Min Duration: ${Math.floor(minDuration / 60)}:${String(minDuration % 60).padStart(2, "0")}`);
    console.log(`   Max Duration: ${Math.floor(maxDuration / 60)}:${String(maxDuration % 60).padStart(2, "0")}`);
    console.log(`   Agents: ${new Set(callLogs.map((log) => log.agent)).size}`);
    console.log(`   Companies: ${new Set(callLogs.map((log) => log.customer)).size}\n`);
  } catch (error) {
    console.error("✗ Failed to generate and insert call logs:", error);
    process.exit(1);
  }
}

main();
