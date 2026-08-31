/**
 * The one place the frontend's backend URL is defined. apiClient and
 * marketplaceApi both import API_BASE from here — not their own copy of
 * this fallback logic.
 *
 * Configuration, in order of precedence:
 * 1. VITE_API_URL — set this in Railway's environment variables (or a
 *    local .env file) to point the frontend at the marketplace-backend
 *    Railway service's public URL.
 * 2. If unset and running on localhost, falls back to the local dev
 *    backend (http://localhost:3001).
 * 3. If unset and NOT on localhost, falls back to an obviously-broken
 *    placeholder host rather than silently pointing at someone else's
 *    backend — VITE_API_URL must be set explicitly for this deployment.
 */

const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

const UNSET_PLACEHOLDER = "https://SET-VITE_API_URL-in-railway-env-vars.invalid";

export const API_BASE: string = import.meta.env.VITE_API_URL
  ?? (isLocalhost ? "http://localhost:3001" : UNSET_PLACEHOLDER);

/** Same backend, as a WebSocket URL (wss:// instead of https://, ws:// instead of http://). */
export const API_BASE_WS: string = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/^http/, "ws") + "/ws"
  : (isLocalhost ? "ws://localhost:3001/ws" : UNSET_PLACEHOLDER.replace(/^https/, "wss"));
