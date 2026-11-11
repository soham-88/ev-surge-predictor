import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../services/api';

describe('API Client Authentication', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('attaches Bearer token from localStorage to authenticated requests', async () => {
    const testToken = 'test-token-jwt-12345';
    localStorage.setItem('token', testToken);

    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      capturedHeaders = options?.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ username: 'operator', role: 'operator' }),
      });
    });

    const user = await api.getMe();
    expect(user.username).toBe('operator');
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.['Authorization']).toBe(`Bearer ${testToken}`);
  });

  it('clears token from localStorage and dispatches auth-unauthorized on 401 response', async () => {
    localStorage.setItem('token', 'expired-token');

    let eventFired = false;
    const handleUnauthorized = () => {
      eventFired = true;
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 401,
      })
    );

    await expect(api.getMe()).rejects.toMatchObject({
      status: 401,
      message: 'Unauthorized',
    });

    expect(localStorage.getItem('token')).toBeNull();
    expect(eventFired).toBe(true);

    window.removeEventListener('auth-unauthorized', handleUnauthorized);
  });

  it('preserves token on 403 Forbidden response and throws Forbidden', async () => {
    localStorage.setItem('token', 'viewer-token');

    let eventFired = false;
    const handleUnauthorized = () => {
      eventFired = true;
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);

    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 403,
      })
    );

    await expect(api.simulate({ temp_delta_c: 0, traffic_surge_pct: 0, forced_outage_stalls: [] })).rejects.toMatchObject({
      status: 403,
      message: 'Forbidden',
    });

    expect(localStorage.getItem('token')).toBe('viewer-token');
    expect(eventFired).toBe(false);

    window.removeEventListener('auth-unauthorized', handleUnauthorized);
  });

  it('sends custom telemetry payload in api.predict() when provided', async () => {
    localStorage.setItem('token', 'valid-token');
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      capturedBody = options?.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            predicted_load_kw: 215.4,
            transformer_capacity_kw: 250,
            capacity_utilization_pct: 86.2,
            surge_status: 'CRITICAL',
            recommended_actions: {
              dynamic_tariff_multiplier: 1.5,
              throttle_active: true,
              per_stall_cap_kw: 40.0,
              shed_stalls: [7, 8],
            },
            inference_latency_ms: 1.2,
          }),
      });
    });

    const res = await api.predict({
      ambient_temp_c: 41.5,
      active_plugs: 8,
      traffic_inflow_index: 95,
      grid_frequency_hz: 49.88,
      load_lags_kw: [218.0, 212.5, 204.0, 195.0],
    });

    expect(res.surge_status).toBe('CRITICAL');
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.ambient_temp_c).toBe(41.5);
    expect(parsed.active_plugs).toBe(8);
    expect(parsed.traffic_inflow_index).toBe(95);
  });
});
