import type { SeriesKey } from '@iot/shared';

export type Role = 'admin' | 'client';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface AdminUserRow extends User {
  deviceCount: number;
  runCount: number;
  sampleCount: number;
  lastActivity: string | null;
  activeRunId: number | null;
  activeSeriesKey: SeriesKey | null;
}

/** Los campos numéricos solo vienen en endpoints de admin. */
export interface Run {
  id: number;
  userId: number;
  userName: string;
  seriesKey: SeriesKey;
  status: 'active' | 'finished';
  startedAt: string;
  endedAt: string | null;
  source: 'web' | 'device';
  deviceId: string | null;
  deviceName: string | null;
  sampleCount?: number;
  lastIteration?: number;
  lastValue?: number | null;
  lastErrorAbs?: number | null;
}

export interface Sample {
  id: number;
  runId: number;
  seriesKey: SeriesKey;
  iteration: number;
  value: number;
  errorAbs: number;
  createdAt: string;
}

export interface Device {
  id: string;
  userId: number;
  name: string;
  isRevoked: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface ActiveRunSummary {
  runId: number;
  seriesKey: SeriesKey;
  startedAt: string;
  source: 'web' | 'device';
  deviceName: string | null;
}

export interface ClientStatus {
  hasDevice: boolean;
  device: { id: string; name: string; createdAt: string; lastSeenAt: string | null } | null;
  deviceOnline: boolean;
  activeRun: ActiveRunSummary | null;
  simulation: { seriesKey: SeriesKey; intervalMs: number } | null;
}
