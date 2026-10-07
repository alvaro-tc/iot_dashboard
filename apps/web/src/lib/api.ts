export const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
/** Origen del servidor de Socket.IO. socket.io-client le añade el namespace y /socket.io. */
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? BASE;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/**
 * El token va en localStorage si el usuario marcó "Recordarme", y en sessionStorage si no:
 * así al cerrar la pestaña la sesión se va con ella. Todo acceso va envuelto en try/catch
 * porque en navegación privada el acceso al almacenamiento puede lanzar.
 */
export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem('token') ?? sessionStorage.getItem('token');
    } catch {
      return null;
    }
  },
  set: (t: string, recordar = true) => {
    try {
      (recordar ? localStorage : sessionStorage).setItem('token', t);
      (recordar ? sessionStorage : localStorage).removeItem('token');
    } catch {
      /* sin almacenamiento: la sesión dura lo que dure la página */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
    } catch {
      /* nada que limpiar */
    }
  },
};

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/** fetch con JWT. Ante un 401 con token (sesión caducada o cuenta desactivada) fuerza logout. */
export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con la API. Comprueba que está en marcha e inténtalo de nuevo.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data.error ?? `La API respondió con un error ${res.status}.`, data.fields ?? {});
  }
  return data as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Algo falló. Inténtalo de nuevo.');
