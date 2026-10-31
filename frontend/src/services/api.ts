import type { PredictResponse, ExplainResponse, SimulateResponse, MetricsResponse, BatchPredictResponse } from '../types/telemetry';

const RAW_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const API_BASE_URL = RAW_API_URL.endsWith('/api/v1')
  ? RAW_API_URL
  : `${RAW_API_URL.replace(/\/+$/, '')}/api/v1`;

async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      // A quick reload to force the user to login page if token is dead
      window.dispatchEvent(new CustomEvent('auth-unauthorized', { detail: { message: 'Session expired' } }));
    }
    throw { status: response.status, message: 'Unauthorized' };
  }
  return response;
}

let lastPredictLatencyMs: number | null = null;
let lastPredictSuccess: boolean = false;
let lastWeatherSuccess: boolean = false;
let lastKnownWeatherTemp: number | null = null;

export const api = {
  async login(username: string, password: string) {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
    });
    if (!response.ok) throw new Error('Login failed');
    return await response.json();
  },

  async getMe() {
    const response = await fetchWithAuth(`${API_BASE_URL}/auth/me`);
    if (!response.ok) throw new Error('Failed to fetch user');
    return await response.json();
  },

  async getWeather() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/weather/current`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        lastWeatherSuccess = false;
        throw new Error('API Error');
      }
      const data = await response.json();
      lastWeatherSuccess = true;
      if (typeof data?.temperature_c === 'number') {
        lastKnownWeatherTemp = data.temperature_c;
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastWeatherSuccess = false;
      throw err;
    }
  },

  async predict(): Promise<PredictResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const startTime = performance.now();
    try {
      const response = await fetchWithAuth(`${API_BASE_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          ambient_temp_c: 36.5,
          traffic_inflow_index: 82,
          active_plugs: 7,
          grid_frequency_hz: 49.92,
          load_lags_kw: [142.0, 158.5, 175.0, 192.0],
        }),
      });
      clearTimeout(timeoutId);
      const latencyMs = performance.now() - startTime;
      if (!response.ok) {
        lastPredictLatencyMs = null;
        lastPredictSuccess = false;
        throw new Error('API Error');
      }
      const data = await response.json();
      lastPredictLatencyMs = latencyMs;
      lastPredictSuccess = true;
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      lastPredictLatencyMs = null;
      lastPredictSuccess = false;
      throw error;
    }
  },

  getLastPredictLatency(): number | null {
    return lastPredictLatencyMs;
  },

  isLastPredictSuccess(): boolean {
    return lastPredictSuccess;
  },

  isLastWeatherSuccess(): boolean {
    return lastWeatherSuccess;
  },

  getLastKnownTemp(): number | null {
    return lastKnownWeatherTemp;
  },

  async explain(customPayload?: Partial<{
    timestamp: string;
    ambient_temp_c: number;
    traffic_inflow_index: number;
    active_plugs: number;
    grid_frequency_hz: number;
    load_lags_kw: number[];
  }>): Promise<ExplainResponse> {
    const defaultPayload = {
      timestamp: new Date().toISOString(),
      ambient_temp_c: 36.5,
      traffic_inflow_index: 82,
      active_plugs: 7,
      grid_frequency_hz: 49.92,
      load_lags_kw: [142.0, 158.5, 175.0, 192.0],
    };
    const response = await fetchWithAuth(`${API_BASE_URL}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPayload ? { ...defaultPayload, ...customPayload } : defaultPayload),
    });
    if (!response.ok) throw new Error('API Error');
    return await response.json();
  },

  async simulate(params: { temp_delta_c: number; traffic_surge_pct: number; forced_outage_stalls: number[] }): Promise<SimulateResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('API Error');
    return await response.json();
  },

  async metrics(): Promise<MetricsResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/metrics`);
    if (!response.ok) throw new Error('API Error');
    return await response.json();
  },

  async uploadBatchCSV(file: File): Promise<BatchPredictResponse> {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetchWithAuth(`${API_BASE_URL}/predict/batch`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw { status: response.status, data: errorData };
    }
    return await response.json();
  },

  async downloadBatchCSV(batchId: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/predict/batch/download/${batchId}`);
    if (!response.ok) throw new Error('Download failed');
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batch_results_${batchId}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
};

