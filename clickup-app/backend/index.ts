import express from 'express';
import type { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { generatePdf } from './generatePdf.js';
import fs from 'fs';
import { exec } from "child_process";
import path from "path";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL }));


// ClickUp OAuth URLs
const CLIENT_ID = process.env.CLICKUP_CLIENT_ID!;
const CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CLICKUP_REDIRECT_URI!;
const ORDER_TYPE_LIST_ID = process.env.ORDER_TYPE_LIST_ID!;
const ER_TYPE_LIST_ID = process.env.ER_TYPE_LIST_ID!;
let accessToken = '';

const generatePdfHandler: RequestHandler = async (req, res) => {
    try {
        if (!req.body) {
            res.status(400).send("Missing request body");
            return;
        }

        console.log("Generating PDF with data:", req.body);
        const pdfPath = await generatePdf(req.body);

        // Ensure the file exists before sending
        if (!fs.existsSync(pdfPath)) {
            console.error('PDF file not found:', pdfPath);
            res.status(500).send('Failed to generate PDF');
            return;
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=Title_Report_Order.pdf');

        // Stream the PDF file
        const stream = fs.createReadStream(pdfPath);
        stream.pipe(res);

        // Delete the file after streaming
        stream.on('close', () => {
            fs.unlink(pdfPath, (err) => {
                if (err) console.error("Error deleting PDF:", err);
            });
        });

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).send('Error generating PDF');
    }
};


app.post('/api/generate-pdf', generatePdfHandler);

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

// Get complete data for Order Sheet, including Title Scope & E&Rs descriptions
const getOrderSheetFull = (async (req: Request<{ taskId: string }>, res: Response) => {
    if (!accessToken) {
        return res.status(401).send('Not authenticated');
    }

    const { taskId } = req.params;

    try {
        // Fetch the Order Sheet task details
        const orderTask = await clickupGet(`/task/${taskId}`);

        // Fetch validation descriptions
        const { orderTypeDescriptions, erTypeDescriptions } = await fetchValidationDescriptions();

        // Extract linked "Title Scope (Validated)" and "E&Rs (Validated)" IDs
        const getLinkedTaskIds = (fieldName: string) => {
            const field = orderTask.custom_fields.find((f: any) => f.name.includes(fieldName));
            return field?.value?.map((item: any) => item.id) || [];
        };

        const titleScopeIds = getLinkedTaskIds("Title Scope");
        const erScopeIds = getLinkedTaskIds("E&Rs");

        // Map IDs to descriptions
        const titleScopeDescriptions = titleScopeIds.map((id: string) => orderTypeDescriptions[id] || "—");
        const erScopeDescriptions = erScopeIds.map((id: string) => erTypeDescriptions[id] || "—");

        // Find the relationship field for parcels
        const relationshipField = orderTask.custom_fields.find(
            (field: any) => field.type === 'list_relationship'
        );

        // Fetch related Parcel Tasks
        const parcelIds = relationshipField?.value?.map((p: any) => p.id) || [];
        const parcelPromises = parcelIds.map((id: string) => clickupGet(`/task/${id}`));
        const parcels = await Promise.all(parcelPromises);

        return res.json({
            orderTask,
            parcels,
            titleScopeDescriptions,
            erScopeDescriptions
        });
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

// Fetch Order Type Parameters and E&R Type Parameters
const fetchValidationDescriptions = async () => {
    try {
        const [orderTypeTasks, erTypeTasks] = await Promise.all([
            clickupGet(`/list/${ORDER_TYPE_LIST_ID}/task`),
            clickupGet(`/list/${ER_TYPE_LIST_ID}/task`)
        ]);

        const extractDescriptions = (tasks: any) =>
            tasks.tasks.reduce((acc: Record<string, string>, task: any) => {
                const descriptionField = task.custom_fields.find((f: any) => f.name === "Validation Description");
                if (descriptionField && descriptionField.value) {
                    acc[task.id] = descriptionField.value;
                }
                return acc;
            }, {});

        return {
            orderTypeDescriptions: extractDescriptions(orderTypeTasks),
            erTypeDescriptions: extractDescriptions(erTypeTasks),
        };
    } catch (error) {
        console.error("Error fetching validation descriptions:", error);
        return { orderTypeDescriptions: {}, erTypeDescriptions: {} };
    }
};

app.get('/api/data', getData);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
