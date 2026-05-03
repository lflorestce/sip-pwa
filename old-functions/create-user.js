//https://click-to-dial-3252.twil.io/create-user

const AWS = require('aws-sdk');
const bcrypt = require('bcrypt');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

exports.handler = async function (context, event, callback) {
  const dynamo = new AWS.DynamoDB.DocumentClient({
    region: context.AWS_REGION,
    accessKeyId: context.AWS_ACCESS_KEY,
    secretAccessKey: context.AWS_SECRET_KEY,
  });

  const USER_TABLE = 'User';
  const COMPANY_TABLE = 'Customer';

  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (event.httpMethod === 'OPTIONS') {
    return callback(null, response);
  }

  const { Email, Password, FirstName, LastName, CompanyId, GHUserId, OutboundNumber, GHToken } = event;

  if (!Email || !Password || !FirstName || !LastName || !CompanyId || !GHUserId) {
    console.error('Missing required fields:', { Email, Password, FirstName, LastName, CompanyId, GHUserId });
    response.setStatusCode(400);
    response.setBody(JSON.stringify({ error: 'All fields are required' }));
    return callback(null, response);
  }

  try {
    // Fetch CompanyName and FriendlyName
    const companyParams = {
      TableName: COMPANY_TABLE,
      Key: { CustomerId: parseInt(CompanyId, 10) }, // Convert CustomerId to a number if stored as a number
    };
    console.log('Fetching company data with params:', companyParams);

    const companyData = await dynamo.get(companyParams).promise();
    console.log('Company data fetched:', companyData);

    if (!companyData.Item) {
      console.error(`Company with CustomerId ${CompanyId} not found.`);
      response.setStatusCode(404);
      response.setBody(JSON.stringify({ error: 'Company not found.' }));
      return callback(null, response);
    }

    const { CompanyName, FriendlyName } = companyData.Item;

    // Hash the password
    const hashedPassword = await bcrypt.hash(Password, 10);

    // Generate a random 24-character alphanumeric value for WebRtcPw
    const WebRtcPw = crypto.randomBytes(12).toString('hex');

    const user = {
      UserId: uuidv4(),
      Email,
      Password: hashedPassword,
      FirstName,
      LastName,
      CompanyId: String(CompanyId),
      GHUserId,
      OutboundNumber: OutboundNumber || 'null',
      WebRtcPw,
      DateCreated: new Date().toISOString(),
    };

    const params = {
      TableName: USER_TABLE,
      Item: user,
    };

    console.log('Prepared DynamoDB parameters for User:', JSON.stringify(params, null, 2));
    await dynamo.put(params).promise();
    console.log('User successfully created in DynamoDB:', user);

    // Invoke /create-twaccount
    const twPayload = {
      CustomerId: String(CompanyId),
      CompanyName: FriendlyName || CompanyName,
      ZipCode: '60804',
      GHUserId: GHUserId
    };
    console.log('Invoking /create-twaccount with payload:', twPayload);

    const twAccountResponse = await axios.post(
      'https://click-to-dial-3252.twil.io/create-twaccount',
      twPayload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    console.log('Twilio account creation response:', twAccountResponse.data);

    // Update DynamoDB with twAccountSid and GHToken
    const updateParams = {
      TableName: COMPANY_TABLE,
      Key: { CustomerId: parseInt(CompanyId, 10) },
      UpdateExpression: 'set twAccountSid = :twAccountSid, GHToken = :GHToken',
      ExpressionAttributeValues: {
        ':twAccountSid': twAccountResponse.data.twAccountSid,
        ':GHToken': GHToken,
      },
      ReturnValues: 'UPDATED_NEW',
    };

    const updateResponse = await dynamo.update(updateParams).promise();
    console.log('DynamoDB update operation successful:', updateResponse);

    response.setStatusCode(201);
    response.setBody(
      JSON.stringify({ message: 'User registered successfully and Twilio account created.', UserId: user.UserId })
    );
    callback(null, response);
  } catch (error) {
    console.error('Error registering user:', error);
    response.setStatusCode(500);
    response.setBody(JSON.stringify({ error: 'Error registering user' }));
    callback(null, response);
  }
};