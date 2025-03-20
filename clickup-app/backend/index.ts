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
        const tasksResponse = await axios.get(
            `https://api.clickup.com/api/v2/list/${listId}/task`,
            {
                headers: { Authorization: accessToken },
            }
        );

        res.json(tasksResponse.data.tasks);
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

// Protected endpoint returning ClickUp API data
const getData: RequestHandler = async (_req, res) => {
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        const clickupData = await axios.get('https://api.clickup.com/api/v2/user', {
            headers: { Authorization: accessToken },
        });

        res.json(clickupData.data);
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
