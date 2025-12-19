// frontend/config.js

// Base URL of your FastAPI backend
window.BASE_API_URL = "http://127.0.0.1:8000";

/**
 * Build full API URL from a path, e.g. "/api/auth/login"
 */
window.apiUrl = function apiUrl(path) {
  const base = window.BASE_API_URL.replace(/\/+$/, "");
  const p = String(path || "");
  if (!p.startsWith("/")) return base + "/" + p;
  return base + p;
};
