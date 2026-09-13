import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { LiveProvider } from './lib/live.tsx';
import { ToastProvider, useToast } from './lib/toast.tsx';
import { Account } from './pages/Account.tsx';
import { Login } from './pages/Login.tsx';
import { Signup } from './pages/Signup.tsx';
import { Overview } from './pages/admin/Overview.tsx';
import { Sessions } from './pages/admin/Sessions.tsx';
import { UserDetail } from './pages/admin/UserDetail.tsx';
import { Users } from './pages/admin/Users.tsx';
import { Device } from './pages/client/Device.tsx';
import { MyRuns } from './pages/client/MyRuns.tsx';
import { Simulator } from './pages/client/Simulator.tsx';

const homeFor = (role: string) => (role === 'admin' ? '/admin' : '/envios');

function Loading() {
  return <p className="p-8 text-ink-soft">Cargando…</p>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? children : <Navigate to="/login" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Navigate to={homeFor(user.role)} replace /> : children;
}

/** Un cliente en /admin/* recibe un 403 y vuelve a su panel. */
function RequireRole({ role }: { role: 'admin' | 'client' }) {
  const { user } = useAuth();
  const toast = useToast();
  const allowed = user!.role === role;
  useEffect(() => {
    if (!allowed && role === 'admin') toast('403 · Esta sección es solo para administradores.', 'error');
  }, [allowed, role, toast]);
  return allowed ? <Outlet /> : <Navigate to={homeFor(user!.role)} replace />;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={homeFor(user!.role)} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <LiveProvider>
            <Routes>
              <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
              <Route path="/signup" element={<GuestOnly><Signup /></GuestOnly>} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<Home />} />
                <Route path="admin" element={<RequireRole role="admin" />}>
                  <Route index element={<Overview />} />
                  <Route path="usuarios" element={<Users />} />
                  <Route path="usuarios/:id" element={<UserDetail />} />
                  <Route path="sesiones" element={<Sessions />} />
                </Route>
                <Route element={<RequireRole role="client" />}>
                  <Route path="dispositivo" element={<Device />} />
                  <Route path="envios" element={<MyRuns />} />
                  <Route path="simulador" element={<Simulator />} />
                </Route>
                <Route path="cuenta" element={<Account />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </LiveProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
