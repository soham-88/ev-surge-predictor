import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VehicleTariffLab } from '../pages/VehicleTariffLab';
import { TariffProvider } from '../context/TariffContext';
import { api } from '../services/api';

// Mock recharts
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: any) => (
      <div style={{ width: 800, height: 400 }}>
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<any>, { width: 800, height: 400 })
          : children}
      </div>
    ),
  };
});

describe('VehicleTariffLab Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock fetch for /api/v1/tariff/vehicle-adjusted
    globalThis.fetch = vi.fn().mockImplementation((url: string, options: any) => {
      if (url.includes('/tariff/vehicle-adjusted')) {
        const body = JSON.parse(options.body);
        const type = body.vehicle_type;
        const base = body.base_surge_multiplier || 1.0;
        const multMap: Record<string, number> = {
          two_wheeler: 0.85,
          standard_4w: 1.0,
          fast_charging: 1.35,
        };
        const powerMap: Record<string, number> = {
          two_wheeler: 1.2,
          standard_4w: 7.2,
          fast_charging: 45.0,
        };
        const catMult = multMap[type] || 1.0;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              vehicle_type: type,
              vehicle_label: type === 'two_wheeler' ? 'Two-Wheeler EV (e.g., Ola S1)' : type === 'standard_4w' ? 'Standard 4W EV (e.g., Tata Nexon EV)' : 'Fast-Charging EV (e.g., MG ZS EV DC)',
              avg_power_kw: powerMap[type],
              base_surge_multiplier: base,
              vehicle_multiplier: catMult,
              final_tariff_multiplier: Math.round(base * catMult * 1000) / 1000,
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    // Mock api.getTariffCurve
    vi.spyOn(api, 'getTariffCurve').mockResolvedValue({
      bands: [
        { name: 'Normal', surge_status: 'NORMAL', min_pct: 0, max_pct: 65, base_multiplier: 1.0, multipliers: { two_wheeler: 0.85, standard_4w: 1.0, fast_charging: 1.35 } },
        { name: 'Warning', surge_status: 'WARNING', min_pct: 65, max_pct: 80, base_multiplier: 1.2, multipliers: { two_wheeler: 1.02, standard_4w: 1.2, fast_charging: 1.62 } },
        { name: 'Critical', surge_status: 'CRITICAL', min_pct: 80, max_pct: 95, base_multiplier: 1.45, multipliers: { two_wheeler: 1.232, standard_4w: 1.45, fast_charging: 1.958 } },
        { name: 'Severe', surge_status: 'CRITICAL', min_pct: 95, max_pct: 100, base_multiplier: 1.8, multipliers: { two_wheeler: 1.53, standard_4w: 1.8, fast_charging: 2.43 } },
      ],
      points: [
        { utilization_pct: 0, surge_status: 'NORMAL', base_multiplier: 1.0, two_wheeler: 0.85, standard_4w: 1.0, fast_charging: 1.35 },
        { utilization_pct: 50, surge_status: 'NORMAL', base_multiplier: 1.0, two_wheeler: 0.85, standard_4w: 1.0, fast_charging: 1.35 },
        { utilization_pct: 70, surge_status: 'WARNING', base_multiplier: 1.2, two_wheeler: 1.02, standard_4w: 1.2, fast_charging: 1.62 },
        { utilization_pct: 85, surge_status: 'CRITICAL', base_multiplier: 1.45, two_wheeler: 1.232, standard_4w: 1.45, fast_charging: 1.958 },
        { utilization_pct: 98, surge_status: 'CRITICAL', base_multiplier: 1.8, two_wheeler: 1.53, standard_4w: 1.8, fast_charging: 2.43 },
      ],
      categories: {
        two_wheeler: { key: 'two_wheeler', label: 'Two-Wheeler EV (e.g., Ola S1)', category_multiplier: 0.85, avg_power_kw: 1.2 },
        standard_4w: { key: 'standard_4w', label: 'Standard 4W EV (e.g., Tata Nexon EV)', category_multiplier: 1.0, avg_power_kw: 7.2 },
        fast_charging: { key: 'fast_charging', label: 'Fast-Charging EV (e.g., MG ZS EV DC)', category_multiplier: 1.35, avg_power_kw: 45.0 },
      },
    });
  });

  it('renders the header with Live status badge and illustrative assumptions note', async () => {
    render(
      <TariffProvider>
        <VehicleTariffLab />
      </TariffProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Vehicle Tariff Lab')).toBeDefined();
      expect(screen.getByText('LIVE')).toBeDefined();
      expect(screen.getByText(/Average power draw figures/i)).toBeDefined();
    });
  });

  it('renders the 3 category cards and displays effective multipliers', async () => {
    render(
      <TariffProvider>
        <VehicleTariffLab />
      </TariffProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Two-Wheeler EV (e.g., Ola S1)').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Standard 4W EV (e.g., Tata Nexon EV)').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Fast-Charging EV (e.g., MG ZS EV DC)').length).toBeGreaterThan(0);
    });

    // Check average draw numbers
    expect(screen.getByText('1.2 kW')).toBeDefined();
    expect(screen.getByText('7.2 kW')).toBeDefined();
    expect(screen.getByText('45.0 kW')).toBeDefined();
  });

  it('renders Session Cost Estimator and updates outputs on input change', async () => {
    render(
      <TariffProvider>
        <VehicleTariffLab />
      </TariffProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Session Cost Estimator')).toBeDefined();
    });

    // Find energy input and base rate input
    const energyInput = screen.getByLabelText('Energy Needed in kilowatt-hours') as HTMLInputElement;
    const baseRateInput = screen.getByLabelText('Illustrative base rate in rupees per kilowatt-hour') as HTMLInputElement;

    expect(energyInput).toBeDefined();
    expect(baseRateInput).toBeDefined();
    expect(baseRateInput.value).toBe('12');

    // Switch to Fast Charging radio
    const fastChargingRadio = screen.getByRole('radio', { name: /Fast Charging/i });
    fireEvent.click(fastChargingRadio);

    // Energy needed should update to Fast Charging default (50 kWh)
    expect(energyInput.value).toBe('50');

    // Check summary sentence updates
    await waitFor(() => {
      expect(screen.getByText(/A 50 kWh session costs/i)).toBeDefined();
    });
  });

  it('renders the Tariff Multiplier vs Grid Load step chart and accessible region', async () => {
    render(
      <TariffProvider>
        <VehicleTariffLab />
      </TariffProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Tariff Multiplier vs. Grid Load')).toBeDefined();
      expect(
        screen.getByLabelText(/Tariff Multiplier vs Grid Load step chart showing dynamic rate multipliers/i)
      ).toBeDefined();
      expect(screen.getByText('Normal 1.0x')).toBeDefined();
      expect(screen.getByText('Warn 1.2x')).toBeDefined();
      expect(screen.getByText('Crit 1.45x')).toBeDefined();
      expect(screen.getByText('Sev 1.8x')).toBeDefined();
    });
  });
});
