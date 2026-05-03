//https://click-to-dial-postcall-1443.twil.io/logcall-nocontact

const got = require('got');
const AWS = require('aws-sdk');
const Twilio = require('twilio');

const response = new Twilio.Response();

exports.handler = async function (context, event, callback) {
    console.log('Received event (logcall-nocontact):', JSON.stringify(event, null, 2));

    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    if (event.request?.method === 'OPTIONS') {
        response.setStatusCode(204);
        return callback(null, response);
    }

    try {
        if (!context.AWS_ACCESS_KEY_ID) {
            throw new Error('AWS_ACCESS_KEY_ID is missing.');
        }
        if (!context.AWS_SECRET_ACCESS_KEY) {
            throw new Error('AWS_SECRET_ACCESS_KEY is missing.');
        }
        if (!context.AWS_REGION) {
            throw new Error('AWS_REGION is missing.');
        }
        if (!context.S3_BUCKET) {
            throw new Error('S3_BUCKET is missing.');
        }
        if (!context.ASSEMBLYAI_API_KEY) {
            throw new Error('ASSEMBLYAI_API_KEY is missing.');
        }
        if (!context.ASSEMBLYAI_WEBHOOK_URL) {
            throw new Error('ASSEMBLYAI_WEBHOOK_URL is missing.');
        }
        if (!event.twAccountSid) {
            throw new Error('twAccountSid is missing from the event.');
        }

        AWS.config.update({
            accessKeyId: context.AWS_ACCESS_KEY_ID,
            secretAccessKey: context.AWS_SECRET_ACCESS_KEY,
            region: context.AWS_REGION,
        });

        const dynamoDB = new AWS.DynamoDB.DocumentClient();
        const s3 = new AWS.S3();

        const startTime = event.starttime || '';
        const endTime = event.endtime || '';
        const duration = event.duration || '';
        const ghUserFirstName = event.ghUserFirstName || '';
        const ghUserLastName = event.ghUserLastName || '';
        const ghUserEmail = event.ghUserEmail || '';
        const postCallNotes = event.postCallNotes || '';
        const postcallOption = event.postcallOption || '';
        const contextNotes = event.context || '';

        const bucket = context.S3_BUCKET;
        const prefix = `${event.twAccountSid}/`;

        const listAllObjects = async (bucketName, prefixPath) => {
            let isTruncated = true;
            let continuationToken;
            let allObjects = [];

            while (isTruncated) {
                const params = {
                    Bucket: bucketName,
                    Prefix: prefixPath,
                };

                if (continuationToken) {
                    params.ContinuationToken = continuationToken;
                }

                const s3Response = await s3.listObjectsV2(params).promise();
                allObjects = allObjects.concat(s3Response.Contents || []);
                isTruncated = s3Response.IsTruncated;
                continuationToken = s3Response.NextContinuationToken;
            }

            return allObjects;
        };

        const data = await listAllObjects(bucket, prefix);

        if (!data.length) {
            throw new Error('No files found at the specified path.');
        }

        const sortedFiles = data.sort(
            (a, b) => new Date(b.LastModified) - new Date(a.LastModified)
        );
        const latestFile = sortedFiles[0];
        const recordingURL = `https://${bucket}.s3.amazonaws.com/${latestFile.Key}`;

        console.log('Most recent recording URL:', recordingURL);

        let transcriptId;
        try {
            const assemblyResponse = await got.post('https://api.assemblyai.com/v2/transcript', {
                json: {
                    audio_url: recordingURL,
                    speaker_labels: true,
                    webhook_url: 'https://click-to-dial-postcall-1443.twil.io/assemblyai-webhook-nocontact',
                },
                headers: {
                    Authorization: context.ASSEMBLYAI_API_KEY,
                    'Content-Type': 'application/json',
                },
                responseType: 'json',
            });

            transcriptId = assemblyResponse.body?.id;

            if (!transcriptId) {
                throw new Error('AssemblyAI did not return a transcript ID.');
            }

            console.log('AssemblyAI transcript created successfully:', transcriptId);
        } catch (error) {
            console.error('Error creating AssemblyAI transcript:', error.response?.body || error.message);
            throw new Error('Failed to create transcript with AssemblyAI.');
        }

        try {
            await dynamoDB.put({
                TableName: 'CallLogsV2',
                Item: {
                    TranscriptId: transcriptId.toString(),
                    ContactId: 'NO_CONTACT',
                    GHContact: 'No Contact Matched',
                    StartTime: startTime,
                    EndTime: endTime,
                    Duration: duration,
                    LastCaller: `${ghUserFirstName} ${ghUserLastName}`.trim(),
                    LastCallerEmail: ghUserEmail,
                    LastCallDate: new Date().toISOString(),
                    CallRecordingId: recordingURL,
                    PostCallNotes: postCallNotes,
                    PostCallOption: postcallOption,
                    Context: contextNotes,
                    CreatedAt: new Date().toISOString(),
                    TranscriptStatus: 'processing',
                },
                ConditionExpression: 'attribute_not_exists(TranscriptId)',
            }).promise();

            console.log('Call log stored successfully in CallLogsV2 for TranscriptId:', transcriptId);
            console.log('Waiting for AssemblyAI webhook to trigger /gettranscript-nocontact.');
        } catch (error) {
            console.error('Error storing call log in DynamoDB:', error.message);
            throw new Error('Failed to store call log in CallLogsV2.');
        }

        response.setBody({
            success: true,
            message: 'Call log stored and transcript processing started successfully.',
            transcriptId: transcriptId.toString(),
        });

        return callback(null, response);
    } catch (error) {
        console.error('Error in /logcall-nocontact:', error.message);

        response.setStatusCode(500);
        response.setBody({
            success: false,
            message: error.message,
        });

        return callback(null, response);
    }
};