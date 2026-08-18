'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { apiRequest, setAccessTokenRefreshHandler } from '../../lib/api/client';

export type AppRole = 'ADMIN' | 'STAFF' | 'CUSTOMER';

export interface SessionUser {
  id: string;
  email: string;
  role: AppRole;
}

interface AuthContextValue {
  accessToken: string | null;
  user: SessionUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshPromise = useRef<Promise<string | null> | null>(null);

  const refresh = useCallback((): Promise<string | null> => {
    if (refreshPromise.current) return refreshPromise.current;
    refreshPromise.current = (async () => {
      try {
        const session = await apiRequest<AuthResponse | undefined>('/auth/refresh', {
          method: 'POST',
        });
        if (!session) return null;
        setAccessToken(session.accessToken);
        setUser(session.user);
        return session.accessToken;
      } catch {
        setAccessToken(null);
        setUser(null);
        return null;
      } finally {
        setIsLoading(false);
        refreshPromise.current = null;
      }
    })();
    return refreshPromise.current;
  }, []);

  useEffect(() => {
    setAccessTokenRefreshHandler(refresh);
    void refresh();
    return () => setAccessTokenRefreshHandler(null);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string): Promise<SessionUser> => {
    const session = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ accessToken, user, isLoading, login, logout }),
    [accessToken, isLoading, login, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return context;
}
