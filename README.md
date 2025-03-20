# ClickUp Title Order Integration

A Vue.js application that integrates with ClickUp to manage title order tasks. The application provides a modern interface for viewing and managing title order tasks from ClickUp.

## Tech Stack

- **Frontend**: Vue 3 + TypeScript
- **Backend**: Node.js + Express + TypeScript
- **Authentication**: ClickUp OAuth 2.0

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- ClickUp API credentials (Client ID and Secret)

## Environment Setup

1. Create a `.env` file in the backend directory with the following variables:
```env
CLICKUP_CLIENT_ID=your_client_id
CLICKUP_CLIENT_SECRET=your_client_secret
CLICKUP_REDIRECT_URI=http://localhost:3000/api/callback
FRONTEND_URL=http://localhost:5173
TITLEORDER_LIST_ID=your_list_id
PORT=3000
```

2. Create a `.env` file in the frontend directory:
```env
VITE_API_URL=http://localhost:3000
```

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd clickup-app
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

## Running the Application

1. Start the backend server:
```bash
cd backend
npm run dev
```

2. In a new terminal, start the frontend development server:
```bash
cd frontend
npm run dev
```

3. Open your browser and navigate to `http://localhost:5173`

## Features

- ClickUp OAuth authentication
- View title order tasks from ClickUp
- Task details modal
- Dark mode interface
- Responsive design

## Development

- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:3000`
- API endpoints:
  - `/api/auth` - Initiates OAuth flow
  - `/api/callback` - OAuth callback endpoint
  - `/api/titleorder/tasks` - Fetches title order tasks
  - `/api/data` - Fetches user data

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 