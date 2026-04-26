/**
 * API configuration and token helpers
 */

// Auth Backend API URL - Node.js/Express server runs on port 3001
export const AUTH_API_BASE_URL =
  import.meta.env.VITE_AUTH_API_URL || 'http://localhost:3001/api';

// PicTur Backend API URL - Flask server runs on port 5000
export const TURTLE_API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Get stored token from localStorage
export const getToken = (): string | null => {
  return localStorage.getItem('auth_token');
};

// Store token in localStorage
export const setToken = (token: string): void => {
  localStorage.setItem('auth_token', token);
};

// Remove token from localStorage
export const removeToken = (): void => {
  localStorage.removeItem('auth_token');
};
