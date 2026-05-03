//https://click-to-dial-postcall-1443.twil.io/assemblyai-webhook-nocontact

const got = require('got');
const Twilio = require('twilio');

const response = new Twilio.Response();

exports.handler = async function (context, event, callback) {
    console.log('Received event (assemblyai-webhook-nocontact):', JSON.stringify(event, null, 2));
    const got = require('got');
    const Twilio = require('twilio');
    const response = new Twilio.Response();

    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.appendHeader('Content-Type', 'application/json');

    if (event.request?.method === 'OPTIONS') {
        response.setStatusCode(204);
        return callback(null, response);
    }

    try {
        const transcriptId = event.transcript_id || event.id;
        const status = event.status;

        if (!transcriptId) {
            throw new Error('No transcript ID received from AssemblyAI webhook.');
        }

        if (!status) {
            throw new Error('No status received from AssemblyAI webhook.');
        }

        console.log(`AssemblyAI webhook received for transcript ${transcriptId} with status ${status}`);

        if (status !== 'completed') {
            if (status === 'error') {
                console.error('AssemblyAI transcript failed:', event.error || 'Unknown AssemblyAI error');
            }

            response.setBody({
                success: true,
                message: `Webhook received. No action taken because status is ${status}.`,
                transcriptId,
                status,
            });

            return callback(null, response);
        }

        const getTranscriptUrl = 'https://click-to-dial-postcall-1443.twil.io/gettranscript-nocontact';

        const result = await got.post(getTranscriptUrl, {
            form: {
                transcript_id: transcriptId,
            },
            responseType: 'text',
        });

        console.log('Triggered /gettranscript-nocontact successfully:', result.body);

        response.setBody({
            success: true,
            message: 'Transcript completion processed successfully.',
            transcriptId,
        });

        return callback(null, response);
    } catch (error) {
        console.error('Error in /assemblyai-webhook-nocontact:', error.response?.body || error.message);

        response.setStatusCode(500);
        response.setBody({
            success: false,
            message: error.message,
        });

        return callback(null, response);
    }
};