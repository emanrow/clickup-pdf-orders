import express from 'express';
import type { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import cookieParser from 'cookie-parser';
import { generatePdf } from './generatePdf.js';
import { rateLimiter } from './rateLimiter.js';
import fs from 'fs';
import path from "path";
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
// Railway terminates TLS at its proxy; needed so secure cookies work
app.set('trust proxy', 1);
// Avoid 304 + ETag on JSON APIs — browsers/axios often leave the body empty on 304, breaking clients.
app.set('etag', false);
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

/**
 * Statuses for Title *Report* tasks (parcels) — NOT for order forms in the orders list.
 * Env unset → default one allowed label "to order" (matches ClickUp `parcel.status.status`).
 * Env empty string → no parcel status filter (include all linked reports).
 */
const parseTitleReportAllowedStatuses = (): string[] => {
    const raw = process.env.TITLEORDER_ALLOWED_STATUSES;
    if (raw === undefined) {
        return ['to order'];
    }
    return raw.split(',').map(s => s.trim()).filter(Boolean);
};

const statusMatchesAllowedList = (taskStatus: string, allowedStatuses: string[]): boolean => {
    if (allowedStatuses.length === 0) return true;
    const normalized = taskStatus.trim().toLowerCase();
    return allowedStatuses.some(a => a.toLowerCase() === normalized);
};

/** `task.status.status` from ClickUp (e.g. title report parcels). */
const getTaskStatusLabel = (task: any): string => {
    const s = task?.status;
    if (s == null) return '';
    if (typeof s === 'string') return s.trim();
    if (typeof s === 'object') {
        return String((s as { status?: string }).status ?? '').trim();
    }
    return '';
};

/** Order form task must belong to TITLEORDER_LIST_ID (never filter order forms by title report status). */
const isOrderFormInTitleOrdersList = (task: any): boolean => {
    const listId = process.env.TITLEORDER_LIST_ID;
    if (!listId) return true;
    if (task.list?.id == null) return true;
    return String(task.list.id) === String(listId);
};

// Helper function for ClickUp API calls with rate limiting and retry logic
const clickupGet = async (endpoint: string, accessToken: string, retryCount = 0): Promise<any> => {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second base delay

    try {
        // Apply rate limiting (use path without query string for stable bucketing)
        const endpointKey = endpoint.split('?')[0];
        await rateLimiter.recordRequest(endpointKey);

        const response = await axios.get(`https://api.clickup.com/api/v2${endpoint}`, {
            headers: { Authorization: accessToken }
        });
        return response.data;
    } catch (error: any) {
        // Check if it's a rate limit error
        if (error.response?.status === 429 ||
            (error.response?.data?.err === 'Rate limit reached' && error.response?.data?.ECODE === 'APP_002')) {

            if (retryCount < maxRetries) {
                // Exponential backoff with jitter
                const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
                console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);

                await new Promise(resolve => setTimeout(resolve, delay));
                return clickupGet(endpoint, accessToken, retryCount + 1);
            } else {
                console.error(`Rate limit exceeded after ${maxRetries} retries for endpoint: ${endpoint}`);
                throw new Error('Rate limit exceeded. Please try again later.');
            }
        }

        // Re-throw non-rate-limit errors
        throw error;
    }
};

/** Fetch every task in a list, following ClickUp's 100-per-page pagination. */
const fetchAllListTasks = async (listId: string, accessToken: string, extraQuery = ''): Promise<any[]> => {
    let allTasks: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
        const tasksResponse = await clickupGet(`/list/${listId}/task?page=${page}${extraQuery}`, accessToken);
        const batch = tasksResponse.tasks || [];
        allTasks = allTasks.concat(batch);
        hasMore = batch.length === 100; // ClickUp returns max 100 tasks per page
        page++;
    }

    return allTasks;
};

const generatePdfHandler: RequestHandler = async (req, res) => {
    // PDF generation shells out to pdflatex, so keep it behind authentication
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        if (!req.body) {
            res.status(400).send("Missing request body");
            return;
        }

        const taskId = req.body.taskId as string | undefined;
        if (!taskId) {
            res.status(400).send('Missing taskId');
            return;
        }

        const orderTask = await clickupGet(`/task/${taskId}`, accessToken);
        if (!isOrderFormInTitleOrdersList(orderTask)) {
            res.status(403).send('This task is not an order form in the configured title orders list.');
            return;
        }

        const { taskId: _omit, ...bodyRest } = req.body;

        // Format Title Scope and E&Rs data with fallbacks
        const pdfData = {
            ...bodyRest,
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
    if (!listId) {
        res.status(500).send('TITLEORDER_LIST_ID is not configured');
        return;
    }

    try {
        // Order forms only — never filter this list by title report status (reports are parcel tasks).
        const allTasks = await fetchAllListTasks(listId, accessToken);
        res.json(allTasks);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('[titleorder] ClickUp API error:', error.message);
        } else {
            console.error('[titleorder] ClickUp API error:', error);
        }
        res.status(500).send('API Error');
    }
};

