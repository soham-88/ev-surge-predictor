import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SideNavBar } from '../components/Dashboard/SideNavBar';
import * as AuthContextModule from '../context/AuthContext';

vi.mock('../components/Dashboard/SettingsPanel', () => ({
  SettingsPanel: () => <div data-testid="mock-settings-panel" />,
}));

describe('SideNavBar Role-Based Access Control', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders navigation without Sandbox or System Settings for Viewer role', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      user: { name: 'Viewer User', role: 'Viewer' },
      login: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <SideNavBar />
      </MemoryRouter>
    );

    expect(screen.getByText('Control Center')).toBeInTheDocument();
    expect(screen.getByText('SHAP Explainability')).toBeInTheDocument();
    expect(screen.getByText('Batch Analysis')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Tariff Lab')).toBeInTheDocument();

    // Sandbox and System Settings must NOT be accessible to Viewer
    expect(screen.queryByText('Sandbox')).not.toBeInTheDocument();
    expect(screen.queryByText('System Settings')).not.toBeInTheDocument();
    expect(screen.getByText('Read Only')).toBeInTheDocument();
  });

  it('renders Sandbox and System Settings for Operator role', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      isAuthenticated: true,
      user: { name: 'Operator Alpha', role: 'Operator' },
      login: vi.fn(),
      logout: vi.fn(),
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <SideNavBar />
      </MemoryRouter>
    );

    expect(screen.getByText('Control Center')).toBeInTheDocument();
    expect(screen.getByText('SHAP Explainability')).toBeInTheDocument();
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByText('Batch Analysis')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Tariff Lab')).toBeInTheDocument();
    expect(screen.getByText('System Settings')).toBeInTheDocument();
    expect(screen.getByText('System Admin')).toBeInTheDocument();
  });
});
