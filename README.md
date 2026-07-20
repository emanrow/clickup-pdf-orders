# ClickUp Title Order Integration

A Vue.js application that integrates with ClickUp to manage title order tasks. The application provides a modern interface for viewing and managing title order tasks from ClickUp, and generates Title Report Order Sheet PDFs via LaTeX.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript
- **Backend**: Node.js + Express + TypeScript
- **Authentication**: ClickUp OAuth 2.0 (per-user tokens stored in signed httpOnly cookies)
- **PDF Generation**: LaTeX (`pdflatex`)

## Deployment (Railway)

The app deploys to [Railway](https://railway.com) as a **single service**: the Dockerfile builds the Vue frontend and the Express backend serves both the static frontend and the API from one URL. The image includes TeX Live so `pdflatex` works in production.

### Steps

1. In Railway, create a new project → **Deploy from GitHub repo** and select this repository. Railway picks up `railway.json` and builds with the root `Dockerfile` automatically.
2. In the service settings, generate a public domain (e.g. `your-app.up.railway.app`).
3. Set the environment variables below on the service (Variables tab).
4. In your [ClickUp app settings](https://app.clickup.com/settings/team/clickup-api), add the production redirect URL: `https://your-app.up.railway.app/api/callback`.
5. Redeploy. Teammates just visit the Railway URL and log in with their own ClickUp accounts.

### Environment variables (production)

```env
CLICKUP_CLIENT_ID=your_client_id
CLICKUP_CLIENT_SECRET=your_client_secret
CLICKUP_REDIRECT_URI=https://your-app.up.railway.app/api/callback
TITLEORDER_LIST_ID=your_list_id
ORDER_TYPE_LIST_ID=your_order_type_list_id
ER_TYPE_LIST_ID=your_er_type_list_id
PARCEL_LIST_NAMES=Title Reports (MTT),Title Reports (Fidelity)
COOKIE_SECRET=some_long_random_string
```

Notes:
- `COOKIE_SECRET` signs the per-user auth cookies — set it to a long random value (e.g. `openssl rand -hex 32`).
- `PORT` is provided by Railway automatically; don't set it.
- `FRONTEND_URL` should **not** be set in production — leaving it unset makes the backend use same-origin redirects and skip CORS, since it serves the frontend itself.

## Local Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- ClickUp API credentials (Client ID and Secret)
- `pdflatex` (TeX Live) on your PATH for PDF generation

### Environment Setup

Create a `.env` file in the `clickup-app/backend` directory:

```env
CLICKUP_CLIENT_ID=your_client_id
CLICKUP_CLIENT_SECRET=your_client_secret
CLICKUP_REDIRECT_URI=http://localhost:3000/api/callback
FRONTEND_URL=http://localhost:5173
TITLEORDER_LIST_ID=your_list_id
ORDER_TYPE_LIST_ID=your_order_type_list_id
ER_TYPE_LIST_ID=your_er_type_list_id
PARCEL_LIST_NAMES=Title Reports (MTT),Title Reports (Fidelity)
COOKIE_SECRET=dev-secret
PORT=3000
```

The frontend's dev API URL is already configured in `clickup-app/frontend/.env.development` (`VITE_API_URL=http://localhost:3000`).

### Installation

1. Install backend dependencies:
```bash
cd clickup-app/backend
npm install
```

2. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

### Running the Application

1. Start the backend server:
```bash
cd clickup-app/backend
npm run dev
```

2. In a new terminal, start the frontend development server:
```bash
cd clickup-app/frontend
npm run dev
```

3. Open your browser and navigate to `http://localhost:5173`

### Testing the production build locally

If you have Docker installed:

```bash
docker build -t clickup-pdf-orders .
docker run --rm -p 3000:3000 --env-file clickup-app/backend/.env clickup-pdf-orders
```

Then open `http://localhost:3000` (note: use a `CLICKUP_REDIRECT_URI` of `http://localhost:3000/api/callback` and unset `FRONTEND_URL` to mimic production).

## Features

- ClickUp OAuth authentication (per-user; safe for concurrent team use)
- View title order tasks from ClickUp
- Order sheet details modal with parcels, Title Scope, and E&Rs
- PDF generation of the Title Report Order Sheet (LaTeX)
- Dark mode interface
- Responsive design

## API Endpoints

- `/api/auth` - Initiates OAuth flow
- `/api/callback` - OAuth callback endpoint
- `/api/titleorder/tasks` - Fetches title order tasks
- `/api/ordersheet/:taskId/full` - Full order sheet data (parcels, scopes)
- `/api/generate-pdf` - Generates and downloads the order sheet PDF
- `/api/data` - Fetches user data
- `/api/health` - Health check (used by Railway)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
