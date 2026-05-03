//https://click-to-dial-3252.twil.io/create-company

const AWS = require('aws-sdk');
const twilio = require('twilio');

exports.handler = async function (context, event, callback) {
  const dynamo = new AWS.DynamoDB.DocumentClient({
    region: context.AWS_REGION,
    accessKeyId: context.AWS_ACCESS_KEY,
    secretAccessKey: context.AWS_SECRET_KEY,
  });

  const COMPANY_TABLE = 'Customer';
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (event.httpMethod === 'OPTIONS') {
    console.log('Received preflight OPTIONS request.');
    return callback(null, response);
  }

  const {
    CompanyName,
    FriendlyName,
    Address1,
    Address2,
    City,
    State,
    ZipCode,
    GHToken,
    Active,
  } = event;

  try {
    // Generate numeric CustomerId
    const CustomerId = Date.now(); 

    // Build parameters for DynamoDB
    const params = {
      TableName: COMPANY_TABLE,
      Item: {
        CustomerId, // Numeric key
        CompanyName,
        FriendlyName,
        Address1,
        Address2,
        City,
        State,
        ZipCode,
        GHToken,
        Active: Active || true,
        DateCreated: new Date().toISOString(),
        DateUpdated: new Date().toISOString(),
      },
    };

    console.log('Prepared DynamoDB parameters:', JSON.stringify(params, null, 2));

    // Save to DynamoDB
    const dynamoResponse = await dynamo.put(params).promise();
    console.log('DynamoDB put operation successful:', dynamoResponse);

    // Create Twilio subaccount
    const client = twilio(context.ACCOUNT_SID, context.AUTH_TOKEN);
    const twilioAccount = await client.api.accounts.create({ friendlyName: FriendlyName });
    const twAccountSid = twilioAccount.sid;

    // Update DynamoDB with twAccountSid and GHToken
    const updateParams = {
      TableName: COMPANY_TABLE,
      Key: { CustomerId },
      UpdateExpression: 'set twAccountSid = :twAccountSid, GHToken = :GHToken',
      ExpressionAttributeValues: {
        ':twAccountSid': twAccountSid,
        ':GHToken': GHToken,
      },
      ReturnValues: 'UPDATED_NEW',
    };

    const updateResponse = await dynamo.update(updateParams).promise();
    console.log('DynamoDB update operation successful:', updateResponse);

    // Respond with success
    response.setStatusCode(201);
    response.setBody(
      JSON.stringify({
        message: 'Company created successfully.',
        CustomerId,
        twAccountSid,
      })
    );

    console.log('Responding with:', {
      message: 'Company created successfully.',
      CustomerId,
      twAccountSid,
    });

    callback(null, response);
  } catch (error) {
    console.error('Error creating company:', error);

    // Respond with error
    response.setStatusCode(500);
    response.setBody(JSON.stringify({ error: 'Failed to create company.' }));
    callback(null, response);
  }
};