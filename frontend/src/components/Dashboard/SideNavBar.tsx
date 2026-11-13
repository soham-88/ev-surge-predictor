import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { NavLink, useLocation } from 'react-router-dom';
import { SettingsPanel } from './SettingsPanel';
import { useAuth } from '../../context/AuthContext';

interface SideNavBarProps {
  isDrawerOpen?: boolean;
  onCloseDrawer?: () => void;
}

export function SideNavBar({ isDrawerOpen = false, onCloseDrawer }: SideNavBarProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const isFirstRender = useRef(true);

  // Close drawer on route change (skip initial mount)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    onCloseDrawer?.();
  }, [location.pathname, onCloseDrawer]);

  // Close drawer on Escape key
  useEffect(() => {
    if (!isDrawerOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseDrawer?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawerOpen, onCloseDrawer]);

  const navItems = [
    { path: '/', icon: 'dashboard', label: 'Control Center' },
    { path: '/shap', icon: 'analytics', label: 'SHAP Explainability' },
    ...(user?.role === 'Operator' ? [{ path: '/sandbox', icon: 'science', label: 'Sandbox' }] : []),
    { path: '/batch', icon: 'dataset', label: 'Batch Analysis' },
    { path: '/tariff-lab', icon: 'electric_car', label: 'Vehicle Tariff Lab' },
  ];

  const renderNavLinks = (isMobile = false) => (
    <nav role="navigation" aria-label={isMobile ? 'Mobile Navigation' : 'Main Navigation'} className="flex-1 py-4 flex flex-col gap-1.5 px-3">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={() => {
            if (isMobile) onCloseDrawer?.();
          }}
          className={({ isActive }) =>
            `relative flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isActive ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/30'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.div
                  layoutId={isMobile ? 'activeTabMobile' : 'activeTab'}
                  className="absolute inset-0 bg-primary-container/20 border-r-4 border-primary rounded-lg"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <span
                className="material-symbols-outlined relative z-10 text-xl"
                style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="font-label-mono text-xs tracking-wider relative z-10">
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const renderFooterButtons = (isMobile = false) => (
    <div className="p-4 mt-auto border-t border-border-subtle flex flex-col gap-2">
      {user?.role === 'Operator' && (
        <button
          onClick={() => {
            if (isMobile) onCloseDrawer?.();
            setIsSettingsOpen(true);
          }}
          aria-label="Open System Settings"
          className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="material-symbols-outlined text-xl" aria-hidden="true">settings</span>
          <span className="font-label-mono text-xs font-bold tracking-wider">
            System Settings
          </span>
        </button>
      )}

      <button
        onClick={() => {
          if (isMobile) onCloseDrawer?.();
          logout();
        }}
        aria-label="Log Out of System"
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] rounded-lg text-on-surface-variant hover:text-status-critical hover:bg-status-critical/10 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="material-symbols-outlined text-xl" aria-hidden="true">logout</span>
        <span className="font-label-mono text-xs font-bold tracking-wider">
          Log Out
        </span>
      </button>
    </div>
  );

  return (
    <>
      {/* ── Desktop & Tablet Sidebar (>= 768px) ── */}
      <aside
        role="navigation"
        aria-label="Sidebar Navigation"
        className="hidden md:flex flex-col fixed left-0 top-16 h-[calc(100vh-64px)] z-30 bg-surface-container-lowest/30 backdrop-blur-xl w-64 border-r border-border-subtle shadow-none"
      >
        {/* User Header */}
        <div className="p-6 border-b border-border-subtle flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center overflow-hidden border border-border-subtle">
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdkaJl4ltTedw44-4-O7Ff8RQRqlIqo6o2Ko0xSQBRWQHYtLssUQDCwnujKbTXKaL8A_KihJHYSKciclmkqjl3ZJQBCBh3OjKHyT7uicZIBs5jJ2FtdM0zpLnFQlivAbYjuqjo5Zik0WO8sdos-5XBhEMCyCNUogJpKJHz8lPtlnRqlQzG-PMUikDkOQA3oVjYCwqCorvFBmcRDNOg7nmME1YjiRcfoUMfGUsOEY8AFeIU9mIInNFthvFHEJjXw9Bvgw"
              alt="User avatar"
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="font-body-lg font-semibold text-text-primary">{user?.name || 'Operator Alpha'}</div>
            <div className="font-label-mono text-xs text-text-secondary mt-0.5">{user?.role === 'Viewer' ? 'Read Only' : 'System Admin'}</div>
          </div>
        </div>

        {/* Links & Footer */}
        {renderNavLinks(false)}
        {renderFooterButtons(false)}
      </aside>

      {/* ── Mobile Hamburger Drawer (< 768px) ── */}
      <AnimatePresence>
        {isDrawerOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onCloseDrawer}
              aria-hidden="true"
              className="fixed inset-0 bg-black/75 backdrop-blur-sm cursor-pointer"
            />

            {/* Slide-over Drawer Panel */}
            <motion.aside
              id="mobile-navigation-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Mobile Navigation"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="relative w-72 max-w-[85vw] h-full bg-surface-container-lowest border-r border-border flex flex-col z-10 shadow-2xl overflow-y-auto"
            >
              {/* Drawer Top: User Info & Close Button */}
              <div className="p-4 border-b border-border-subtle flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-variant flex items-center justify-center overflow-hidden border border-border-subtle">
                    <img
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuCdkaJl4ltTedw44-4-O7Ff8RQRqlIqo6o2Ko0xSQBRWQHYtLssUQDCwnujKbTXKaL8A_KihJHYSKciclmkqjl3ZJQBCBh3OjKHyT7uicZIBs5jJ2FtdM0zpLnFQlivAbYjuqjo5Zik0WO8sdos-5XBhEMCyCNUogJpKJHz8lPtlnRqlQzG-PMUikDkOQA3oVjYCwqCorvFBmcRDNOg7nmME1YjiRcfoUMfGUsOEY8AFeIU9mIInNFthvFHEJjXw9Bvgw"
                      alt="User avatar"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <div className="font-body-md font-semibold text-text-primary">{user?.name || 'Operator Alpha'}</div>
                    <div className="font-label-mono text-[11px] text-text-secondary">{user?.role === 'Viewer' ? 'Read Only' : 'System Admin'}</div>
                  </div>
                </div>

                <button
                  onClick={onCloseDrawer}
                  aria-label="Close navigation menu"
                  className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary cursor-pointer"
                >
                  <span className="material-symbols-outlined text-2xl">close</span>
                </button>
              </div>

              {/* Drawer Nav Links & Actions */}
              {renderNavLinks(true)}
              {renderFooterButtons(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}
