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
      window.dispatchEvent(new Event('auth-unauthorized'));
    }
    throw { status: response.status, message: 'Unauthorized' };
  }
  return response;
}

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
    const response = await fetchWithAuth(`${API_BASE_URL}/weather/current`);
    if (!response.ok) throw new Error('API Error');
    return await response.json();
  },

  async predict(): Promise<PredictResponse> {
    const response = await fetchWithAuth(`${API_BASE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        ambient_temp_c: 36.5,
        traffic_inflow_index: 82,
        active_plugs: 7,
        grid_frequency_hz: 59.92,
        load_lags_kw: [142.0, 158.5, 175.0, 192.0],
      }),
    });
    if (!response.ok) throw new Error('API Error');
    return await response.json();
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
      grid_frequency_hz: 59.92,
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

