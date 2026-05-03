//https://click-to-dial-postcall-1443.twil.io/gettranscript-nocontact

const got = require('got');
const sgMail = require('@sendgrid/mail');
const OpenAI = require('openai');
const AWS = require('aws-sdk');
const Twilio = require('twilio');

exports.handler = async function (context, event, callback) {
    console.log('Received event (gettranscript-nocontact):', JSON.stringify(event, null, 2));

    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    if (event.request?.method === 'OPTIONS') {
        response.setStatusCode(204);
        return callback(null, response);
    }

    try {
        if (!context.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is not set.');
        }
        if (!context.SENDGRID_API_KEY) {
            throw new Error('SENDGRID_API_KEY is not set.');
        }
        if (!context.SENDGRID_FROM_EMAIL) {
            throw new Error('SENDGRID_FROM_EMAIL is not set.');
        }
        if (!context.ASSEMBLYAI_API_KEY) {
            throw new Error('ASSEMBLYAI_API_KEY is not set.');
        }
        if (!context.AWS_ACCESS_KEY_ID) {
            throw new Error('AWS_ACCESS_KEY_ID is missing.');
        }
        if (!context.AWS_SECRET_ACCESS_KEY) {
            throw new Error('AWS_SECRET_ACCESS_KEY is missing.');
        }
        if (!context.AWS_REGION) {
            throw new Error('AWS_REGION is missing.');
        }

        const transcriptId = event.transcript_id || event.transcriptId;
        if (!transcriptId) {
            throw new Error('Transcript ID missing from the event.');
        }

        const openai = new OpenAI({
            apiKey: context.OPENAI_API_KEY,
        });

        AWS.config.update({
            accessKeyId: context.AWS_ACCESS_KEY_ID,
            secretAccessKey: context.AWS_SECRET_ACCESS_KEY,
            region: context.AWS_REGION,
        });

        const dynamoDB = new AWS.DynamoDB.DocumentClient();

        sgMail.setApiKey(context.SENDGRID_API_KEY);

        console.log('AWS config check:', {
            hasAccessKeyId: !!context.AWS_ACCESS_KEY_ID,
            hasSecretAccessKey: !!context.AWS_SECRET_ACCESS_KEY,
            region: context.AWS_REGION,
        });

        const existingItem = await dynamoDB.get({
            TableName: 'CallLogsV2',
            Key: {
                TranscriptId: transcriptId.toString(),
            },
        }).promise();

        if (!existingItem.Item) {
            throw new Error(`No CallLogsV2 record found for TranscriptId: ${transcriptId}`);
        }

        if (existingItem.Item.TranscriptStatus === 'completed') {
            console.log('Transcript already processed, skipping duplicate webhook:', transcriptId);

            response.setBody({
                success: true,
                message: 'Transcript already processed.',
                transcriptId: transcriptId.toString(),
            });

            return callback(null, response);
        }

        const transcriptResponse = await got(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
            headers: {
                Authorization: `Bearer ${context.ASSEMBLYAI_API_KEY}`,
            },
            responseType: 'json',
        });

        const transcript = transcriptResponse.body;

        if (transcript.status !== 'completed') {
            throw new Error(`Transcript not ready. Status: ${transcript.status}`);
        }

        const rawTranscriptText = transcript.text || 'No transcript text available';
        const transcriptText = rawTranscriptText
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const segments = transcript.utterances || [];
        let labeledTranscriptText = '';

        if (segments.length > 0) {
            segments.forEach((segment) => {
                const speakerColor = segment.speaker === 'A' ? '#e1f5fe' : '#ede7f6';
                const speakerTextColor = segment.speaker === 'A' ? '#0277bd' : '#6a1b9a';
                const speakerBorderColor = segment.speaker === 'A' ? '#b3e5fc' : '#d1c4e9';

                labeledTranscriptText += `<div style="margin-bottom:8px; font-family:Roboto, Arial, sans-serif; font-weight:normal; line-height:1.5;"><span style="display:inline-block; background-color:${speakerColor}; color:${speakerTextColor}; padding:3px 6px; border:1px solid ${speakerBorderColor}; border-radius:3px; margin-right:6px;"><b>Speaker ${segment.speaker}:</b></span>${(segment.text || '')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')}</div>`;
            });
        } else {
            labeledTranscriptText = `<div style="font-family:Roboto, Arial, sans-serif; line-height:1.5;">${transcriptText.replace(/\n/g, '<br>')}</div>`;
        }

        const aiResponse = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: `
You are an IT support operations assistant for TCE Company, a Managed Service Provider (MSP).

Your task is to generate a professional client-facing recap email summarizing a support call.

Rules:
- Use a professional and friendly tone.
- Focus only on facts mentioned in the transcript.
- Do not invent technical actions.
- Clearly distinguish work completed vs next steps.
- If no opportunities are detected, omit that section.
`,
                },
                {
                    role: 'user',
                    content: `
Write a professional client recap email summarizing the services rendered during the support call below.

The email should contain:

Service Summary
- Brief explanation of what the issue/request was.

Work Performed
- Actions taken during the call.

Next Steps / Action Items
- Any pending tasks, monitoring, or follow-ups.

Optional: Opportunities / Recommendations
- Only include if something relevant appears in the transcript.

Transcript:
${rawTranscriptText}`,
                },
            ],
            max_tokens: 700,
        });

        const aiAnalysis = aiResponse.choices[0]?.message?.content || 'No analysis available';

        const updateResult = await dynamoDB.update({
            TableName: 'CallLogsV2',
            Key: {
                TranscriptId: transcriptId.toString(),
            },
            UpdateExpression: `
                SET CallTranscript = :callTranscript,
                    CallTranscriptHtml = :labeledTranscriptText,
                    AIAnalysis = :aiAnalysis,
                    TranscriptStatus = :status,
                    UpdatedAt = :updatedAt
            `,
            ExpressionAttributeValues: {
                ':callTranscript': rawTranscriptText,
                ':labeledTranscriptText': labeledTranscriptText,
                ':aiAnalysis': aiAnalysis,
                ':status': 'completed',
                ':updatedAt': new Date().toISOString(),
            },
            ConditionExpression: 'attribute_exists(TranscriptId)',
            ReturnValues: 'ALL_NEW',
        }).promise();

        const emailRecipient =
            updateResult.Attributes?.LastCallerEmail ||
            event.ghUserEmail ||
            context.DEFAULT_EMAIL_RECIPIENT;

        if (!emailRecipient) {
            throw new Error('No email recipient available.');
        }

        const aiAnalysisHtml = aiAnalysis
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

        const emailContent = `
            <h1>Call Analysis</h1>
            <p>${aiAnalysisHtml}</p>
            <h2>Call Transcript</h2>
            <p><b>Transcript Text:</b></p>
            ${labeledTranscriptText}
        `;

        await sgMail.send({
            to: emailRecipient,
            from: {
                email: context.SENDGRID_FROM_EMAIL,
                name: 'TCE VoiceIQ',
            },
            subject: 'Post-Call Analysis',
            html: emailContent,
        });

        console.log('SUCCESS: Email sent and Dynamo updated for TranscriptId:', transcriptId);

        response.setBody({
            success: true,
            transcriptId: transcriptId.toString(),
            message: 'Transcript and analysis stored and sent successfully.',
        });

        return callback(null, response);
    } catch (error) {
        console.error('Error processing transcript:', error.response?.body || error.message);

        response.setStatusCode(500);
        response.setBody({
            success: false,
            message: error.message,
        });

        return callback(null, response);
    }
};