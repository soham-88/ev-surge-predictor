import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { IncidentItem } from '../../types/telemetry';
import { useAuth } from '../../context/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function IncidentHistoryModal({ isOpen, onClose }: Props) {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'CRITICAL' | 'WARNING'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const fetchIncidents = async () => {
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
  };

  useEffect(() => {
    if (isOpen) {
      fetchIncidents();
    }
  }, [isOpen, filter]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl bg-surface-container-low border border-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle bg-surface-container-lowest/60">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-status-warning text-2xl">history_toggle_off</span>
            <div>
              <h3 className="font-headline-sm text-headline-sm text-text-primary">
                Grid Surge Incident History
              </h3>
              <p className="font-body-sm text-text-secondary">
                Persistent audit log of 250 kW transformer stress &amp; mitigation events
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchIncidents}
              disabled={isLoading}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-variant rounded-lg transition-colors cursor-pointer"
              title="Refresh incidents"
            >
              <span className={`material-symbols-outlined text-[20px] ${isLoading ? 'animate-spin' : ''}`}>
                refresh
              </span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-variant rounded-lg transition-colors cursor-pointer"
              title="Close modal"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Toolbar & Filters */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-surface-container-lowest/30">
          <div className="flex items-center gap-2">
            {(['ALL', 'CRITICAL', 'WARNING'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilter(mode)}
                className={`px-3 py-1 rounded-md text-xs font-label-mono font-medium transition-colors cursor-pointer ${
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
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-status-critical hover:bg-status-critical/10 border border-status-critical/30 rounded-md transition-colors disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
              Clear Log
            </button>
          ) : null}
        </div>

        {/* Incidents Table / List */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading && incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary gap-3">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="font-label-mono text-sm">Loading incident records from SQLite...</p>
            </div>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary gap-2">
              <span className="material-symbols-outlined text-status-normal text-4xl">check_circle</span>
              <p className="font-semibold text-text-primary">No Incident Records Found</p>
              <p className="text-xs max-w-sm">
                The transformer has operated within safe capacity parameters during the recorded window.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border-subtle font-label-mono uppercase text-text-secondary">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Surge Status</th>
                    <th className="py-2.5 px-3">Predicted Load</th>
                    <th className="py-2.5 px-3">Utilization</th>
                    <th className="py-2.5 px-3">Dynamic Tariff</th>
                    <th className="py-2.5 px-3">Mitigations</th>
                    <th className="py-2.5 px-3">Operator</th>
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
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded font-label-mono font-bold text-[10px] uppercase border ${
                              isCrit
                                ? 'bg-status-critical/15 text-status-critical border-status-critical/30'
                                : 'bg-status-warning/15 text-status-warning border-status-warning/30'
                            }`}
                          >
                            {inc.surge_status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-label-mono font-semibold text-text-primary">
                          {inc.predicted_load_kw.toFixed(1)} kW
                        </td>
                        <td className="py-2.5 px-3 font-label-mono text-text-secondary">
                          {inc.capacity_utilization_pct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 font-label-mono font-bold text-accent">
                          x{inc.tariff_multiplier.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-text-secondary">
                          {inc.throttled_bays_count > 0 && (
                            <span className="text-status-warning font-medium mr-2">
                              {inc.throttled_bays_count} throttled
                            </span>
                          )}
                          {inc.shed_bays_count > 0 && (
                            <span className="text-status-critical font-medium">
                              {inc.shed_bays_count} shed
                            </span>
                          )}
                          {inc.throttled_bays_count === 0 && inc.shed_bays_count === 0 && 'Tariff only'}
                        </td>
                        <td className="py-2.5 px-3 font-label-mono text-text-secondary">
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
            className="px-4 py-2 bg-surface-variant hover:bg-surface-bright text-text-primary rounded-lg text-xs font-label-mono transition-colors border border-border-subtle cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
