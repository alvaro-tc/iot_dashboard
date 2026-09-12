import type { ErrorRequestHandler } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Valida con zod; los errores salen como 400 con un mensaje por campo. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) fields[String(issue.path[0] ?? '_')] ??= issue.message;
  throw new HttpError(400, 'Revisa los campos marcados.', fields);
}

export function positiveId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador inválido.');
  return n;
}

export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
    return;
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'Error interno del servidor. Revisa los logs de la API.' });
};
