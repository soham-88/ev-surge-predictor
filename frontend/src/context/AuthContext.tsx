import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../services/api';

export type Role = 'Operator' | 'Viewer';

export interface User {
  name: string;
  role: Role;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: User | null;
  login: (name: string, role: Role) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const data = await api.getMe();
          setUser({ name: data.username, role: data.role === 'operator' ? 'Operator' : 'Viewer' });
        } catch (e) {
          localStorage.removeItem('token');
          setUser(null);
        }
      }
      setIsLoading(false);
    };

    initAuth();

    const handleUnauthorized = () => {
      setUser(null);
    };
    window.addEventListener('auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth-unauthorized', handleUnauthorized);
  }, []);

  const login = (name: string, role: Role) => {
    setUser({ name, role });
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
