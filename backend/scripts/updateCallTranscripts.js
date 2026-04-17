#!/usr/bin/env node

require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });

const { DynamoDBClient, ScanCommand: RawScanCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require("@aws-sdk/lib-dynamodb");

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

// Realistic call transcript templates by scenario
const TRANSCRIPT_TEMPLATES = {
  "Network Issues": [
    {
      problem: "VoIP drops",
      transcript: `Agent: "Thank you for calling TCE VoiceIQ Support. This is {agent} speaking. How can I help you today?"
Customer: "Hi, we've been experiencing intermittent VoIP drops during peak business hours. Our calls are disconnecting randomly."
Agent: "I'm sorry to hear that. That must be frustrating. Let me pull up your account. Can you tell me approximately when these drops started happening?"
Customer: "It's been happening for about 5 days now, mainly between 9 AM and 3 PM."
Agent: "Alright, thank you. I'm seeing your account is hosted on our premium tier. Let me run a diagnostic on your connection. While that processes, can you tell me what type of internet connection you have? Fiber, cable, or DSL?"
Customer: "We have a dedicated fiber line."
Agent: "Good. One moment... I'm seeing some packet loss on your connection. This could be a routing issue or a firewall configuration problem. Have you made any recent changes to your network or security settings?"
Customer: "No, everything should be the same as before."
Agent: "Perfect. Here's what I recommend: We need to verify your SIP trunk configuration and check if your firewall is potentially blocking certain packets. I'm going to send you a diagnostic package you can run. It will take about 10 minutes."
Customer: "Okay, I'll get one of our IT team to run it."
Agent: "Excellent. Once they run it, we'll have detailed metrics to analyze. In the meantime, I'm going to escalate this to our Network Engineering team and schedule a priority follow-up within 2 hours. Is that timeline okay?"
Customer: "Yes, that works for us. Thank you."
Agent: "You're welcome. You should receive the diagnostic link via email within the next minute. We'll be in touch shortly. Have a great day!"`,
    },
    {
      problem: "Echo and latency",
      transcript: `Agent: "Thanks for calling TCE Support. I'm {agent}. What can I do for you?"
Customer: "Hey, we're experiencing terrible echo on our calls and it seems like there's a delay. This is affecting our customer interactions."
Agent: "That sounds like a frustrating experience. Echo and latency issues can stem from a few different causes. Let me check your setup. What's your customer ID please?"
Customer: "It's ACC-87465."
Agent: "Got it. I'm pulling that up now. How many users are experiencing this, and is it happening on all calls or just specific ones?"
Customer: "It's pretty much everyone on the floor, and it's consistent across all calls we make."
Agent: "Understood. I see you're using IP phones. Which model are you running?"
Customer: "Cisco 8861s."
Agent: "Great phones. Let me check the codec settings on your account. Ah, I see the issue! Your phones are set to use the G.729 codec, which has more latency. I'd like to switch you to G.711, which will eliminate the echo and reduce latency significantly. The only trade-off is a bit more bandwidth usage."
Customer: "Will that cause issues with our internet?"
Agent: "Let me check your connection speed. I'm seeing 100 Mbps, which is more than sufficient for G.711. I'm making the change now... and done! Your phones should re-register within the next 2-3 minutes. Please test a call once they come back online."
Customer: "This is already better! Much clearer."
Agent: "Excellent! That was the fix. I'm also going to enable some QoS settings on your account to prioritize voice traffic during peak times. Is there anything else I can help with?"
Customer: "No, that's great. Thank you!"
Agent: "Perfect. Have a wonderful day!"`,
    },
    {
      problem: "DNS issues",
      transcript: `Agent: "Hello, you've reached TCE VoiceIQ Support. My name is {agent}. What brings you in today?"
Customer: "We're trying to register our new SIP trunk but keep getting a 'domain not found' error."
Agent: "Oh, that's a DNS issue. I can definitely help with that. Can you tell me what domain name you're trying to register?"
Customer: "Sure, it's voip.companydomain.com."
Agent: "Alright. First, let me verify that the domain is active in our system. One moment... I'm checking our DNS records. Yes, I found it. Now, can you tell me what DNS servers your system is querying?"
Customer: "I'm not entirely sure. How do I check that?"
Agent: "No problem. On your phone system or SIP gateway, there's usually a network settings page. You should see Primary DNS and Secondary DNS. Can you check those for me?"
Customer: "Okay, one sec. The primary is 8.8.8.8 and secondary is 8.8.4.4."
Agent: "Ah, there's the issue. You're using Google's public DNS instead of our proprietary DNS servers. Our domain is registered on our internal DNS system. Here are the correct DNS servers you should use."
Customer: "I have them written down."
Agent: "Perfect. Go ahead and update those in your system, and then reboot the gateway or phone system to flush the DNS cache."
Customer: "Doing it now... rebooting."
Agent: "Great. Give it about 90 seconds. While we wait, have you done any testing with your provider to make sure the SIP credentials are correct?"
Customer: "Yes, we tested them before and they were fine."
Agent: "Excellent. The reboot should be done now. Try registering again."
Customer: "It's working! We're registered."
Agent: "Fantastic! You should be all set. Your extension should now be able to make and receive calls. Let me know if you hit any other issues!"
Customer: "Thanks so much!"
Agent: "Anytime! Have a great day!"`,
    },
  ],
  "Account Setup": [
    {
      problem: "New user setup",
      transcript: `Agent: "Welcome to TCE VoiceIQ! You've reached {agent}. Congrats on getting set up with us. How can I help?"
Customer: "Hi! We just purchased the service and need help setting up extensions for our team. We have about 15 people."
Agent: "Excellent! I'm excited to help you get your team up and running. Let me walk you through the process. First, I'll need your account confirmation number."
Customer: "It's TCE-2026-45823."
Agent: "Perfect, I have your account open. I can see you're on our Enterprise plan with 20 extension licenses, which is great! For 15 users, you'll have room to grow. Let me set up your first extension. What's the name of your first user?"
Customer: "That's Sarah Chen, our office manager."
Agent: "Great. And what's her extension number preference?"
Customer: "Can we do 100?"
Agent: "Absolutely, extension 100 is available and reserved for Sarah. I've created her profile. Now, I'll need to send her a welcome email with her login credentials and a link to download our mobile app. What's her email?"
Customer: "sarah.chen@ourcompany.com"
Agent: "Done. She should receive that within the next minute. For the remaining 14 users, I can either set them up individually with you now, or I can create a template and have each user complete their own setup in about 2 minutes through our self-service portal. What would you prefer?"
Customer: "How about we do the self-service option to speed things up?"
Agent: "Smart thinking! I'm activating that now. You'll receive an admin link where you can add user email addresses in bulk. They'll each get a personalized invitation. The whole process takes about 5 minutes per user."
Customer: "Perfect. And the phones? Do those need configuration?"
Agent: "Great question. I can either provision them for you as Plug & Play, where they'll automatically configure when connected, or we can do manual configuration. Plug & Play is much faster."
Customer: "Let's do Plug & Play."
Agent: "Excellent choice. What phone models are you deploying?"
Customer: "Cisco 8861s."
Agent: "Those are fantastic phones. I'm provisioning them now. Once your users activate their accounts, they just need to connect their phones to the network and enter their extension and password. Everything else happens automatically."
Customer: "How long does setup take?"
Agent: "The whole process? About 2-3 minutes per phone. You should be fully operational within the hour. I'm also going to send you a quick setup guide and my direct extension in case you hit any snags."
Customer: "This is way easier than I expected!"
Agent: "That's the TCE difference! Enjoy your new system!"`,
    },
  ],
  "Authentication & Access": [
    {
      problem: "Account locked",
      transcript: `Agent: "Thanks for calling TCE Support, this is {agent} speaking. What can I help with?"
Customer: "I'm locked out of my account. I tried resetting my password but nothing is working."
Agent: "I apologize for that frustration. Let me help get you back in. Can you provide me with the email address associated with your account?"
Customer: "It's james.rodriguez@company.com"
Agent: "Thank you. Let me pull that up... I'm seeing your account is indeed locked due to multiple failed login attempts. This is a security feature. I can unlock that for you right now. Just as a security verification, can you tell me the phone number associated with your account?"
Customer: "It's 555-0147 area code 555."
Agent: "Perfect, that matches our records. Unlocked! Now, for the password reset, I'm sending a new reset link to your email. You'll have 24 hours to use it. The link should arrive within the next 60 seconds."
Customer: "Got it! I see the email already."
Agent: "Great! Click that link and create a new password. Remember, it needs to be at least 16 characters with mixed case and a special character."
Customer: "Okay, creating it now... done!"
Agent: "Excellent. Try logging in with your new password."
Customer: "I'm in! Thank you!"
Agent: "Wonderful! Just for your security going forward, I recommend enabling two-factor authentication on your account. Would you like me to walk you through that?"
Customer: "Yes, let's do it."
Agent: "Great decision. Open your account settings and look for the 'Security' section. Can you see that?"
Customer: "Yep, I see it."
Agent: "Perfect. Under Security, click 'Enable 2FA'. You'll get a QR code to scan with your phone. Use Google Authenticator or Microsoft Authenticator."
Customer: "I'm scanning with Google Authenticator now... got it!"
Agent: "Awesome. That code expires every 30 seconds, so you'll need to enter a fresh code each time you log in from a new device. It's extra protection!"
Customer: "This makes me feel much safer."
Agent: "Excellent. You're all set and more secure than ever. Have a fantastic day!"`,
    },
  ],
  "Call Routing & Features": [
    {
      problem: "Call routing issues",
      transcript: `Agent: "Hello! You've reached TCE VoiceIQ Support. This is {agent}. How can I assist you?"
Customer: "Our calls to extension 200 aren't routing correctly. They're going to the wrong department."
Agent: "I see. Let me check your call routing rules. I have your account open. Can you tell me what calls are being routed to extension 200, and where do you want them to go instead?"
Customer: "We're set to route all customer service calls there, but they should go to our support queue instead, which is extension 305."
Agent: "Got it. Let me look at your routing configuration. I'm seeing extension 200 is currently set as the primary destination. Before I make changes, let me ask: are there any after-hours rules or specific caller ID filters you want to apply?"
Customer: "We want customer service calls during business hours to go to 305, but after 5 PM they should route to our voicemail system."
Agent: "Perfect. I'm updating your call routing rules now. Setting extension 305 as the primary destination with business hours: Monday-Friday, 9 AM to 5 PM. And after-hours routing to your voicemail queue."
Customer: "That's exactly what we need."
Agent: "Excellent. These changes are live now. Would you like me to test this with a quick call? We can transfer to extension 200 and verify it goes to 305."
Customer: "That would be great."
Agent: "Perfect. Let me set that up. [Test call transfer complete] That worked flawlessly! Your calls are now routing correctly. Is there anything else you'd like me to configure?"
Customer: "No, that's exactly what we needed. Thanks!"
Agent: "You're welcome! Enjoy your day!"`,
    },
  ],
  "Integration & Compatibility": [
    {
      problem: "Microsoft Teams integration",
      transcript: `Agent: "Thank you for contacting TCE Support. I'm {agent}. What can I do for you today?"
Customer: "We're trying to integrate our VoIP system with Microsoft Teams but we're not seeing the option in our tenant settings."
Agent: "Ah, great question. Teams integration requires a few prerequisites. Let me walk you through this. First, do you have a Teams administrator account with permission to enable third-party integrations?"
Customer: "Yes, I have admin access."
Agent: "Perfect. And you've already licensed our TCE Connector in the Teams Admin Center, correct?"
Customer: "I'm not sure. How do I check that?"
Agent: "No problem. Go to Teams Admin Center, navigate to Manage apps, and search for 'TCE VoiceIQ Connector'. Do you see it there?"
Customer: "Let me look... no, I don't see it."
Agent: "That explains it! You need to first approve our app in your tenant. Go to your organization settings, then app permissions. Search for our connector and click 'Allow'."
Customer: "I'm doing that now..."
Agent: "Perfect. This might take 30 seconds to process. While you wait, let me verify that your Teams licensing includes voice capabilities. I'm checking our backend... yes, I see you have the right licenses."
Customer: "Okay, I approved it and it shows as 'Allowed' now."
Agent: "Excellent! Now go back to the Teams Admin Center and the TCE Connector should appear in your Manage apps section. Can you see it?"
Customer: "Yes! It's there now."
Agent: "Great! Click on it and then click 'Publish' to make it available to all users in your organization."
Customer: "Published! So what happens next?"
Agent: "Now when your users open Teams, they'll see a TCE call control widget in their chat sidebar. They can make and receive calls directly from Teams. Any existing call history will sync automatically."
Customer: "This is perfect! How long does it take to show up for users?"
Agent: "About 5 minutes for everyone to see it. And if you have any issues, feel free to reach out. You're all set!"
Customer: "Thank you so much!"
Agent: "Anytime! Enjoy the integration!"`,
    },
  ],
  "Recording & Compliance": [
    {
      problem: "Call recording storage",
      transcript: `Agent: "Hello, you've reached TCE VoiceIQ Support. This is {agent}. What brings you in today?"
Customer: "We're getting a warning that our call recording storage is over quota. We need more capacity."
Agent: "I see. Let me check your current storage allocation and usage. Can I pull up your account? What's your account ID?"
Customer: "ACC-56234."
Agent: "Perfect. I'm seeing you're on the Standard tier with 500 GB of recording storage, and you're currently at 487 GB used. That's 97% capacity."
Customer: "Yeah, that's the problem. We record everything for compliance purposes, so we need more space."
Agent: "Absolutely. For compliance-heavy operations, we typically recommend the Premium tier with 2 TB, or you can add additional storage blocks. What's your retention requirement? How long do you need to keep recordings?"
Customer: "We need to keep them for 7 years for compliance."
Agent: "Understood. That's a significant volume. At your current usage rate of about 10 GB per week, you'd need approximately 3.5 TB for 7 years. I'd recommend upgrading to our Enterprise plan, which gives you 5 TB and includes automatic archival to cold storage after 90 days, which is much more cost-effective."
Customer: "How much does that change things cost-wise?"
Agent: "Your current tier is $99/month. The Enterprise plan with 5 TB is $249/month, but you get unlimited archival and better retention management. Plus, you'll save money in the long run since you won't need to purchase additional blocks."
Customer: "That makes sense. Let's upgrade."
Agent: "Excellent choice. I'm processing that upgrade now. You'll see the additional storage immediately. I'm also enabling intelligent tiering, so your older recordings automatically move to cheaper cold storage. This happens transparently in the background."
Customer: "When does this take effect?"
Agent: "Right now! Your storage is already expanded. I'm also activating our compliance reporting feature, which will help you meet audit requirements. You'll get monthly reports showing your retention compliance."
Customer: "Perfect! This solves our problem."
Agent: "Great! You're all set. If you ever need more info on compliance features, just reach out!"`,
    },
  ],
  "Performance & Quality": [
    {
      problem: "Quality metrics review",
      transcript: `Agent: "Thanks for calling TCE VoiceIQ Support. This is {agent}. How can I help?"
Customer: "We've noticed our call quality has degraded a bit lately. We want to understand what's happening with jitter and latency."
Agent: "Good observation. Let me pull up your quality metrics. What's your account number?"
Customer: "ACC-34012."
Agent: "I have your account open. Let me check your performance dashboard over the last 7 days. I'm seeing your average latency is running at about 85 milliseconds, and jitter is around 15ms. That's actually quite good, but I see some spikes during peak hours around 2-3 PM daily."
Customer: "What would cause that?"
Agent: "Peak hours can create congestion on shared infrastructure. Do you have other network activity happening around that time? Backups, downloads, video conferencing?"
Customer: "Actually, yes! We do our daily backups at 2 PM."
Agent: "That's likely your culprit. Backups consume significant bandwidth, which crowds out your voice traffic. The fix is to either reschedule backups to off-peak hours, or implement QoS prioritization on your network."
Customer: "QoS sounds better."
Agent: "Smart choice. QoS basically tells your router 'prioritize voice packets over everything else'. I can enable that from my end. Let me also check your codec settings. You're using G.711 which is good for quality. Your bitrate is 64 kbps per call."
Customer: "So with 20 concurrent calls, we're using about 1.28 Mbps just for voice?"
Agent: "Exactly! You're calculating right. For your internet connection, do you have dedicated bandwidth for voice, or is it shared?"
Customer: "It's shared with everything else."
Agent: "Given your 20 concurrent call capacity, I'd recommend at least 10 Mbps dedicated to voice, or 25 Mbps if shared. What's your total internet speed?"
Customer: "We have 100 Mbps."
Agent: "You're in great shape then. Let me enable QoS and low-latency packet prioritization on your account. This will ensure voice always gets priority."
Customer: "How soon will we see improvement?"
Agent: "Immediately. I'm implementing now. After I make these changes, try initiating a call during your backup window tomorrow at 2 PM and let me know if you notice a difference."
Customer: "Will do. Thanks for the detailed explanation!"
Agent: "Anytime! Call us back after you test!"`,
    },
  ],
  "Hardware & Equipment": [
    {
      problem: "Phone registration issues",
      transcript: `Agent: "Hello, you've reached TCE Support. I'm {agent}. What can I help with?"
Customer: "We just got new IP phones and they're not registering to the system. The screen shows 'registration failed'."
Agent: "I see. Let me help you get those phones online. First, what phone model did you receive?"
Customer: "Yealink SIP-T43U"
Agent: "Great phones. And how many did you get?"
Customer: "15 of them"
Agent: "Perfect. The T43U typically needs manual configuration for first-time setup. Can you access one of the phones? We'll use that as an example."
Customer: "Yes, I have one right here."
Agent: "Excellent. Can you access the phone's network settings? Usually press Menu, then Settings, then Network."
Customer: "I'm in. I see IP address, DNS, gateway..."
Agent: "Perfect spot. I need you to verify the IP address is right. What do you see?"
Customer: "192.168.1.105"
Agent: "Good. And your gateway?"
Customer: "192.168.1.1"
Agent: "Looks correct. Now the critical part - I need you to check the SIP Server. Can you see that setting?"
Customer: "It says blank or says nothing. I think that's the issue!"
Agent: "That's exactly it! You need to set the SIP server address. It should be 'sip.tce-voiceiq.com'. Also set the port to 5060."
Customer: "I'm entering that now..."
Agent: "Great. Also, I need you to put in the extension and password. What's the extension you want for this phone?"
Customer: "Let's make it 201."
Agent: "Got it. And I'll need to create the credentials for that extension. Let me set that up on my end. I'm provisioning extension 201 to activate right now. The default password is 1234, but I'd recommend changing it to something more secure once it registers."
Customer: "Should I reboot the phone?"
Agent: "Yes, perfect. Go ahead and save the settings and restart the phone."
Customer: "Rebooting now... [a moment of silence] ...and it's registering! It says 'online'!"
Agent: "Fantastic! You're all set for that one. For the remaining 14 phones, you have two options: repeat this process manually for each one, or I can send you a configuration file that auto-provisions all 14 at once if you have access to your DHCP server."
Customer: "The configuration file option sounds way faster."
Agent: "Smart thinking! I'm preparing that now. I'll email it to you in the next minute. Your IT team can load it onto your DHCP server, and the remaining phones will automatically configure when they boot up."
Customer: "That's perfect!"
Agent: "All done. You should have 15 phones online within 10 minutes. Perfect!"`,
    },
  ],
  "Billing & Reporting": [
    {
      problem: "Invoice discrepancy",
      transcript: `Agent: "Welcome to TCE Support billing team. This is {agent}. How can I assist you?"
Customer: "We received our invoice for this month and it seems higher than expected. Can you review it with me?"
Agent: "Absolutely, I'd be happy to review that. What's your account number?"
Customer: "ACC-12456"
Agent: "I have your account open. Let me pull up your latest invoice. I see your March billing total is $1,850. What were you expecting?"
Customer: "We budgeted for about $1,200 based on our previous invoices."
Agent: "I see a difference. Let me break down what I'm seeing on this invoice. You have your base service at $500, that's correct?"
Customer: "Yes."
Agent: "And then I see an additional charge for 'Premium Recordings Storage' at $350. Do you remember enabling that feature?"
Customer: "Oh! No, I don't think we enabled that. That might be the issue."
Agent: "Let me check the timeline when that was added. I'm seeing it was enabled on March 1st. Did anyone from your team request that?"
Customer: "That wasn't us. Can you remove it?"
Agent: "Absolutely. I'm going to pull that off your account effective immediately. And I'll issue a credit for this month's premium storage charge, which should be about $350."
Customer: "Thank you! What else is on here?"
Agent: "The remainder is your base service, 22 extensions at $45 each, that's $990, plus 50 minutes of overage calling to international numbers at $1.20 per minute comes to $60. That's $1,500 total without the storage charge."
Customer: "What's this international calling? We don't make international calls."
Agent: "Interesting. Let me check the call log. These calls are showing they went to +44 area code, which is the UK. Did anyone on your team call the UK?"
Customer: "Not that I know of. Can you look deeper?"
Agent: "Of course. Let me see which extension these calls originated from. They all came from extension 215. Who's that?"
Customer: "That's Marcus in sales. Let me ask him... [brief pause] ...he says he was testing a call with one of our new UK clients. He didn't realize it would incur charges."
Agent: "Ah, that explains it. Those are legitimate calls then. But note for next time: international calls do incur overage fees at our standard rate. However, I can add an international calling package to your plan that would bundle calls to common countries at a flat rate. Would that interest you?"
Customer: "How much would that be?"
Agent: "Our International Plus package is $149/month and includes 500 minutes to 50 countries. Based on your usage, you'd likely save money on that plan."
Customer: "Let's activate that for next month."
Agent: "Perfect! I'm setting that up. So to summarize, I'm removing the storage charge, crediting you $350, and adding International Plus at $149. Your next month should be around $1,350. Sound good?"
Customer: "Much better! Thank you."
Agent: "You're welcome! Call back anytime!"`,
    },
  ],
  "Emergency & Support": [
    {
      problem: "Service outage response",
      transcript: `Agent: "TCE VoiceIQ Priority Support, this is {agent}. We have you flagged as critical - what's happening?"
Customer: "Our entire phone system is down! All our extensions are offline. We're a call center handling customer support for 500+ contacts daily!"
Agent: "I understand how critical this is. I'm escalating this to Priority 1 immediately. Let me get you connected to our Senior Network Engineer right now. What's your account ID?"
Customer: "ACC-98765. We went down 15 minutes ago."
Agent: "I have your account flagged. I'm seeing you're on our Enterprise tier with 100 extensions. Were there any recent changes to your system, network, or your firewall?"
Customer: "No! Everything was working fine a few minutes ago."
Agent: "Okay. I'm checking your service status on our end. I'm not seeing any outage in our infrastructure. That tells me this is likely a network or connectivity issue on your side. Can you check if your internet connection is still active?"
Customer: "Let me... yes, our internet is working fine. Websites load, email works."
Agent: "Good data point. So it's specific to VoIP. Can you check your SIP gateway or hardware? Is it powered on? Do you see any error lights?"
Customer: "It looks normal, all lights are green."
Agent: "Let me run a traceroute from our platform to your gateway. One moment... I'm getting timeouts. Your gateway isn't responding to our pings. Let me try a different approach... still no response. It seems the gateway has lost connection even though your internet is up."
Customer: "What do we do?"
Agent: "I need you to reboot the gateway. Unplug it from power, wait 30 seconds, then plug it back in."
Customer: "Doing it now... [pause] ...lights are coming back on."
Agent: "Perfect. I'm monitoring our connection to your gateway. I should be seeing it come online in about 60 seconds. [pause] And there it is! Your gateway just registered with our servers. How are your extensions looking?"
Customer: "They're... coming back! Yes! Phones are ringing again!"
Agent: "Excellent! You're back online. Let me do a full diagnostics to make sure everything is stable. [checking] Everything looks perfect. You have full capacity, all 100 extensions are registered, and your call volume is nominal."
Customer: "We're back in business! Thank you so much!"
Agent: "You're welcome. I'm tagging this incident so our network team can review what caused the gateway to disconnect. We'll do a follow-up within 24 hours. In the meantime, if you experience any issues, you have my direct priority line."
Customer: "Will do. Thanks again!"
Agent: "Our pleasure! Stay online!"`,
    },
  ],
};

// Get random transcript based on notes
function generateDetailedTranscript(callRecord) {
  // Extract scenario type from notes
  const notes = callRecord.notes || callRecord.CallNotes || "";
  let scenarioType = "General Support";

  for (const key in TRANSCRIPT_TEMPLATES) {
    if (notes.includes(key)) {
      scenarioType = key;
      break;
    }
  }

  const templates = TRANSCRIPT_TEMPLATES[scenarioType];
  if (!templates || templates.length === 0) {
    return callRecord.callTranscript; // Return existing if no template found
  }

  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
  return randomTemplate.transcript.replace("{agent}", callRecord.agent || "Support Agent");
}

// Scan and update call logs
async function updateCallTranscripts() {
  console.log(`\n📞 Updating call transcripts with realistic conversations...\n`);
  console.log(`📊 Configuration:`);
  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Region: ${process.env.AWS_REGION || "us-east-1"}`);
  console.log(`   Operation: Scan -> Generate -> Update\n`);

  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error("✗ AWS credentials not configured. Please check your .env file.");
    process.exit(1);
  }

  let scannedCount = 0;
  let updatedCount = 0;
  const recordsToUpdate = [];

  try {
    // Scan all records
    console.log(`Scanning ${TABLE_NAME}...`);
    let lastEvaluatedKey = undefined;
    let scanPasses = 0;

    do {
      scanPasses++;
      const params = {
        TableName: TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      };

      const response = await client.send(new ScanCommand(params));

      if (response.Items) {
        scannedCount += response.Items.length;
        console.log(`   Scanned ${response.Items.length} records (total: ${scannedCount})`);

        // Generate detailed transcripts for each
        response.Items.forEach((item) => {
          const detailedTranscript = generateDetailedTranscript(item);
          recordsToUpdate.push({
            ...item,
            callTranscript: detailedTranscript,
            TranscriptContent: detailedTranscript,
          });
        });
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey && scanPasses < 20); // Limit to 20 scans to avoid infinite loop

    console.log(`\n✓ Scanned ${scannedCount} total records\n`);

    // Show sample
    if (recordsToUpdate.length > 0) {
      console.log(`📋 Sample Updated Record (First 500 chars of transcript):`);
      console.log(
        `   ${recordsToUpdate[0].callTranscript.substring(0, 500)}...`
      );
      console.log(`\n${"─".repeat(60)}\n`);
    }

    // Batch update records
    console.log(`Updating records in DynamoDB...`);
    const BATCH_SIZE = 25;

    for (let i = 0; i < recordsToUpdate.length; i += BATCH_SIZE) {
      const batch = recordsToUpdate.slice(i, i + BATCH_SIZE);
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

        updatedCount += batch.length;
        console.log(`✓ Updated ${batch.length} records (Total: ${updatedCount}/${recordsToUpdate.length})`);
      } catch (error) {
        console.error(`✗ Error updating batch at index ${i}:`, error.message);
        throw error;
      }
    }

    console.log(`\n✅ Successfully updated ${updatedCount} call transcripts!\n`);

    // Show statistics
    const transcriptLengths = recordsToUpdate
      .map((r) => (r.callTranscript || "").length)
      .filter((len) => len > 0);
    const avgLength = Math.round(transcriptLengths.reduce((a, b) => a + b, 0) / transcriptLengths.length);

    console.log(`📈 Statistics:`);
    console.log(`   Average Transcript Length: ${avgLength} characters`);
    console.log(`   Shortest Transcript: ${Math.min(...transcriptLengths)} characters`);
    console.log(`   Longest Transcript: ${Math.max(...transcriptLengths)} characters\n`);
  } catch (error) {
    console.error("✗ Failed to update transcripts:", error);
    process.exit(1);
  }
}

updateCallTranscripts();
