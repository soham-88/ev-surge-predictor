import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useState, useRef } from 'react';
import { HeaderKPIs } from '../components/Dashboard/HeaderKPIs';
import { StallGrid } from '../components/Dashboard/StallGrid';
import { SideNavBar } from '../components/Dashboard/SideNavBar';
import { IncidentHistoryModal } from '../components/Dashboard/IncidentHistoryModal';
import { ShapPage } from '../pages/ShapPage';
import { api } from '../services/api';
import * as DataContextModule from '../context/DataContext';
import * as AuthContextModule from '../context/AuthContext';
import * as TariffContextModule from '../context/TariffContext';

// Mock animejs for StallGrid pulse animation
vi.mock('animejs', () => ({
  animate: () => ({
    pause: vi.fn(),
    play: vi.fn(),
  }),
}));

vi.mock('../components/Dashboard/SettingsPanel', () => ({
  SettingsPanel: () => null,
}));

describe('Accessibility & Non-Color Status Encoding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('mobile drawer opens with role="dialog" and closes with Escape key', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      user: { name: 'Operator Alpha', role: 'Operator' },
      login: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    });

    const handleClose = vi.fn();

    const { rerender } = render(
      <MemoryRouter>
        <SideNavBar isDrawerOpen={true} onCloseDrawer={handleClose} />
      </MemoryRouter>
    );

    const drawer = screen.getByRole('dialog', { name: /mobile navigation/i });
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-modal', 'true');

    // Trigger Escape key
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handleClose).toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <SideNavBar isDrawerOpen={false} onCloseDrawer={handleClose} />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /mobile navigation/i })).not.toBeInTheDocument();
    });
  });

  it('status indicators convey state through text or icon in addition to color', () => {
    // 1. HeaderKPIs status test
    vi.spyOn(DataContextModule, 'useData').mockReturnValue({
      headerKpis: {
        latencyMs: 24.5,
        gridFrequencyHz: 49.98,
        ambientTempC: 32.0,
        isOffline: false,
        isWeatherLive: true,
        isWeatherStale: false,
      },
      isOffline: false,
      hasError: false,
      isPaused: false,
      setIsPaused: vi.fn(),
    } as any);

    const { rerender } = render(<HeaderKPIs />);

    // Latency status is conveyed via text
    expect(screen.getByText('Latency')).toBeInTheDocument();
    expect(screen.getByText(/Status: Normal/i)).toBeInTheDocument();
    expect(screen.getByText('LIVE')).toBeInTheDocument();

    // Rerender as offline: must show explicit OFFLINE text
    vi.spyOn(DataContextModule, 'useData').mockReturnValue({
      headerKpis: {
        latencyMs: null,
        gridFrequencyHz: null,
        ambientTempC: null,
        isOffline: true,
        isWeatherLive: false,
        isWeatherStale: false,
      },
      isOffline: true,
      hasError: true,
      isPaused: false,
      setIsPaused: vi.fn(),
    } as any);

    rerender(<HeaderKPIs isBackendOffline={true} />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    expect(screen.getByText(/Status: Offline/i)).toBeInTheDocument();

    // 2. StallGrid status test: verify each bay state renders text label (not color alone)
    const bayStates = {
      1: { state: 'ACTIVE' as const, kwDraw: 25.0 },
      2: { state: 'THROTTLED' as const, kwDraw: 12.5 },
      3: { state: 'SHED' as const, kwDraw: 0.0 },
      4: { state: 'IDLE' as const, kwDraw: 0.0 },
      5: { state: 'ACTIVE' as const, kwDraw: 25.0 },
      6: { state: 'THROTTLED' as const, kwDraw: 12.5 },
      7: { state: 'SHED' as const, kwDraw: 0.0 },
      8: { state: 'IDLE' as const, kwDraw: 0.0 },
    };

    render(
      <StallGrid
        activePlugs={1}
        throttledStalls={[2]}
        shedStalls={[3]}
        perStallCapKw={12.5}
        bayStates={bayStates}
      />
    );

    // Explicit text labels for all 4 states must be in the document
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('THROTTLED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SHED').length).toBeGreaterThan(0);
    expect(screen.getAllByText('IDLE').length).toBeGreaterThan(0);
  });

  it('IncidentHistoryModal has role="dialog", closes on Escape, and returns focus to trigger', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      user: { name: 'Operator Alpha', role: 'Operator' },
      login: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    });
    vi.spyOn(api, 'getIncidents').mockResolvedValue({ total: 0, incidents: [] });

    function TestWrapper() {
      const [isOpen, setIsOpen] = useState(true);
      const buttonRef = useRef<HTMLButtonElement>(null);

      return (
        <div>
          <button ref={buttonRef} onClick={() => setIsOpen(true)}>
            Incident Log
          </button>
          <IncidentHistoryModal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            triggerRef={buttonRef}
          />
        </div>
      );
    }

    render(<TestWrapper />);

    const dialog = screen.getByRole('dialog', { name: /grid surge incident history/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'incident-modal-title');

    // Trigger Escape key
    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /grid surge incident history/i })).not.toBeInTheDocument();
    });

    // Focus returns to the trigger button
    const triggerBtn = screen.getByRole('button', { name: /incident log/i });
    expect(document.activeElement).toBe(triggerBtn);
  });

  it('ShapPage tabs switch with left and right arrow keys and update focus', async () => {
    vi.spyOn(DataContextModule, 'useData').mockReturnValue({
      explainData: {
        base_value_kw: 120.0,
        predicted_value_kw: 224.6,
        attributions: [
          { feature: 'ambient_temp_c', value: 36.5, shap_delta_kw: 42.1 },
          { feature: 'traffic_inflow_index', value: 82, shap_delta_kw: 31.5 },
        ],
      },
    } as any);

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      user: { name: 'Operator Alpha', role: 'Operator' },
      login: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    });

    vi.spyOn(TariffContextModule, 'useTariff').mockReturnValue({
      isSimulationActive: false,
      simulationParams: {},
    } as any);

    vi.spyOn(api, 'explainGlobal').mockResolvedValue({
      total_features: 2,
      sample_size: 200,
      feature_importances: [
        { feature: 'ambient_temp_c', mean_abs_shap_kw: 42.1, importance_pct: 57.2, rank: 1 },
        { feature: 'traffic_inflow_index', mean_abs_shap_kw: 31.5, importance_pct: 42.8, rank: 2 },
      ],
    });

    render(
      <MemoryRouter>
        <ShapPage />
      </MemoryRouter>
    );

    const localTab = screen.getByRole('tab', { name: /local attribution/i });
    const globalTab = screen.getByRole('tab', { name: /global feature importance/i });

    expect(localTab).toHaveAttribute('aria-selected', 'true');
    expect(globalTab).toHaveAttribute('aria-selected', 'false');

    // Focus local tab and press ArrowRight
    localTab.focus();
    fireEvent.keyDown(localTab, { key: 'ArrowRight' });

    expect(globalTab).toHaveAttribute('aria-selected', 'true');
    expect(localTab).toHaveAttribute('aria-selected', 'false');
    expect(document.activeElement).toBe(globalTab);

    // Press ArrowLeft to return
    fireEvent.keyDown(globalTab, { key: 'ArrowLeft' });

    expect(localTab).toHaveAttribute('aria-selected', 'true');
    expect(globalTab).toHaveAttribute('aria-selected', 'false');
    expect(document.activeElement).toBe(localTab);
  });
});
