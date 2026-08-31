// ─── VINK Central API Client ───────────────────────────────────────────────────
// Single source of truth for all backend calls. Falls back to demo mode when
// the server is unreachable.

import { API_BASE as BASE } from "./config";

const TOKEN_KEY = "vink_jwt";
const DEMO_KEY  = "vink_demo";

// ─── Auth token management ────────────────────────────────────────────────────
export function getToken(): string | null  { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string)        { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken()               { localStorage.removeItem(TOKEN_KEY); }
export function isDemoMode(): boolean      { return localStorage.getItem(DEMO_KEY) === "1"; }
export function setDemoMode(on: boolean)   { on ? localStorage.setItem(DEMO_KEY, "1") : localStorage.removeItem(DEMO_KEY); }

// ─── Logged-in user (stored after login) ─────────────────────────────────────
const SESSION_KEY = "vink_session";
export function getSession(): { id: string; username: string; name: string; email: string; role: string } | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null"); } catch { return null; }
}
export function setSession(user: object) { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); }
export function clearSession()           { localStorage.removeItem(SESSION_KEY); clearToken(); }

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
interface ApiResponse<T = unknown> { success: boolean; data?: T; error?: string; meta?: object }

// Maps HTTP status codes to user-friendly messages
function httpErrorMessage(status: number): string {
  if (status === 400) return "Invalid request. Please check your inputs and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have permission to perform this action.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 409) return "A conflict occurred. This record may already exist.";
  if (status === 422) return "Validation failed. Please check your inputs.";
  if (status === 429) return "Too many requests. Please wait a moment before trying again.";
  if (status >= 500)  return "The server encountered an error. Please try again shortly.";
  return `Request failed (${status}).`;
}

async function request<T>(
  method: string,
  path: string,
  body?: object,
  auth = false,
  timeoutMs = 10000,
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let hadToken = false;
    if (auth) {
      const tok = getToken();
      hadToken = Boolean(tok);
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
    }
    const res = await fetch(`${BASE}${path}`, {
      method, headers, signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Try to parse JSON regardless of status
    let json: ApiResponse<T>;
    try {
      json = await res.json() as ApiResponse<T>;
    } catch {
      json = { success: false, error: httpErrorMessage(res.status) };
    }

    // Attach status-specific message if backend didn't provide one
    if (!res.ok && !json.error) {
      json = { ...json, success: false, error: httpErrorMessage(res.status) };
    }

    // Auto-clear token on 401 -- and tell anyone listening this wasn't a
    // deliberate logout, so a dashboard mid-use can show a clear "your
    // session expired" state instead of continuing to silently fail every
    // subsequent request with no explanation, which is what was actually
    // happening: one request 401s, the token gets cleared, and every
    // other request already in flight or fired moments later 401s too,
    // all while the UI still looks normal.
    if (res.status === 401 && auth) {
      clearToken();
      window.dispatchEvent(new CustomEvent("vink:session-expired", {
        detail: { path, hadToken, backendError: json.error ?? null },
      }));
    }

    return json;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Request timed out. Please check your connection." };
    }
    if (err instanceof TypeError && err.message.includes("fetch")) {
      setDemoMode(true);
      return { success: false, error: "Server unreachable — running in demo mode." };
    }
    return { success: false, error: "An unexpected error occurred." };
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  get:    <T>(p: string, auth = false) => request<T>("GET",    p, undefined, auth),
  post:   <T>(p: string, b: object, auth = false) => request<T>("POST",   p, b, auth),
  patch:  <T>(p: string, b: object, auth = false) => request<T>("PATCH",  p, b, auth),
  delete: <T>(p: string, auth = false) => request<T>("DELETE", p, undefined, auth),
};

// ─── Health check ─────────────────────────────────────────────────────────────
async function pingHealth(timeoutMs: number): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return j.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Checks backend health before deciding to show demo mode. A single slow
 * response (Railway cold start, brief network blip) shouldn't be enough to
 * flip the whole app into simulated data for the rest of the session, so
 * this retries a couple of times with a longer timeout before giving up.
 */
export async function checkHealth(): Promise<boolean> {
  // First attempt: generous timeout, covers a cold-starting backend.
  if (await pingHealth(8000)) { setDemoMode(false); return true; }

  // Two quick retries in case that was just a transient blip.
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 1500));
    if (await pingHealth(5000)) { setDemoMode(false); return true; }
  }

  setDemoMode(true);
  return false;
}

