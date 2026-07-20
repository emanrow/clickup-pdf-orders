// API base URL. Empty string means same-origin (production, where the backend
// serves the built frontend). In local dev, .env.development points this at
// the backend's own port.
export const API_URL = import.meta.env.VITE_API_URL || '';
