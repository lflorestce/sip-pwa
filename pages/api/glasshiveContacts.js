// Import the axios library for making HTTP requests
import axios from 'axios';

// Define the API handler
export default async function handler(req, res) {
    // Restrict to GET requests only
    if (req.method === 'GET') {
        try {
            // Make the request to the GlassHive API with the authorization header
            const response = await axios.get('https://rest.api.glasshive.com/partner/v1/contacts', {
                headers: {
                    Authorization: '8d906242-624c-4f19-bdf9-7dd14ca18e49',  // Replace with your actual API key
                    'Cache-Control': 'no-cache',
                },
                // Pass any query parameters received from the frontend
                params: {
                    limit: req.query.limit || 10,
                    properties: req.query.properties || 'Id,Phone',
                },
            });

            // Return the GlassHive API response to the client
            res.status(200).json(response.data);
        } catch (error) {
            console.error('Error fetching contacts from GlassHive:', error);
            res.status(500).json({ error: 'Failed to fetch contacts' });
        }
    } else {
        // Handle non-GET requests with a 405 status
        res.setHeader('Allow', ['GET']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
