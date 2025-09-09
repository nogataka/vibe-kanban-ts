// API configuration
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// For development, the Vite proxy will handle /api routes
// In production, this should be configured properly
export const API_ENDPOINT = import.meta.env.PROD ? API_BASE_URL : '';