import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAccessToken, setUnauthorizedHandler, tryRefresh } from "../api/client";
import { eventStream } from "../api/eventStream";
import type { LoginResponse, UserProfile } from "../api/types";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (fields: { displayName?: string; avatarUrl?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setStatus: (status: "online" | "invisible") => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    const profile = await api.get<UserProfile>("/api/users/me");
    setUser(profile);
  };

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    // Attempt silent session restore via the refresh-token cookie on first load.
    (async () => {
      try {
        const token = await tryRefresh();
        if (token) {
          await refreshProfile();
        }
      } catch {
        /* no valid session */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user) {
      eventStream.start();
      return () => eventStream.stop();
    }
  }, [user]);

  const login = async (username: string, password: string) => {
    const data = await api.post<LoginResponse>("/api/auth/login", { username, password });
    setAccessToken(data.accessToken);
    await refreshProfile();
  };

  const register = async (username: string, password: string, displayName?: string) => {
    const data = await api.post<LoginResponse>("/api/auth/register", { username, password, displayName });
    setAccessToken(data.accessToken);
    await refreshProfile();
  };

  const logout = async () => {
    await api.post("/api/auth/sign-out");
    eventStream.stop();
    setAccessToken(null);
    setUser(null);
  };

  const updateProfile = async (fields: { displayName?: string; avatarUrl?: string }) => {
    const profile = await api.patch<UserProfile>("/api/users/me", fields);
    setUser(profile);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    await api.post("/api/users/me/change-password", { currentPassword, newPassword });
  };

  const setStatus = async (status: "online" | "invisible") => {
    const profile = await api.patch<UserProfile>("/api/users/me/status", { status });
    setUser(profile);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshProfile, updateProfile, changePassword, setStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
