import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { ProveedorConfirmar } from './lib/confirmar.tsx';
import { ProveedorPanelTarjetas } from './lib/panel.tsx';
import { ProveedorRobots } from './lib/robots.tsx';
import { ProveedorSocket } from './lib/socket.tsx';
import { ProveedorTema } from './lib/tema.tsx';
import { ToastProvider, useToast } from './lib/toast.tsx';
import { Eventos } from './pages/Eventos.tsx';
import { Historial } from './pages/Historial.tsx';
import { Login } from './pages/Login.tsx';
import { Mapa } from './pages/Mapa.tsx';
import { Panel } from './pages/Panel.tsx';
import { Perfil } from './pages/Perfil.tsx';
import { Registro } from './pages/Registro.tsx';
import { Robots } from './pages/Robots.tsx';
import { Sesiones } from './pages/Sesiones.tsx';
import { PanelAdmin } from './pages/admin/PanelAdmin.tsx';
import { RobotsAdmin } from './pages/admin/RobotsAdmin.tsx';
import { Usuarios } from './pages/admin/Usuarios.tsx';

const inicioDe = (rol: string) => (rol === 'admin' ? '/admin' : '/');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Los datos históricos no cambian bajo los pies; lo vivo llega por WebSocket.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Cargando() {
  return <p className="p-8 text-tinta-suave">Cargando…</p>;
}

function ExigirSesion({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Cargando />;
  return user ? children : <Navigate to="/login" replace />;
}

function SoloInvitados({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Cargando />;
  return user ? <Navigate to={inicioDe(user.role)} replace /> : children;
}

/** Un cliente que entra en /admin/* recibe un aviso y vuelve a su panel. */
function ExigirRol({ rol }: { rol: 'admin' | 'client' }) {
  const { user } = useAuth();
  const toast = useToast();
  const permitido = user!.role === rol;
  useEffect(() => {
    if (!permitido && rol === 'admin') toast('Esta sección es solo para administradores.', 'error');
  }, [permitido, rol, toast]);
  return permitido ? <Outlet /> : <Navigate to={inicioDe(user!.role)} replace />;
}

/** El panel de un admin no es el mismo que el de un cliente. */
function Inicio() {
  const { user } = useAuth();
  return user!.role === 'admin' ? <Navigate to="/admin" replace /> : <Panel />;
}

export function App() {
  return (
    <BrowserRouter>
      <ProveedorTema>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <ProveedorSocket>
                <ProveedorRobots>
                 <ProveedorPanelTarjetas>
                  <ProveedorConfirmar>
                  <Routes>
                    <Route path="/login" element={<SoloInvitados><Login /></SoloInvitados>} />
                    <Route path="/registro" element={<SoloInvitados><Registro /></SoloInvitados>} />

                    <Route element={<ExigirSesion><AppLayout /></ExigirSesion>}>
                      <Route index element={<Inicio />} />
                      <Route path="mapa" element={<Mapa />} />
                      <Route path="sesiones" element={<Sesiones />} />
                      <Route path="historial" element={<Historial />} />
                      <Route path="eventos" element={<Eventos />} />
                      <Route path="robots" element={<Robots />} />
                      <Route path="perfil" element={<Perfil />} />

                      <Route path="admin" element={<ExigirRol rol="admin" />}>
                        <Route index element={<PanelAdmin />} />
                        <Route path="usuarios" element={<Usuarios />} />
                        <Route path="robots" element={<RobotsAdmin />} />
                      </Route>
                    </Route>

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                  </ProveedorConfirmar>
                 </ProveedorPanelTarjetas>
                </ProveedorRobots>
              </ProveedorSocket>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ProveedorTema>
    </BrowserRouter>
  );
}
