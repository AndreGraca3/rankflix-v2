import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, setAccessToken, setUnauthorizedHandler } from "../api/client";
import { eventStream } from "../api/eventStream";
import { supabase } from "../lib/supabaseClient";
import { toSyntheticEmail } from "../lib/syntheticEmail";
import type { UserProfile } from "../api/types";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (fields: { username?: string; displayName?: string; avatarUrl?: string }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  setStatus: (status: "online" | "invisible") => Promise<void>;
  adminViewEnabled: boolean;
  setAdminViewEnabled: (enabled: boolean) => void;
}

const ADMIN_VIEW_STORAGE_KEY = "rankflix.adminViewEnabled";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Needed to re-authenticate (verify the "current password") before Supabase's
  // updateUser({ password }) call, since that API trusts the already-signed-in session and
  // doesn't itself check the old password.
  const syntheticEmailRef = useRef<string | null>(null);
  // Admins-only "Admin view" / "User view" switch: lets an admin temporarily hide all
  // admin-only affordances (Users nav link, group owner-level controls on groups they don't
  // own, "All groups (system)" filter, etc.) to see the app as a regular member would.
  // Defaults to showing admin options (true), and persists across reloads/tabs.
  const [adminViewEnabled, setAdminViewEnabledState] = useState(() => {
    const stored = localStorage.getItem(ADMIN_VIEW_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  });

  const setAdminViewEnabled = (enabled: boolean) => {
    setAdminViewEnabledState(enabled);
    localStorage.setItem(ADMIN_VIEW_STORAGE_KEY, enabled ? "1" : "0");
  };

  const refreshProfile = async () => {
    const profile = await api.get<UserProfile>("/api/users/me");
    setUser(profile);
  };

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    // Supabase persists the session in localStorage and this fires immediately on mount with
    // whatever it finds there (INITIAL_SESSION), then again on every sign-in/out/token-refresh
    // from here on - so this one listener handles both the initial-load session restore and
    // keeping the access token in sync for the lifetime of the app, including refresh in other
    // tabs (supabase-js broadcasts token refreshes across tabs via the storage event).
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      syntheticEmailRef.current = session?.user.email ?? null;
      setAccessToken(session?.access_token ?? null);

      if (session) {
        refreshProfile()
          .catch(() => setUser(null))
          .finally(() => setLoading(false));
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      eventStream.start();
      return () => eventStream.stop();
    }
  }, [user]);

  const login = async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: toSyntheticEmail(username), password });
    if (error) throw new Error("Incorrect username or password");
    // onAuthStateChange (above) picks up the new session, sets the access token, and loads
    // the profile - no need to duplicate that here.
  };

  const register = async (username: string, password: string, displayName: string) => {
    const { error } = await supabase.auth.signUp({
      email: toSyntheticEmail(username),
      password,
      options: { data: { display_name: displayName } },
    });
    if (error) {
      if (error.message.includes("already registered")) throw new Error("Username already in use");
      throw new Error(error.message);
    }
    // "Confirm email" is disabled on this project (there's nowhere for a synthetic address to
    // receive a confirmation link anyway), so signUp returns an active session immediately.
  };

  const logout = async () => {
    await supabase.auth.signOut();
    eventStream.stop();
  };

  const updateProfile = async (fields: { username?: string; displayName?: string; avatarUrl?: string }) => {
    const profile = await api.patch<UserProfile>("/api/users/me", fields);
    setUser(profile);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    if (!syntheticEmailRef.current) throw new Error("Not signed in");

    // Re-verify the current password (Supabase's updateUser trusts the existing session and
    // won't itself check it) before applying the change.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: syntheticEmailRef.current,
      password: currentPassword,
    });
    if (reauthError) throw new Error("Current password is incorrect");

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  };

  const setStatus = async (status: "online" | "invisible") => {
    const profile = await api.patch<UserProfile>("/api/users/me/status", { status });
    setUser(profile);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshProfile,
        updateProfile,
        changePassword,
        setStatus,
        adminViewEnabled,
        setAdminViewEnabled,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
