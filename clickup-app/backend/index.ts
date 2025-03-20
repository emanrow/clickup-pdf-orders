import express from 'express';
import type { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL }));

// ClickUp OAuth URLs
const CLIENT_ID = process.env.CLICKUP_CLIENT_ID!;
const CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CLICKUP_REDIRECT_URI!;
let accessToken = '';

app.get('/', (_, res) => {
    res.send('Backend server is running!');
});

// Initiate OAuth flow
app.get('/api/auth', (_, res) => {
    const authUrl = `https://app.clickup.com/api?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}`;
    res.redirect(authUrl);
});

// OAuth callback to exchange code for token
app.get('/api/callback', async (req, res) => {
    const { code } = req.query;

    try {
        const tokenResponse = await axios.post(
            'https://api.clickup.com/api/v2/oauth/token',
            {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code,
            },
        );

        accessToken = tokenResponse.data.access_token;
        console.log('Received ClickUp access token:', accessToken);

        // Redirect frontend to indicate success
        res.redirect(`${process.env.FRONTEND_URL}?auth=success`);
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).send('OAuth Error');
    }
});

const getTitleOrderTasks: RequestHandler = async (_req, res) => {
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const listId = process.env.TITLEORDER_LIST_ID;

    try {
        const tasksResponse = await clickupGet(`/list/${listId}/task`);
        res.json(tasksResponse.tasks);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('ClickUp API error:', error.message);
        } else {
            console.error('ClickUp API error:', error);
        }
        res.status(500).send('API Error');
    }
};

app.get('/api/titleorder/tasks', getTitleOrderTasks);

// Helper function for ClickUp API calls
const clickupGet = async (endpoint: string) => {
    const response = await axios.get(`https://api.clickup.com/api/v2${endpoint}`, {
        headers: { Authorization: accessToken }
    });
    return response.data;
};

// Get complete data for Order Sheet and related Parcels
const getOrderSheetFull = (async (req: Request<{ taskId: string }>, res: Response) => {
    if (!accessToken) {
        return res.status(401).send('Not authenticated');
    }
  
    const { taskId } = req.params;
    const parcelListId = process.env.ALL_TITLE_ORDERS_LIST_ID;
  
    try {
      // Fetch the Order Sheet task details
      const orderTask = await clickupGet(`/task/${taskId}`);
  
      // Find the relationship custom field ID (e.g., "All Title Orders (Test)")
      const relationshipField = orderTask.custom_fields.find(
        (field: any) => field.type === 'list_relationship'
      );
  
      if (!relationshipField || !relationshipField.value.length) {
        return res.json({ orderTask, parcels: [] }); // No related parcels found
      }
  
      // Fetch each related Parcel Task detail
      const parcelIds = relationshipField.value.map((p: any) => p.id);
      const parcelPromises = parcelIds.map((id: string) => clickupGet(`/task/${id}`));
      const parcels = await Promise.all(parcelPromises);
  
      return res.json({ orderTask, parcels });
    } catch (error: any) {
      console.error('Error fetching Order Sheet:', error.response?.data || error.message);
      return res.status(500).send('API Error');
    }
}) as unknown as RequestHandler<{ taskId: string }>;

app.get('/api/ordersheet/:taskId/full', getOrderSheetFull);

// Protected endpoint returning ClickUp API data
const getData: RequestHandler = async (_req, res) => {
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        const clickupData = await clickupGet('/user');
        res.json(clickupData);
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

app.get('/api/data', getData);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
