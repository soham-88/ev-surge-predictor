import { useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && password.trim()) {
      setIsSubmitting(true);
      setError(null);
      try {
        const data = await api.login(username, password);
        localStorage.setItem('token', data.access_token);
        const role = data.role === 'operator' ? 'Operator' : 'Viewer';
        login(data.username, role);
      } catch (err: any) {
        setError('Invalid username or password');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[120px]" />
        <div className="absolute top-[60%] right-[-10%] w-[40%] h-[60%] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md bg-surface/80 backdrop-blur-xl border border-border-subtle rounded-2xl p-8 shadow-2xl relative z-10"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4 border border-primary/30 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
            <span className="material-symbols-outlined text-primary text-3xl">lock</span>
          </div>
          <h1 className="font-headline-xl text-text-primary text-2xl mb-2">EV Surge Predictor</h1>
          <p className="font-body-sm text-text-secondary">Secure Operator Login</p>
          <p className="font-body-sm text-text-secondary mt-1 text-xs opacity-70">Demo credentials: see README</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-status-critical/10 border border-status-critical/30 rounded text-status-critical text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="font-label-mono text-xs text-text-secondary tracking-wide uppercase">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-surface-variant/30 border border-border-subtle rounded-lg px-4 py-3 text-text-primary font-body-md focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-text-secondary/50"
              placeholder="e.g. operator or viewer"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="font-label-mono text-xs text-text-secondary tracking-wide uppercase">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-variant/30 border border-border-subtle rounded-lg px-4 py-3 text-text-primary font-body-md focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-text-secondary/50"
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-4 w-full bg-primary hover:bg-primary/90 text-background font-label-mono font-bold tracking-widest text-sm py-3.5 rounded-lg transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)] hover:shadow-[0_0_25px_rgba(34,211,238,0.5)] cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'AUTHENTICATING...' : 'SIGN IN'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
