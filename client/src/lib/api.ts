import type { BrokerStatus, DashboardData, PnlRow } from '@shared/types';

const API_BASE = '';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  return await response.json();
}

export async function getDiag(): Promise<BrokerStatus> {
  return fetchAPI<BrokerStatus>('/api/broker/diag');
}

export async function getAccount(): Promise<any> {
  return fetchAPI('/api/account');
}

export async function getAgentStatus(): Promise<any> {
  return fetchAPI('/api/agent/status');
}

export async function startAgent(payload: { strategy: string; symbols: string[] }): Promise<{ ok: boolean; id: string }> {
  return fetchAPI('/api/agent/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function stopAgent(): Promise<{ ok: boolean }> {
  return fetchAPI('/api/agent/stop', { method: 'POST' });
}

export async function getPositions(): Promise<any[]> {
  return fetchAPI('/api/positions');
}

export async function getPNL(): Promise<PnlRow[]> {
  return fetchAPI<PnlRow[]>('/api/pnl');
}

export async function getDashboard(): Promise<DashboardData> {
  return fetchAPI<DashboardData>('/api/dashboard');
}

export async function runOAuth(): Promise<{ ok: boolean; code: number; traceId?: string }> {
  return fetchAPI('/api/broker/oauth', { method: 'POST' });
}

export async function createSSO(): Promise<{ ok: boolean; code: number; traceId?: string }> {
  return fetchAPI('/api/broker/sso', { method: 'POST' });
}

export async function validateSSO(): Promise<{ ok: boolean; code: number; traceId?: string }> {
  return fetchAPI('/api/broker/validate', { method: 'POST' });
}

export async function initSession(): Promise<{ ok: boolean; code: number; traceId?: string }> {
  return fetchAPI('/api/broker/init', { method: 'POST' });
}
