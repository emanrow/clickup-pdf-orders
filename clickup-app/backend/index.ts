import express from 'express';
import type { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import { generatePdf } from './generatePdf.js';
import fs from 'fs';
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
// Railway terminates TLS at its proxy; needed so secure cookies work
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// The dev fallback secret is public (this repo is open source), so cookies
// signed with it are forgeable. Refuse to start in production without a real one.
const COOKIE_SECRET = process.env.COOKIE_SECRET;
if (IS_PROD && !COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET must be set in production (e.g. `openssl rand -hex 32`)');
}
app.use(cookieParser(COOKIE_SECRET || 'dev-secret-change-me'));

// In production the frontend is served by this same server, so CORS is only
// needed for local development where Vite runs on its own port.
if (process.env.FRONTEND_URL) {
    app.use(cors({
        origin: process.env.FRONTEND_URL,
        credentials: true,
        exposedHeaders: ['Content-Disposition']
    }));
}

// ClickUp OAuth URLs
const CLIENT_ID = process.env.CLICKUP_CLIENT_ID!;
const CLIENT_SECRET = process.env.CLICKUP_CLIENT_SECRET!;
const REDIRECT_URI = process.env.CLICKUP_REDIRECT_URI!;
const ORDER_TYPE_LIST_ID = process.env.ORDER_TYPE_LIST_ID!;
const ER_TYPE_LIST_ID = process.env.ER_TYPE_LIST_ID!;

// Each user's ClickUp token lives in their own signed, httpOnly cookie so the
// app can be used by multiple people at once and survives server restarts.
const TOKEN_COOKIE = 'clickup_token';
const getToken = (req: Request): string | undefined => req.signedCookies?.[TOKEN_COOKIE];

const generatePdfHandler: RequestHandler = async (req, res) => {
    // PDF generation shells out to pdflatex, so keep it behind authentication
    if (!getToken(req)) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        if (!req.body) {
            res.status(400).send("Missing request body");
            return;
        }

        // Format Title Scope and E&Rs data with fallbacks
        const pdfData = {
            ...req.body,
            title_scope_items: (req.body.titleScopeDescriptions || []).map((desc: string, i: number) => ({
                name: (req.body.titleScopeNames || [])[i] || '',
                description: desc || ''
            })),
            er_items: (req.body.erScopeDescriptions || []).map((desc: string, i: number) => ({
                name: (req.body.erScopeNames || [])[i] || '',
                description: desc || ''
            }))
        };

        console.log("Generating PDF with data:", pdfData);
        const pdfPath = await generatePdf(pdfData);

        // Sanitize filename for use in Content-Disposition header
        const baseFilename = path.basename(pdfPath);
        const sanitizedFilename = baseFilename
            .replace(/[^\x20-\x7E]/g, '_') // Replace non-ASCII characters
            .replace(/[\\/:*?"<>|]/g, '_'); // Replace invalid filename characters

        // Ensure the file exists before sending
        if (!fs.existsSync(pdfPath)) {
            console.error('PDF file not found:', pdfPath);
            res.status(500).send('Failed to generate PDF');
            return;
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);

        // Stream the PDF file
        const stream = fs.createReadStream(pdfPath);
        stream.pipe(res);

        // Delete the per-request working directory after streaming
        stream.on('close', () => {
            fs.rm(path.dirname(pdfPath), { recursive: true, force: true }, (err) => {
                if (err) console.error("Error deleting PDF work dir:", err);
            });
        });

    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).send('Error generating PDF');
    }
};


app.post('/api/generate-pdf', generatePdfHandler);

app.get('/api/health', (_, res) => {
    res.send('ok');
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

        res.cookie(TOKEN_COOKIE, tokenResponse.data.access_token, {
            httpOnly: true,
            signed: true,
            secure: IS_PROD,
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
        });

        // Redirect frontend to indicate success (relative when served same-origin)
        res.redirect(`${process.env.FRONTEND_URL || ''}/?auth=success`);
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).send('OAuth Error');
    }
});

const getTitleOrderTasks: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const listId = process.env.TITLEORDER_LIST_ID;

    try {
        const tasksResponse = await clickupGet(`/list/${listId}/task`, accessToken);
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
const clickupGet = async (endpoint: string, accessToken: string) => {
    const response = await axios.get(`https://api.clickup.com/api/v2${endpoint}`, {
        headers: { Authorization: accessToken }
    });
    return response.data;
};

// Get complete data for Order Sheet, including Title Scope & E&Rs descriptions
const PARCEL_LIST_NAMES = (process.env.PARCEL_LIST_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
const getOrderSheetFull = (async (req: Request<{ taskId: string }>, res: Response) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        return res.status(401).send('Not authenticated');
    }

    const { taskId } = req.params;

    try {
        // Fetch the Order Sheet task details
        const orderTask = await clickupGet(`/task/${taskId}`, accessToken);

        // Fetch validation descriptions
        const { orderTypeDescriptions, erTypeDescriptions } = await fetchValidationDescriptions(accessToken);

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

        // Aggregate related Parcel Tasks from all relevant fields
        const parcelIds = orderTask.custom_fields
            .filter((field: any) => field.type === 'list_relationship' && PARCEL_LIST_NAMES.includes(field.name))
            .flatMap((field: any) => (Array.isArray(field.value) ? field.value.map((p: any) => p.id) : []));
        const parcelPromises = parcelIds.map((id: string) => clickupGet(`/task/${id}`, accessToken));
        let parcels = await Promise.all(parcelPromises);

        // Add url property to each parcel
        parcels = parcels.map((p: any) => ({
            ...p,
            url: `https://app.clickup.com/t/${p.id}`
        }));

        // Sort parcels alphabetically by name
        parcels.sort((a, b) => {
            const nameA = a.name || '';
            const nameB = b.name || '';
            return nameA.localeCompare(nameB);
        });

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
const getData: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        const clickupData = await clickupGet('/user', accessToken);
        res.json(clickupData);
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

// Fetch Order Type Parameters and E&R Type Parameters
const fetchValidationDescriptions = async (accessToken: string) => {
    try {
        const [orderTypeTasks, erTypeTasks] = await Promise.all([
            clickupGet(`/list/${ORDER_TYPE_LIST_ID}/task`, accessToken),
            clickupGet(`/list/${ER_TYPE_LIST_ID}/task`, accessToken)
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

// Serve the built frontend (single-service deployment). In local dev the
// frontend runs on its own Vite server and this directory won't exist.
const FRONTEND_DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^\/(?!api\/).*/, (_, res) => {
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
} else {
    app.get('/', (_, res) => {
        res.send('Backend server is running!');
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