app.get('/api/titleorder/tasks', getTitleOrderTasks);

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

        if (!isOrderFormInTitleOrdersList(orderTask)) {
            return res.status(403).send('This task is not an order form in the configured title orders list.');
        }

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

        console.log(`Fetching ${parcelIds.length} parcels with rate limiting...`);

        // Fetch parcels with controlled concurrency to avoid overwhelming the API
        const batchSize = 10; // Process parcels in batches of 10
        let parcels: any[] = [];

        for (let i = 0; i < parcelIds.length; i += batchSize) {
            const batch = parcelIds.slice(i, i + batchSize);
            const batchPromises = batch.map((id: string) => clickupGet(`/task/${id}`, accessToken));

            try {
                const batchResults = await Promise.all(batchPromises);
                parcels = parcels.concat(batchResults);

                // Log progress
                console.log(`Fetched ${parcels.length}/${parcelIds.length} parcels`);

                // Small delay between batches to be gentle on the API
                if (i + batchSize < parcelIds.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.error(`Error fetching parcel batch ${i}-${i + batchSize}:`, error);
                // Continue with other batches even if one fails
            }
        }

        // Add url property to each parcel
        parcels = parcels.map((p: any) => ({
            ...p,
            url: `https://app.clickup.com/t/${p.id}`
        }));

        const reportAllowed = parseTitleReportAllowedStatuses();
        const rawParcelCount = parcels.length;
        if (reportAllowed.length > 0) {
            parcels = parcels.filter((p: any) =>
                statusMatchesAllowedList(getTaskStatusLabel(p), reportAllowed)
            );
        }
        console.log('[order-sheet] title report (parcel) status filter', {
            orderTaskId: taskId,
            TITLEORDER_ALLOWED_STATUSES: process.env.TITLEORDER_ALLOWED_STATUSES ?? '(unset → default to order)',
            allowedReportStatuses: reportAllowed,
            rawParcelCount,
            parcelCountAfterFilter: parcels.length,
            dropped: rawParcelCount - parcels.length
        });

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

// Export functionality endpoints
// Get teams/workspaces for the authenticated user
const getTeams: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    try {
        const teamsData = await clickupGet('/team', accessToken);
        res.json(teamsData.teams);
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

app.get('/api/teams', getTeams);

// Get spaces for a specific team
const getTeamSpaces: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const { teamId } = req.params;

    try {
        const spacesData = await clickupGet(`/team/${teamId}/space`, accessToken);
        res.json(spacesData.spaces);
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

app.get('/api/teams/:teamId/spaces', getTeamSpaces);

// Get folders and lists for a specific space
const getSpaceContents: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const { spaceId } = req.params;

    try {
        const [foldersData, listsData] = await Promise.all([
            clickupGet(`/space/${spaceId}/folder`, accessToken),
            clickupGet(`/space/${spaceId}/list`, accessToken)
        ]);

        res.json({
            folders: foldersData.folders,
            lists: listsData.lists
        });
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

app.get('/api/spaces/:spaceId/contents', getSpaceContents);

// Get lists for a specific folder
const getFolderLists: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const { folderId } = req.params;

    try {
        const listsData = await clickupGet(`/folder/${folderId}/list`, accessToken);
        res.json(listsData.lists);
    } catch (error) {
        console.error('ClickUp API error:', error);
        res.status(500).send('API Error');
    }
};

app.get('/api/folders/:folderId/lists', getFolderLists);

/** Escape a value for CSV: quote when needed, double embedded quotes. */
const csvEscape = (value: any): string => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Export tasks from a specific list as CSV
const exportListTasks: RequestHandler = async (req, res) => {
    const accessToken = getToken(req);
    if (!accessToken) {
        res.status(401).send('Not authenticated');
        return;
    }

    const { listId } = req.params;
    const { format = 'csv' } = req.query;

    try {
        // Fetch all tasks from the list (with pagination)
        const allTasks = await fetchAllListTasks(listId, accessToken, '&include_closed=true');

        if (allTasks.length === 0) {
            res.status(404).send('No tasks found in this list');
            return;
        }

        // Flatten and format task data for export
        const flattenedTasks = allTasks.map(task => {
            const flattened: any = {
                id: task.id,
                name: task.name,
                description: task.description || '',
                status: task.status?.status || '',
                priority: task.priority?.priority || '',
                assignees: task.assignees?.map((a: any) => a.username).join(', ') || '',
                creator: task.creator?.username || '',
                date_created: task.date_created ? new Date(parseInt(task.date_created)).toISOString() : '',
                date_updated: task.date_updated ? new Date(parseInt(task.date_updated)).toISOString() : '',
                due_date: task.due_date ? new Date(parseInt(task.due_date)).toISOString() : '',
                url: task.url || `https://app.clickup.com/t/${task.id}`,
                tags: task.tags?.map((t: any) => t.name).join(', ') || '',
                time_estimate: task.time_estimate || '',
                time_spent: task.time_spent || '',
                custom_fields: {} as Record<string, string>
            };

            // Add custom fields
            if (task.custom_fields) {
                task.custom_fields.forEach((field: any) => {
                    let value = '';
                    if (field.value !== null && field.value !== undefined) {
                        if (Array.isArray(field.value)) {
                            value = field.value.map((v: any) => v.name || v).join(', ');
                        } else if (typeof field.value === 'object') {
                            value = field.value.name || field.value.formatted_address || JSON.stringify(field.value);
                        } else {
                            value = String(field.value);
                        }
                    }
                    flattened.custom_fields[field.name] = value;
                });
            }

            return flattened;
        });

        if (format === 'csv') {
            const baseFields = [
                { id: 'id', title: 'ID' },
                { id: 'name', title: 'Name' },
                { id: 'description', title: 'Description' },
                { id: 'status', title: 'Status' },
                { id: 'priority', title: 'Priority' },
                { id: 'assignees', title: 'Assignees' },
                { id: 'creator', title: 'Creator' },
                { id: 'date_created', title: 'Date Created' },
                { id: 'date_updated', title: 'Date Updated' },
                { id: 'due_date', title: 'Due Date' },
                { id: 'url', title: 'URL' },
                { id: 'tags', title: 'Tags' },
                { id: 'time_estimate', title: 'Time Estimate' },
                { id: 'time_spent', title: 'Time Spent' }
            ];

            // Add custom field names to the fields array (union across all tasks)
            const customFieldNames = new Set<string>();
            flattenedTasks.forEach(task => {
                Object.keys(task.custom_fields).forEach(fieldName => {
                    customFieldNames.add(fieldName);
                });
            });

            // Build the CSV in memory — no shared temp files, so concurrent
            // exports can't collide.
            const headerRow = [
                ...baseFields.map(f => csvEscape(f.title)),
                ...Array.from(customFieldNames).map(csvEscape)
            ].join(',');

            const dataRows = flattenedTasks.map(task => [
                ...baseFields.map(f => csvEscape(task[f.id])),
                ...Array.from(customFieldNames).map(name => csvEscape(task.custom_fields[name] ?? ''))
            ].join(','));

            const csvContent = [headerRow, ...dataRows].join('\r\n');

            const safeListId = String(listId).replace(/[^A-Za-z0-9_-]/g, '_');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="clickup_tasks_${safeListId}.csv"`);
            // UTF-8 BOM so Excel decodes emoji/special characters in ClickUp
            // field names correctly instead of showing mojibake.
            res.send('\uFEFF' + csvContent);
        } else {
            // Return JSON
            res.json({
                listId,
                taskCount: flattenedTasks.length,
                tasks: flattenedTasks
            });
        }

    } catch (error) {
        console.error('Export error:', error);
        res.status(500).send('Export Error');
    }
};

app.get('/api/export/:listId', exportListTasks);

// Rate limiter status endpoint
app.get('/api/rate-limit-status', (req, res) => {
    if (!getToken(req)) {
        res.status(401).send('Not authenticated');
        return;
    }

    const status = rateLimiter.getStatus();
    const timeWindowSeconds = status.timeWindow / 1000;
    const requestsPerMinute = (status.currentCount / timeWindowSeconds) * 60;

    res.json({
        ...status,
        timeWindowSeconds,
        requestsPerMinute: Math.round(requestsPerMinute * 10) / 10, // Round to 1 decimal
        isNearLimit: status.currentCount > 80,
        isAtLimit: status.currentCount >= status.maxRequests,
        remainingRequests: Math.max(0, status.maxRequests - status.currentCount),
        utilizationPercent: Math.round((status.currentCount / status.maxRequests) * 100)
    });
});

// Detailed diagnostic endpoint
app.get('/api/diagnostics', (req, res) => {
    if (!getToken(req)) {
        res.status(401).send('Not authenticated');
        return;
    }

    const status = rateLimiter.getStatus();
    const timeWindowSeconds = status.timeWindow / 1000;
    const requestsPerMinute = (status.currentCount / timeWindowSeconds) * 60;

    res.json({
        rateLimiter: {
            ...status,
            timeWindowSeconds,
            requestsPerMinute: Math.round(requestsPerMinute * 10) / 10,
            isNearLimit: status.currentCount > 80,
            isAtLimit: status.currentCount >= status.maxRequests,
            remainingRequests: Math.max(0, status.maxRequests - status.currentCount),
            utilizationPercent: Math.round((status.currentCount / status.maxRequests) * 100)
        },
        server: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version,
            platform: process.platform
        },
        timestamp: new Date().toISOString()
    });
});

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