let recoveryTimer: ReturnType<typeof setInterval> | undefined;
/**
 * Once demo mode is on, keep checking in the background so the app
 * recovers automatically the moment the backend comes back — instead of
 * requiring the person to notice and click "Retry Live" themselves.
 */
export function startHealthRecoveryWatch() {
  if (recoveryTimer) return;
  recoveryTimer = setInterval(async () => {
    if (!isDemoMode()) return;
    if (await pingHealth(5000)) setDemoMode(false);
  }, 20000);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: async (username: string, password: string) => {
    const r = await api.post<{ token: string; user: object }>("/api/auth/login", { username, password });
    if (r.success && r.data) {
      setToken((r.data as { token: string }).token);
      setSession((r.data as { user: object }).user);
      setDemoMode(false);
    }
    return r;
  },
  me: () => api.get("/api/auth/me", true),
  logout: async () => {
    await api.post("/api/auth/logout", {}, true);
    clearSession();
  },
};

// ─── News API ───────────────────────────────────────────────────────────────
export interface NewsArticleSummary {
  id: string; slug: string; title: string; subtitle?: string; category: string; author: string;
  summary: string; tags: string[]; heroGradient: string; emoji: string; readMinutes: number;
  featured: boolean; breaking: boolean; views: number; publishedAt: string;
}
export interface NewsArticle extends NewsArticleSummary { body: string; }
export interface NewsListMeta { page: number; limit: number; total: number; pages: number }

// ─── RBAC (section applications, permissions, audit) ────────────────────────
export interface SectionApplication {
  id: string; section: string; message: string | null; status: "pending" | "approved" | "rejected";
  rejection_reason: string | null; created_at: string; reviewed_at: string | null;
  username?: string; name?: string; email?: string; user_id?: string;
}
export interface ManagerRecord { id: string; username: string; name: string; email: string; sections: { section: string; position?: string | null; grantedAt: string }[]; }
export interface AuditEntry { id: string; actor_name: string; action: string; target: string | null; details: object; created_at: string; }

export interface NewsRole { hasAccess: boolean; position: string | null; tier: "leadership" | "creator" | "viewer" }
export interface NewsAdminArticle extends NewsArticleSummary {
  body: string;
  status: "draft" | "pending_review" | "published" | "rejected" | "scheduled";
  createdByName?: string;
  updatedAt: string;
  hasHeroImage?: boolean;
  scheduledAt?: string | null;
  metaDescription?: string | null;
}

