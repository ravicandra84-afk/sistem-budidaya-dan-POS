"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { UserRole } from "@pfi/shared";
import { ApiEnvelope, apiRequest } from "@/lib/api";

const sessionStorageKey = "pfi.operational.session.v1";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: string;
  user: SessionUser;
}

interface AuthContextValue {
  session: AuthSession | null;
  ready: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): void;
  updateSession(session: AuthSession | null): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AuthSession;
    if (!value.accessToken || !value.user?.id || !value.user?.role) return null;
    return value;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = parseSession(
      window.sessionStorage.getItem(sessionStorageKey),
    );
    setSession(stored);
    setReady(true);
  }, []);

  function updateSession(nextSession: AuthSession | null) {
    if (nextSession) {
      window.sessionStorage.setItem(
        sessionStorageKey,
        JSON.stringify(nextSession),
      );
    } else {
      window.sessionStorage.removeItem(sessionStorageKey);
    }
    setSession(nextSession);
  }

  async function signIn(email: string, password: string): Promise<void> {
    const response = (await apiRequest<{
      access_token: string;
      token_type: "Bearer";
      expires_in: string;
      user: SessionUser;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    })) as ApiEnvelope<{
      access_token: string;
      token_type: "Bearer";
      expires_in: string;
      user: SessionUser;
    }>;

    updateSession({
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
      user: response.data.user,
    });
  }

  function signOut() {
    updateSession(null);
  }

  return (
    <AuthContext.Provider
      value={{ session, ready, signIn, signOut, updateSession }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
