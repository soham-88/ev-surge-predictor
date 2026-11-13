import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HeaderKPIs } from '../components/Dashboard/HeaderKPIs';
import { StallGrid } from '../components/Dashboard/StallGrid';
import { SideNavBar } from '../components/Dashboard/SideNavBar';
import * as DataContextModule from '../context/DataContext';
import * as AuthContextModule from '../context/AuthContext';

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
});
