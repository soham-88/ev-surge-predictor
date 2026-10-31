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
});