export const newsAdminApi = {
  me: () => api.get<NewsRole>("/api/news/admin/me", true),
  articles: (status?: string) => api.get<NewsAdminArticle[]>(`/api/news/admin/articles${status ? `?status=${status}` : ""}`, true),
  create: (data: Partial<NewsAdminArticle> & { submitForReview?: boolean }) => api.post<NewsAdminArticle>("/api/news/admin/articles", data, true),
  update: (id: string, data: Partial<NewsAdminArticle>) => api.patch<NewsAdminArticle>(`/api/news/admin/articles/${id}`, data, true),
  setStatus: (id: string, status: string, scheduledAt?: string) => api.patch<NewsAdminArticle>(`/api/news/admin/articles/${id}/status`, { status, scheduledAt }, true),
  remove: (id: string) => api.delete<null>(`/api/news/admin/articles/${id}`, true),
  imageUrl: (id: string) => `${BASE}/api/news/admin/articles/${id}/image`,
  uploadImage: async (id: string, file: File): Promise<{ success: boolean; error?: string }> => {
    const fd = new FormData();
    fd.append("image", file);
    try {
      const res = await fetch(`${BASE}/api/news/admin/articles/${id}/image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      const json = await res.json();
      return json;
    } catch {
      return { success: false, error: "Network error while uploading the image" };
    }
  },
};

export const rbacApi = {
  sections: () => api.get<readonly string[]>("/api/rbac/sections"),
  apply: (section: string, message?: string) => api.post<{ id: string; section: string; status: string }>("/api/rbac/apply", { section, message }, true),
  myApplications: () => api.get<SectionApplication[]>("/api/rbac/my-applications", true),
  mySections: () => api.get<string[]>("/api/rbac/my-sections", true),
  mySectionsDetailed: () => api.get<{ section: string; position: string | null }[]>("/api/rbac/my-sections-detailed", true),
  applications: (status?: string) => api.get<SectionApplication[]>(`/api/rbac/applications${status ? `?status=${status}` : ""}`, true),
  approve: (id: string) => api.post<{ id: string; status: string }>(`/api/rbac/applications/${id}/approve`, {}, true),
  reject: (id: string, reason?: string) => api.patch<{ id: string; status: string }>(`/api/rbac/applications/${id}/reject`, { reason }, true),
  managers: () => api.get<ManagerRecord[]>("/api/rbac/managers", true),
  grant: (userId: string, section: string) => api.post<null>("/api/rbac/permissions", { userId, section }, true),
  revoke: (userId: string, section: string) => api.delete<null>(`/api/rbac/permissions/${userId}/${encodeURIComponent(section)}`, true),
  audit: () => api.get<AuditEntry[]>("/api/rbac/audit", true),
};

export interface JobApplication {
  id: string; referenceNumber: string; department: string; position: string;
  applicantName: string; applicantEmail: string; applicantPhone?: string;
  details: Record<string, unknown>;
  documents: { type: string; filename: string; mimeType: string }[];
  status: "submitted" | "under_review" | "interview" | "offered" | "rejected" | "withdrawn";
  statusReason?: string; roleGranted: boolean; roleGrantedAt?: string;
  submittedAt: string; updatedAt: string;
  statusHistory?: { fromStatus: string | null; toStatus: string; reason: string; changedByName?: string; createdAt: string }[];
}

export const jobsApi = {
  applications: (department?: string, status?: string) => {
    const q = new URLSearchParams();
    if (department) q.set("department", department);
    if (status) q.set("status", status);
    return api.get<JobApplication[]>(`/api/jobs/applications?${q}`, true);
  },
  get: (ref: string) => api.get<JobApplication>(`/api/jobs/applications/${ref}`, true),
  updateStatus: (ref: string, status: string, reason: string) => api.patch<JobApplication>(`/api/jobs/applications/${ref}/status`, { status, reason }, true),
  approve: (ref: string, reason: string, username?: string, password?: string) =>
    api.post<{ referenceNumber: string; status: string; roleGranted: boolean; accountCreated?: boolean }>(`/api/jobs/applications/${ref}/approve`, { reason, username, password }, true),
  documentUrl: (ref: string, type: string) => `${BASE}/api/jobs/applications/${ref}/documents/${type}`,
};

export const newsApi = {
  list: (params?: { category?: string; search?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set("category", params.category);
    if (params?.search) qs.set("search", params.search);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    return api.get<NewsArticleSummary[]>(`/api/news/articles?${qs}`) as Promise<{ success: boolean; data?: NewsArticleSummary[]; error?: string; meta?: NewsListMeta }>;
  },
  categories: () => api.get<{ category: string; count: number }[]>("/api/news/categories"),
  trending: () => api.get<NewsArticleSummary[]>("/api/news/trending"),
  get: (slug: string) => api.get<{ article: NewsArticle; related: NewsArticleSummary[] }>(`/api/news/articles/${slug}`),
};

// ─── Public API ───────────────────────────────────────────────────────────────
export const publicApi = {
  contact: (data: {
    name: string; email: string; phone?: string;
    subject?: string; message: string; type?: string;
  }) => api.post("/api/public/contact", data),

  newsletter: (email: string) =>
    api.post("/api/public/newsletter", { email }),

  apply: (data: {
    product: string; tier?: string; name: string;
    email: string; phone: string; idNumber?: string;
    income?: string; employmentStatus?: string; message?: string;
  }) => api.post("/api/public/apply", data),

  register: (data: {
    firstName: string; lastName: string; email: string;
    phone: string; idNumber: string; dateOfBirth?: string; accountType?: string;
  }) => api.post("/api/public/register", data),

  creditCheck: (data: { idNumber: string; firstName?: string; lastName?: string; income?: string }) =>
    api.post<{ score: number; rating: string; eligible: { product: string; approved: boolean; reason: string }[]; tips: string[] }>("/api/public/credit-check", data),

  branches: () => api.get("/api/public/branches"),

  stats: () => api.get<{
    afcDevices: number; dailyCommuters: number; appRating: number;
    partnerMerchants: number; countriesCovered: number; merchantLocations: number; sadcNations: number;
  }>("/api/public/stats"),
};

// ─── Demo mode fallbacks (used when server is down) ──────────────────────────
export const demoLogin = (dashboardId: string) => {
  setDemoMode(true);
  setSession({ id: "demo-001", username: "demo", name: "Demo User", email: "demo@vink.co.za", role: "customer", dashboard: dashboardId });
};

// ─── Notify helpers (used with Sonner toast) ──────────────────────────────────
export type NotifyFn = (msg: string, type?: "success" | "error" | "info") => void;
