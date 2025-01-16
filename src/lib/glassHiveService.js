// src/lib/glassHiveService.js
export async function fetchContactData(phoneNumber) {
    if (!phoneNumber) {
      console.error('No phone number provided to fetch contacts.');
      return;
    }
  
    try {
      const response = await fetch('https://click-to-dial-3252.twil.io/fetchcontacts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: phoneNumber }), // Ensure the body includes phoneNumber
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
  
      const data = await response.json();
      console.log('Fetched contacts:', data);
      return data.contacts;
    } catch (error) {
      console.error('Error fetching contacts from Twilio Function:', error);
      return null;
    }
  }
  