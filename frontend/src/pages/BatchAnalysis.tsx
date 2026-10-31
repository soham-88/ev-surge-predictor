import React, { useState, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Scatter,
  ComposedChart
} from 'recharts';
import { Tile } from '../components/ui/Tile';
import { AnimatedNumber } from '../components/ui/AnimatedNumber';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../context/ToastContext';
import { api } from '../services/api';
import type { BatchPredictResponse } from '../types/telemetry';

export function BatchAnalysis() {
  const toast = useToast();
  const [dragActive, setDragActive] = useState(false);

  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [missingCols, setMissingCols] = useState<string[]>([]);
  const [result, setResult] = useState<BatchPredictResponse | null>(null);
  
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const processFile = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      setErrorMsg('Only .csv files are supported.');
      setUploadState('error');
      return;
    }
    

    setUploadState('uploading');
    setErrorMsg(null);
    setMissingCols([]);
    setResult(null);
    setPage(1);

    // Simulate short progress for uploading visual
    await new Promise(r => setTimeout(r, 800));
    setUploadState('processing');

    try {
      const res = await api.uploadBatchCSV(selectedFile);
      setResult(res);
      setUploadState('success');
      toast.success(
        `Batch analysis complete: ${res.rows_processed} predictions generated (${res.summary.critical_events_count} critical surges detected).`,
        'Batch Processing Complete'
      );
    } catch (err: any) {
      setUploadState('error');
      if (err.status === 422 && err.data?.detail?.expected_columns) {
        setErrorMsg('Missing required columns in CSV.');
        setMissingCols(err.data.detail.expected_columns);
      } else {
        const detail = err.data?.detail;
        let msg = 'An unexpected error occurred during batch processing.';
        if (typeof detail === 'string') {
          msg = detail;
        } else if (detail?.message) {
          msg = detail.message;
        } else if (Array.isArray(detail) && detail.length > 0 && detail[0].msg) {
          msg = detail[0].msg;
        } else if (typeof detail === 'object') {
          msg = JSON.stringify(detail);
        }
        setErrorMsg(msg);
      }
    }
  };

  const handleReset = () => {

    setUploadState('idle');
    setResult(null);
    setErrorMsg(null);
    setMissingCols([]);
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!result) return [];
    return result.predictions.map(p => ({
      ...p,
      timeLabel: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      critical_point: p.surge_status === 'CRITICAL' ? p.predicted_kw : null
    }));
  }, [result]);

  const paginatedRows = useMemo(() => {
    if (!result) return [];
    const start = (page - 1) * rowsPerPage;
    return result.predictions.slice(start, start + rowsPerPage);
  }, [result, page]);

  const totalPages = result ? Math.ceil(result.predictions.length / rowsPerPage) : 1;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline-xl text-text-primary mb-2 tracking-tight">Batch Analysis</h1>
          <p className="text-text-secondary font-body-md max-w-2xl">
            Upload historical or synthesized telemetry CSVs for large-scale vectorized surge prediction.
          </p>
        </div>
        {result && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-surface-variant hover:bg-surface-bright text-text-primary rounded-lg transition-colors border border-outline-variant font-label-mono text-xs tracking-widest"
            >
              UPLOAD NEW FILE
            </button>
          </motion.div>
        )}
      </div>

      {!result && (
        <Tile className="p-8">
          <div
            className={`relative flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl transition-all duration-300 ${
              dragActive 
                ? 'border-primary bg-primary/5 shadow-[0_0_30px_rgba(138,235,255,0.15)]' 
                : 'border-outline-variant hover:border-primary/50 hover:bg-surface-variant/30'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleChange}
            />

            {uploadState === 'idle' && (
              <EmptyState
                icon="upload_file"
                title="No Batch Dataset Loaded"
                description="Upload a historical or synthesized telemetry CSV with timestamps, ambient conditions, and load lags to perform vectorized surge prediction."
                action={
                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-6 py-2.5 bg-primary text-on-primary font-bold rounded-lg hover:shadow-[0_0_15px_rgba(138,235,255,0.4)] transition-all font-label-mono text-xs uppercase tracking-wider cursor-pointer"
                    >
                      Browse Files
                    </button>
                    <span className="font-label-mono text-text-secondary text-[11px]">
                      or drag & drop your .csv file directly into this dropzone
                    </span>
                  </div>
                }
                className="bg-transparent border-0 p-0 shadow-none"
              />
            )}

            {uploadState === 'uploading' && (
              <div className="flex flex-col items-center gap-4 w-full max-w-xs">
                <span className="material-symbols-outlined text-4xl text-primary animate-bounce">cloud_upload</span>
                <p className="font-label-mono tracking-widest text-primary text-xs uppercase font-bold">UPLOADING CSV...</p>
                <div className="w-full h-2 bg-surface-bright rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </div>
            )}

            {uploadState === 'processing' && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-t-primary border-primary/20 animate-spin" />
                <p className="font-label-mono tracking-widest text-primary animate-pulse text-xs uppercase font-bold">RUNNING VECTORIZED INFERENCE...</p>
              </div>
            )}

            {uploadState === 'error' && (
              <div className="flex flex-col items-center text-center w-full max-w-md mx-auto">
                <div className="w-16 h-16 rounded-full bg-status-critical/15 border border-status-critical/30 flex items-center justify-center mb-4 text-status-critical shadow-[0_0_20px_rgba(244,63,94,0.25)]">
                  <span className="material-symbols-outlined text-3xl">warning</span>
                </div>
                <h3 className="font-headline-md text-lg font-bold text-status-critical mb-1">
                  CSV Validation Error
                </h3>
                <p className="font-body-md text-text-secondary mb-4 text-xs leading-relaxed">
                  {errorMsg}
                </p>
                
                {missingCols.length > 0 && (
                  <div className="bg-status-critical/10 border border-status-critical/30 rounded-xl p-4 mb-6 text-left w-full shadow-inner">
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="material-symbols-outlined text-status-critical text-base">checklist</span>
                      <p className="font-label-mono text-status-critical text-xs uppercase tracking-wider font-bold">
                        Missing Required Columns ({missingCols.length})
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {missingCols.map(c => (
                        <span key={c} className="px-2.5 py-1 bg-status-critical/20 border border-status-critical/40 text-status-critical text-xs rounded-md font-label-mono font-semibold">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <button
                  onClick={() => {
                    setUploadState('idle');
                    setErrorMsg(null);
                    setMissingCols([]);
                  }}
                  className="px-6 py-2.5 bg-surface-variant hover:bg-surface-bright text-text-primary rounded-xl transition-colors border border-outline-variant font-label-mono text-xs uppercase tracking-widest font-bold cursor-pointer"
                >
                  UPLOAD DIFFERENT CSV
                </button>
              </div>
            )}
          </div>
        </Tile>
      )}

      {/* Results View */}
      {result && (
        <motion.div 
          className="flex flex-col gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {/* Summary Strip */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Tile className="p-4 flex flex-col justify-center">
              <span className="font-label-mono text-text-secondary text-xs uppercase tracking-widest mb-1">Rows Processed</span>
              <div className="font-kpi-large text-primary"><AnimatedNumber value={result.rows_processed} /></div>
            </Tile>
            <Tile className="p-4 flex flex-col justify-center">
              <span className="font-label-mono text-text-secondary text-xs uppercase tracking-widest mb-1">Peak Predicted Load</span>
              <div className="font-kpi-large text-text-primary">
                <AnimatedNumber value={result.summary.peak_predicted_kw} />
                <span className="text-xl text-text-secondary ml-1">kW</span>
              </div>
            </Tile>
            <Tile className="p-4 flex flex-col justify-center">
              <span className="font-label-mono text-text-secondary text-xs uppercase tracking-widest mb-1">Critical Events</span>
              <div className={`font-kpi-large ${result.summary.critical_events_count > 0 ? 'text-status-critical' : 'text-status-normal'}`}>
                <AnimatedNumber value={result.summary.critical_events_count} />
              </div>
            </Tile>
            <Tile className="p-4 flex flex-col justify-center">
              <span className="font-label-mono text-text-secondary text-xs uppercase tracking-widest mb-1">Avg MAE (t+2h)</span>
              <div className="font-kpi-large text-text-primary">
                {result.summary.avg_mae_vs_actual_kw !== null ? (
                  <>
                    <AnimatedNumber value={result.summary.avg_mae_vs_actual_kw} />
                    <span className="text-xl text-text-secondary ml-1">kW</span>
                  </>
                ) : (
                  <span className="text-text-secondary text-xl">N/A</span>
                )}
              </div>
            </Tile>
          </div>

          {/* Chart Overlay */}
          <Tile className="p-6 h-100 flex flex-col">
            <h2 className="font-headline-md text-text-primary mb-6">Actual vs Predicted (+2h) Timeline</h2>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="predGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d0bcff" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#d0bcff" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis 
                    dataKey="timeLabel" 
                    stroke="#859397" 
                    tick={{ fill: '#859397', fontSize: 12, fontFamily: 'JetBrains Mono' }}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                    minTickGap={30}
                  />
                  <YAxis 
                    stroke="#859397" 
                    tick={{ fill: '#859397', fontSize: 12, fontFamily: 'JetBrains Mono' }}
                    tickLine={false}
                    axisLine={false}
                    dx={-10}
                    domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin - 20)), (dataMax: number) => Math.ceil(dataMax + 20)]}
                  />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 17, 23, 0.9)', 
                      borderColor: 'rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontFamily: 'JetBrains Mono',
                      fontSize: '12px'
                    }}
                  />
                  
                  {result.summary.avg_mae_vs_actual_kw !== null && (
                    <Line 
                      type="monotone" 
                      dataKey="actual_kw" 
                      name="Actual (t+2h)" 
                      stroke="#22d3ee" 
                      strokeWidth={2} 
                      dot={false}
                      activeDot={{ r: 4, fill: '#22d3ee', strokeWidth: 0 }}
                    />
                  )}
                  
                  <Line 
                    type="monotone" 
                    dataKey="predicted_kw" 
                    name="Predicted (+2h)" 
                    stroke="#d0bcff" 
                    strokeWidth={2} 
                    strokeDasharray="4 4"
                    dot={false} 
                  />

                  {/* Red dots for CRITICAL */}
                  <Scatter dataKey="critical_point" fill="#f43f5e" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Tile>

          {/* Table & Download */}
          <Tile className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-headline-md text-text-primary">Prediction Results</h2>
              <button 
                onClick={async () => {
                  try {
                    await api.downloadBatchCSV(result.batch_id);
                  } catch (e) {
                    console.error('Failed to download CSV', e);
                  }
                }}
                className="px-4 py-2 bg-primary text-on-primary hover:shadow-[0_0_15px_rgba(138,235,255,0.4)] rounded-lg transition-all font-bold text-sm flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                Download CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/50 font-label-mono text-text-secondary text-xs tracking-widest">
                    <th className="pb-3 font-normal uppercase">Timestamp</th>
                    <th className="pb-3 font-normal uppercase text-right">Actual (t+2h) kW</th>
                    <th className="pb-3 font-normal uppercase text-right">Predicted (+2h) kW</th>
                    <th className="pb-3 font-normal uppercase text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row, i) => (
                    <tr key={i} className="border-b border-outline-variant/30 hover:bg-surface-variant/30 transition-colors">
                      <td className="py-3 font-label-mono text-sm text-text-primary">{new Date(row.timestamp).toISOString()}</td>
                      <td className="py-3 font-label-mono text-sm text-text-secondary text-right">
                        {row.actual_kw !== null ? row.actual_kw.toFixed(1) : '-'}
                      </td>
                      <td className="py-3 font-label-mono text-sm text-primary text-right">{row.predicted_kw.toFixed(1)}</td>
                      <td className="py-3 text-right">
                        <span className={`px-2 py-1 rounded text-xs font-bold tracking-wide ${
                          row.surge_status === 'CRITICAL' ? 'bg-status-critical/20 text-status-critical' :
                          row.surge_status === 'WARNING' ? 'bg-status-warning/20 text-status-warning' :
                          'bg-status-normal/20 text-status-normal'
                        }`}>
                          {row.surge_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-sm font-label-mono text-text-secondary">
                <span>Showing {(page - 1) * rowsPerPage + 1} to {Math.min(page * rowsPerPage, result.predictions.length)} of {result.predictions.length}</span>
                <div className="flex items-center gap-2">
                  <button 
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="p-1 rounded hover:bg-surface-variant disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">chevron_left</span>
                  </button>
                  <span className="text-text-primary font-bold">Page {page} / {totalPages}</span>
                  <button 
                    disabled={page === totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="p-1 rounded hover:bg-surface-variant disabled:opacity-50 transition-colors"
                  >
                    <span className="material-symbols-outlined text-lg">chevron_right</span>
                  </button>
                </div>
              </div>
            )}
          </Tile>
        </motion.div>
      )}
    </div>
  );
}
