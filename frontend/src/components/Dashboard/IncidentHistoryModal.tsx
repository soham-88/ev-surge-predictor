import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../../services/api';
import type { IncidentItem } from '../../types/telemetry';
import { useAuth } from '../../context/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function IncidentHistoryModal({ isOpen, onClose, triggerRef }: Props) {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const fetchIncidents = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getIncidents(
        100,
        filter === 'ALL' ? undefined : filter
      );
      setIncidents(res.incidents);
      setTotal(res.total);
    } catch (err) {
      console.error('Failed to load incident history:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (isOpen) {
      fetchIncidents();
    }
  }, [isOpen, fetchIncidents]);

  // Focus management & Escape key handling
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) || triggerRef?.current || null;

      // Focus first interactive element in modal
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return;
        }

        if (e.key === 'Tab') {
          if (!modalRef.current) return;
          const focusable = modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey) {
            if (document.activeElement === first) {
              e.preventDefault();
              last.focus();
            }
          } else {
            if (document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('keydown', handleKeyDown);
        // Restore focus on close
        const returnTarget = triggerRef?.current || previouslyFocusedRef.current;
        if (returnTarget && typeof returnTarget.focus === 'function') {
          returnTarget.focus();
        }
      };
    }
  }, [isOpen, onClose, triggerRef]);

  const handleClear = async () => {
    if (!window.confirm('Are you sure you want to clear all logged incident history?')) {
      return;
    }
    setIsClearing(true);
    try {
      await api.clearIncidents();
      setIncidents([]);
      setTotal(0);
    } catch (err) {
      console.error('Failed to clear incidents:', err);
    } finally {
      setIsClearing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm motion-reduce:backdrop-blur-none animate-fade-in motion-reduce:animate-none">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="incident-modal-title"
        aria-describedby="incident-modal-desc"
        className="w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-4xl bg-surface-container-low border-0 sm:border border-border rounded-none sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border-subtle bg-surface-container-lowest/60">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-status-warning text-2xl shrink-0" aria-hidden="true">
              history_toggle_off
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="incident-modal-title" className="font-headline-sm text-headline-sm text-text-primary">
                  Grid Surge Incident History
                </h2>
                <span className="bg-primary/20 text-primary border border-primary/30 px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest font-label-mono">
                  Simulated Telemetry
                </span>
              </div>
              <p id="incident-modal-desc" className="font-body-sm text-text-secondary mt-0.5">
                Persistent audit log of 250 kW transformer stress &amp; mitigation events
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchIncidents}
              disabled={isLoading}
              aria-label="Refresh incidents"
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-variant rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"
              title="Refresh incidents"
            >
              <span className={`material-symbols-outlined text-[20px] ${isLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true">
                refresh
              </span>
            </button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="Close incident history modal"
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-variant rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"
              title="Close modal"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
            </button>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-border-subtle bg-surface-container-lowest/30 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter incidents by status">
            {(['ALL', 'CRITICAL', 'WARNING'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                aria-pressed={filter === mode}
                className={`px-3 py-1.5 min-h-[36px] rounded-md text-xs font-label-mono font-medium transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-primary ${
                  filter === mode
                    ? 'bg-primary/20 text-primary border border-primary/40 font-bold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant border border-transparent'
                }`}
              >
                {mode}
              </button>
            ))}
            <span className="text-xs text-text-secondary ml-2 font-label-mono">
              Total: <strong className="text-text-primary">{total}</strong>
            </span>
          </div>

          {user?.role === 'Operator' ? (
            <button
              onClick={handleClear}
              disabled={isClearing || total === 0}
              aria-label="Clear all incident history logs"
              className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-label-mono text-status-critical hover:bg-status-critical/10 border border-status-critical/30 rounded-md transition-colors disabled:opacity-40 cursor-pointer focus-visible:ring-2 focus-visible:ring-status-critical"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">delete_sweep</span>
              Clear Log
            </button>
          ) : null}
        </div>

        {/* Incidents Table / List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading && incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
              <p className="font-label-mono text-sm">Loading incident records from SQLite...</p>
            </div>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary gap-2">
              <span className="material-symbols-outlined text-status-normal text-4xl" aria-hidden="true">check_circle</span>
              <p className="font-semibold text-text-primary">No Incident Records Found</p>
              <p className="text-xs max-w-sm">
                The transformer has operated within safe capacity parameters during the recorded window.
              </p>
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-label="Incident history table"
              className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              <table className="w-full text-left border-collapse text-xs min-w-[640px]">
                <thead>
                  <tr className="border-b border-border-subtle font-label-mono uppercase text-text-secondary">
                    <th scope="col" className="py-2.5 px-3">Timestamp</th>
                    <th scope="col" className="py-2.5 px-3">Surge Status</th>
                    <th scope="col" className="py-2.5 px-3">Predicted Load</th>
                    <th scope="col" className="py-2.5 px-3">Utilization</th>
                    <th scope="col" className="py-2.5 px-3">Dynamic Tariff</th>
                    <th scope="col" className="py-2.5 px-3">Mitigations</th>
                    <th scope="col" className="py-2.5 px-3">Operator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle/50">
                  {incidents.map((inc) => {
                    const isCrit = inc.surge_status === 'CRITICAL';
                    return (
                      <tr key={inc.id} className="hover:bg-surface-variant/30 transition-colors">
                        <td className="py-2.5 px-3 font-label-mono text-text-secondary whitespace-nowrap">
                          {new Date(inc.timestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-mono font-bold text-[10px] uppercase border ${
                              isCrit
                                ? 'bg-status-critical/15 text-status-critical border-status-critical/30'
                                : 'bg-status-warning/15 text-status-warning border-status-warning/30'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
                              {isCrit ? 'error' : 'warning'}
                            </span>
                            <span>{inc.surge_status}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-label-mono font-semibold text-text-primary whitespace-nowrap">
                          {inc.predicted_load_kw.toFixed(1)} kW
                        </td>
                        <td className="py-2.5 px-3 font-label-mono text-text-secondary whitespace-nowrap">
                          {inc.capacity_utilization_pct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 font-label-mono font-bold text-accent whitespace-nowrap">
                          x{inc.tariff_multiplier.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-text-secondary whitespace-nowrap">
                          {inc.throttled_bays_count > 0 && (
                            <span className="text-status-warning font-medium mr-2 inline-flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[12px]" aria-hidden="true">tune</span>
                              {inc.throttled_bays_count} throttled
                            </span>
                          )}
                          {inc.shed_bays_count > 0 && (
                            <span className="text-status-critical font-medium inline-flex items-center gap-0.5">
                              <span className="material-symbols-outlined text-[12px]" aria-hidden="true">power_off</span>
                              {inc.shed_bays_count} shed
                            </span>
                          )}
                          {inc.throttled_bays_count === 0 && inc.shed_bays_count === 0 && 'Tariff only'}
                        </td>
                        <td className="py-2.5 px-3 font-label-mono text-text-secondary whitespace-nowrap">
                          {inc.operator_username || 'system'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border-subtle bg-surface-container-lowest/60 flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close modal dialog"
            className="px-4 py-2 min-h-[44px] bg-surface-variant hover:bg-surface-bright text-text-primary rounded-lg text-xs font-label-mono transition-colors border border-border-subtle cursor-pointer focus-visible:ring-2 focus-visible:ring-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
