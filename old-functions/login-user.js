//https://click-to-dial-3252.twil.io/login-user

const AWS = require('aws-sdk');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.handler = async function (context, event, callback) {
    const dynamo = new AWS.DynamoDB.DocumentClient({
        region: context.AWS_REGION,
        accessKeyId: context.AWS_ACCESS_KEY,
        secretAccessKey: context.AWS_SECRET_KEY,
    });

    const USER_TABLE = 'User';
    const CUSTOMER_TABLE = 'Customer';

    const response = new Twilio.Response();
    response.appendHeader('Access-Control-Allow-Origin', '*');
    response.appendHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (event.httpMethod === 'OPTIONS') {
        return callback(null, response);
    }

    const { Email, Password } = event;

    if (!Email || !Password) {
        response.setStatusCode(400);
        response.setBody(JSON.stringify({ error: 'Email and password are required' }));
        return callback(null, response);
    }

    try {
        const params = {
            TableName: USER_TABLE,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'Email = :email',
            ExpressionAttributeValues: { ':email': Email },
        };

        const result = await dynamo.query(params).promise();
        const user = result.Items[0];

        if (!user) {
            response.setStatusCode(401);
            response.setBody(JSON.stringify({ error: 'Invalid credentials' }));
            return callback(null, response);
        }

        const isPasswordValid = await bcrypt.compare(Password, user.Password);
        if (!isPasswordValid) {
            response.setStatusCode(401);
            response.setBody(JSON.stringify({ error: 'Invalid credentials' }));
            return callback(null, response);
        }

        if (!user.CompanyId) {
            response.setStatusCode(500);
            response.setBody(JSON.stringify({ error: 'CompanyId not found for user' }));
            return callback(null, response);
        }

        const customerParams = {
            TableName: CUSTOMER_TABLE,
            Key: { CustomerId: Number(user.CompanyId) }, // Convert to Number
        };

        console.log('Fetching customer details with params:', customerParams);

        const customerResult = await dynamo.get(customerParams).promise();
        const customer = customerResult.Item;

        if (!customer) {
            response.setStatusCode(500);
            response.setBody(JSON.stringify({ error: 'Customer details not found' }));
            return callback(null, response);
        }

        const token = jwt.sign(
            { userId: user.UserId, email: user.Email },
            context.JWT_SECRET,
            { expiresIn: '8h' }
        );

        response.setStatusCode(200);
        response.setBody(
            JSON.stringify({
                message: 'Login successful',
                token,
                userDetails: {
                    WebRTCName: user.WebRTCName,
                    WebRTCPw: user.WebRTCPw,
                    twAccountSid: customer.twAccountSid,
                    ghToken: customer.GHToken,
                    ghUserID: user.GHUserId,
                    Email: user.Email,
                    FirstName: user.FirstName,
                    LastName: user.LastName,
                },
            })
        );
        callback(null, response);
    } catch (error) {
        console.error('Error during login:', error);
        response.setStatusCode(500);
        response.setBody(JSON.stringify({ error: 'Error during login' }));
        callback(null, response);
    }
};
