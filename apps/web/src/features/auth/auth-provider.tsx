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
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { apiRequest, setAccessTokenRefreshHandler } from '../../lib/api/client';

export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'CUSTOMER';

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

function withAuthSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    const lockedOperation = navigator.locks.request(
      'mero-telecom-auth-session',
      { mode: 'exclusive' },
      operation,
    );
    return lockedOperation.then((result) => result);
  }
  return operation();
}

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshPromise = useRef<Promise<string | null> | null>(null);
  const broadcastChannel = useRef<BroadcastChannel | null>(null);
  const sessionGeneration = useRef(0);
  const hadAuthenticatedSession = useRef(false);

  const clearClientSession = useCallback(
    (destination: '/' | '/login?reason=session-expired') => {
      sessionGeneration.current += 1;
      setAccessToken(null);
      setUser(null);
      queryClient.clear();
      router.replace(destination);
      router.refresh();
    },
    [queryClient, router],
  );

  const refresh = useCallback((): Promise<string | null> => {
    if (refreshPromise.current) return refreshPromise.current;
    const generation = sessionGeneration.current;
    refreshPromise.current = (async () => {
      try {
        const session = await withAuthSessionLock(() =>
          apiRequest<AuthResponse | undefined>('/auth/refresh', { method: 'POST' }),
        );
        if (!session || generation !== sessionGeneration.current) return null;
        setAccessToken(session.accessToken);
        setUser(session.user);
        hadAuthenticatedSession.current = true;
        return session.accessToken;
      } catch {
        if (generation === sessionGeneration.current) {
          if (hadAuthenticatedSession.current) {
            hadAuthenticatedSession.current = false;
            clearClientSession('/login?reason=session-expired');
            broadcastChannel.current?.postMessage({ type: 'session-expired' });
          } else {
            setAccessToken(null);
            setUser(null);
          }
        }
        return null;
      } finally {
        setIsLoading(false);
        refreshPromise.current = null;
      }
    })();
    return refreshPromise.current;
  }, [clearClientSession]);

  useEffect(() => {
    setAccessTokenRefreshHandler(refresh);
    void refresh();
    return () => setAccessTokenRefreshHandler(null);
  }, [refresh]);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('mero-telecom-auth');
    broadcastChannel.current = channel;
    channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data.type === 'logout') {
        hadAuthenticatedSession.current = false;
        clearClientSession('/');
      } else if (event.data.type === 'session-expired') {
        hadAuthenticatedSession.current = false;
        clearClientSession('/login?reason=session-expired');
      }
    };
    return () => {
      broadcastChannel.current = null;
      channel.close();
    };
  }, [clearClientSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<SessionUser> => {
      const session = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      sessionGeneration.current += 1;
      queryClient.clear();
      setAccessToken(session.accessToken);
      setUser(session.user);
      hadAuthenticatedSession.current = true;
      return session.user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    hadAuthenticatedSession.current = false;
    clearClientSession('/');
    broadcastChannel.current?.postMessage({ type: 'logout' });
    try {
      await withAuthSessionLock(() => apiRequest<void>('/auth/logout', { method: 'POST' }));
    } catch {
      // Local sign-out remains complete even if the idempotent server request cannot be reached.
    }
  }, [clearClientSession]);

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
