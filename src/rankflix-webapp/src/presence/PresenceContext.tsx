import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useServerEvent } from "../hooks/useServerEvent";

interface PresenceContextValue {
  isOnline: (userId: number | null | undefined) => boolean;
}

const PresenceContext = createContext<PresenceContextValue>({ isOnline: () => false });

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());

  // Snapshot who's already online when we (re)connect, so status is correct immediately
  // instead of waiting for the next presence-changed event.
  useEffect(() => {
    if (!user) {
      setOnlineIds(new Set());
      return;
    }
    api
      .get<number[]>("/api/users/online")
      .then((ids) => setOnlineIds(new Set(ids)))
      .catch(() => {});
  }, [user]);

  useServerEvent<{ userId: number; online: boolean }>("presence-changed", (payload) => {
    if (!payload || typeof payload.userId !== "number") return;
    setOnlineIds((prev) => {
      const next = new Set(prev);
      if (payload.online) next.add(payload.userId);
      else next.delete(payload.userId);
      return next;
    });
  });

  const isOnline = (userId: number | null | undefined) => userId != null && onlineIds.has(userId);

  return <PresenceContext.Provider value={{ isOnline }}>{children}</PresenceContext.Provider>;
}

export function usePresence() {
  return useContext(PresenceContext);
}
