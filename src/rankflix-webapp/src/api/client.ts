const API_URL = import.meta.env.VITE_API_URL as string;

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let pendingCount = 0;
const pendingListeners = new Set<(count: number) => void>();

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export function subscribeToPendingRequests(listener: (count: number) => void) {
  pendingListeners.add(listener);
  listener(pendingCount);
  return () => {
    pendingListeners.delete(listener);
  };
}

function setPending(count: number) {
  pendingCount = count;
  pendingListeners.forEach((l) => l(pendingCount));
}

let inFlightRefresh: Promise<string | null> | null = null;

// De-duplicate concurrent refresh calls (e.g. React StrictMode double-invoking the
// mount effect, or several 401s firing at once): the refresh token is single-use and
// rotates on every call, so two simultaneous requests would race and the loser gets
// a stale/already-consumed token, incorrectly logging the user out.
async function tryRefresh(): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return null;
      const data = await res.json();
      accessToken = data.accessToken;
      return accessToken;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

export { tryRefresh };

async function request<T>(
  path: string,
  options: RequestInit & { form?: FormData } = {},
  retry = true
): Promise<T> {
  if (retry) setPending(pendingCount + 1);
  try {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };

    let body = options.body;
    if (options.form) {
      body = options.form;
    } else if (body && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }

    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      body,
      credentials: "include",
    });

    if (res.status === 401 && retry) {
      const refreshed = await tryRefresh();
      if (refreshed) return await request<T>(path, options, false);
      onUnauthorized?.();
    }

    if (!res.ok) {
      let message = res.statusText;
      try {
        const problem = await res.json();
        message = problem.detail ?? problem.title ?? message;
      } catch {
        /* ignore non-json error bodies */
      }
      throw new Error(message);
    }

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) return (await res.json()) as T;
    return (await res.blob()) as T;
  } finally {
    if (retry) setPending(pendingCount - 1);
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body as BodyInit }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body as BodyInit }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", form }),
  downloadUrl: (path: string) => `${API_URL}${path}`,
};

export { API_URL };
