import { useState } from 'react';
import { motion } from 'motion/react';
import { NavLink } from 'react-router-dom';
import { SettingsPanel } from './SettingsPanel';
import { useAuth } from '../../context/AuthContext';

export function SideNavBar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { user, logout } = useAuth();

  return (
    <>
    <motion.aside
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
      className="hidden lg:flex flex-col fixed left-0 top-16 h-[calc(100vh-64px)] z-40 bg-surface-container-lowest/20 backdrop-blur-xl w-64 border-r border-border-subtle shadow-none"
    >
      {/* User Header */}
      <div className="p-6 border-b border-border-subtle flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center overflow-hidden border border-border-subtle">
          <img
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdkaJl4ltTedw44-4-O7Ff8RQRqlIqo6o2Ko0xSQBRWQHYtLssUQDCwnujKbTXKaL8A_KihJHYSKciclmkqjl3ZJQBCBh3OjKHyT7uicZIBs5jJ2FtdM0zpLnFQlivAbYjuqjo5Zik0WO8sdos-5XBhEMCyCNUogJpKJHz8lPtlnRqlQzG-PMUikDkOQA3oVjYCwqCorvFBmcRDNOg7nmME1YjiRcfoUMfGUsOEY8AFeIU9mIInNFthvFHEJjXw9Bvgw"
            alt="Operator Alpha"
            className="w-full h-full object-cover"
          />
        </div>
        <div>
          <div className="font-body-lg font-semibold text-text-primary">{user?.name || 'Operator Alpha'}</div>
          <div className="font-label-mono text-label-mono text-text-secondary mt-0.5">{user?.role === 'Viewer' ? 'Read Only' : 'System Admin'}</div>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
        {[
          { path: '/', icon: 'dashboard', label: 'Control Center' },
          { path: '/shap', icon: 'analytics', label: 'SHAP Explainability' },
          ...(user?.role === 'Operator' ? [{ path: '/sandbox', icon: 'science', label: 'Sandbox' }] : []),
          { path: '/batch', icon: 'dataset', label: 'Batch Analysis' },
          { path: '/tariff-lab', icon: 'electric_car', label: 'Vehicle Tariff Lab' },
        ].map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-300 ${
                isActive ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-primary-container/20 border-r-4 border-primary rounded-lg"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <span
                  className="material-symbols-outlined relative z-10"
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                <span className="font-label-mono text-label-mono font-bold tracking-wider relative z-10">
                  {item.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      {/* Settings Button */}
      <div className="p-4 mt-auto border-t border-border-subtle flex flex-col gap-2">
        {user?.role === 'Operator' && (
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors duration-300 cursor-pointer"
          >
            <span className="material-symbols-outlined">settings</span>
            <span className="font-label-mono text-label-mono font-bold tracking-wider">
              System Settings
            </span>
          </button>
        )}

        <button 
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-on-surface-variant hover:text-status-critical hover:bg-status-critical/10 transition-colors duration-300 cursor-pointer"
        >
          <span className="material-symbols-outlined">logout</span>
          <span className="font-label-mono text-label-mono font-bold tracking-wider">
            Log Out
          </span>
        </button>
      </div>
    </motion.aside>

    <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
