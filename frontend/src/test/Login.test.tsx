import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginPage } from '../pages/LoginPage';
import { AuthProvider } from '../context/AuthContext';
import { api } from '../services/api';

describe('LoginPage Component', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders login form with required fields and submit button', () => {
    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    expect(usernameInput).toBeInTheDocument();
    expect(usernameInput).toBeRequired();
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toBeRequired();
    expect(submitButton).toBeInTheDocument();
  });

  it('displays error message when login fails', async () => {
    vi.spyOn(api, 'login').mockRejectedValueOnce(new Error('Invalid credentials'));

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await userEvent.type(usernameInput, 'operator');
    await userEvent.type(passwordInput, 'wrongpassword');
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid username or password/i)).toBeInTheDocument();
    });
  });

  it('successfully logs in and stores token on valid credentials', async () => {
    const mockToken = 'mock-jwt-token-xyz';
    vi.spyOn(api, 'login').mockResolvedValueOnce({
      access_token: mockToken,
      token_type: 'bearer',
      role: 'operator',
      username: 'operator',
    });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    );

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await userEvent.type(usernameInput, 'operator');
    await userEvent.type(passwordInput, 'operatorpassword123');
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(localStorage.getItem('token')).toBe(mockToken);
    });
  });
});

