import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, setUnauthorizedHandler, tokenStore } from './api.ts';
import { useToast } from './toast.tsx';
import type { User } from './types.ts';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (body: { name: string; email: string; password: string; confirm: string }) => Promise<void>;
  logout: () => void;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  // Descarta el token y el estado en memoria. LiveProvider cierra el WebSocket al quedar user = null.
  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!tokenStore.get()) return;
      toast('Tu sesión expiró o tu cuenta fue desactivada. Inicia sesión de nuevo.', 'error');
      logout();
    });
  }, [logout, toast]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<User>('/api/me')
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) tokenStore.clear();
        else toast(e.message, 'error');
      })
      .finally(() => setLoading(false));
  }, [toast]);

  const finish = (r: { token: string; user: User }) => {
    tokenStore.set(r.token);
    setUser(r.user);
  };

  const value: AuthContextValue = {
    user,
    loading,
    logout,
    setUser,
    login: async (email, password) =>
      finish(await api('/api/auth/login', { method: 'POST', body: { email, password } })),
    signup: async (body) => finish(await api('/api/auth/signup', { method: 'POST', body })),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
