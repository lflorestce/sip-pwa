const { docClient } = require('../config/dynamodb');

// Table Names
const CUSTOMER_TABLE = 'Customer';
const USER_TABLE = 'User';

const getCustomerById = async (customerId) => {
  const params = {
    TableName: CUSTOMER_TABLE,
    Key: { CustomerId: customerId },
  };

  try {
    const data = await docClient.get(params).promise();
    return data.Item;
  } catch (err) {
    console.error('Error fetching customer:', err);
    throw err;
  }
};

const createUser = async (user) => {
  const params = {
    TableName: USER_TABLE,
    Item: user,
  };

  try {
    await docClient.put(params).promise();
    console.log('User created successfully:', user);
  } catch (err) {
    console.error('Error creating user:', err);
    throw err;
  }
};

module.exports = {
  getCustomerById,
  createUser,
};
