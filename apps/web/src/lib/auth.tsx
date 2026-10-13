import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, setUnauthorizedHandler, tokenStore } from './api.ts';
import { useToast } from './toast.tsx';
import type { User } from './types.ts';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, recordar?: boolean) => Promise<void>;
  signup: (body: { name: string; email: string; password: string; confirm: string }) => Promise<void>;
  logout: () => void;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthContextValue>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  /**
   * Borra todo lo de la cuenta anterior: el token, el usuario en memoria, la caché de
   * react-query y el robot activo guardado. La caché es lo importante: sin vaciarla, al entrar
   * con otra cuenta el navegador seguía pintando los robots (y sus salas, sesiones y mapas) de
   * la cuenta de antes hasta que llegara el refetch — y un robot es de una sola persona.
   * LiveProvider cierra el WebSocket al quedar user = null.
   */
  const olvidarCuenta = useCallback(() => {
    qc.clear();
    try {
      localStorage.removeItem('robot-activo');
    } catch {
      /* navegación privada */
    }
  }, [qc]);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    olvidarCuenta();
    navigate('/login', { replace: true });
  }, [navigate, olvidarCuenta]);

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

  const finish = (r: { token: string; user: User }, recordar = true) => {
    // Antes de entrar, no después: si quedara algo de la cuenta anterior en la caché se
    // pintaría durante el primer render de la nueva.
    olvidarCuenta();
    tokenStore.set(r.token, recordar);
    setUser(r.user);
  };

  const value: AuthContextValue = {
    user,
    loading,
    logout,
    setUser,
    login: async (email, password, recordar = true) =>
      finish(await api('/api/auth/login', { method: 'POST', body: { email, password } }), recordar),
    signup: async (body) => finish(await api('/api/auth/signup', { method: 'POST', body })),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
