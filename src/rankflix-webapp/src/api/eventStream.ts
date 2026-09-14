import { API_URL, getAccessToken, tryRefresh } from "./client";

export type ServerEventHandler = (data: unknown) => void;

/**
 * Opens one long-lived connection to /api/events/stream and dispatches parsed SSE messages
 * to registered listeners, keyed by event name. Uses fetch + a readable stream (not the
 * native EventSource API) specifically so the Bearer token can be sent as a normal
 * Authorization header, matching how the rest of the app authenticates.
 *
 * Auto-reconnects with backoff on disconnect/error (e.g. server restart, network blip,
 * or an idle-timeout from a proxy) and refreshes the access token first if it looks expired.
 */
export class EventStream {
  private listeners = new Map<string, Set<ServerEventHandler>>();
  private abortController: AbortController | null = null;
  private stopped = false;
  private retryDelayMs = 1000;
  private handleWake = () => {
    if (this.stopped) return;
    // Mobile/backgrounded browsers often silently pause (not error) a long-lived fetch
    // stream instead of closing it, so the connectLoop's read() never rejects and we'd
    // otherwise sit "connected" but not actually receiving anything until the page is
    // reloaded. Force a fresh connection whenever the tab regains focus/network so any
    // zombie connection gets replaced instead of relying on that ever timing out.
    if (document.visibilityState === "visible" || navigator.onLine) {
      this.retryDelayMs = 1000;
      this.abortController?.abort();
    }
  };

  start() {
    this.stopped = false;
    void this.connectLoop();
    document.addEventListener("visibilitychange", this.handleWake);
    window.addEventListener("online", this.handleWake);
    window.addEventListener("focus", this.handleWake);
  }

  stop() {
    this.stopped = true;
    this.abortController?.abort();
    document.removeEventListener("visibilitychange", this.handleWake);
    window.removeEventListener("online", this.handleWake);
    window.removeEventListener("focus", this.handleWake);
  }

  on(eventName: string, handler: ServerEventHandler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName)!.add(handler);
    return () => {
      this.listeners.get(eventName)?.delete(handler);
    };
  }

  private emit(eventName: string, data: unknown) {
    this.listeners.get(eventName)?.forEach((h) => h(data));
  }

  private async connectLoop() {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        this.retryDelayMs = 1000; // reset backoff after a clean connection
      } catch {
        /* fall through to retry below */
      }
      if (this.stopped) return;
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
    }
  }

  private async connectOnce(): Promise<void> {
    let token = getAccessToken();
    if (!token) {
      token = await tryRefresh();
      if (!token) throw new Error("Not authenticated");
    }

    this.abortController = new AbortController();
    const res = await fetch(`${API_URL}/api/events/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
      signal: this.abortController.signal,
    });

    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (!refreshed) throw new Error("Unauthorized");
      return this.connectOnce();
    }
    if (!res.ok || !res.body) throw new Error(`Event stream failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!this.stopped) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        this.processMessage(raw);
      }
    }
  }

  private processMessage(raw: string) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      // lines starting with ":" are comments/heartbeats - ignored
    }
    if (dataLines.length === 0) return;
    try {
      this.emit(eventName, JSON.parse(dataLines.join("\n")));
    } catch {
      /* ignore malformed payloads */
    }
  }
}

export const eventStream = new EventStream();
