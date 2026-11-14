import { ForecastTimeline } from '../components/Dashboard/ForecastTimeline';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import { ReportTemplate } from '../components/Dashboard/ReportTemplate';
import { IncidentHistoryModal } from '../components/Dashboard/IncidentHistoryModal';
import { Skeleton, SkeletonText, ErrorState } from '../components/ui';

function ControlCenterSkeleton() {
  return (
    <>
      {/* Page Header Skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <SkeletonText className="w-56 h-9" />
        <Skeleton className="w-40 h-10 rounded-lg" />
      </div>

      {/* Grid Container Skeletons matching ForecastTimeline layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gap-grid auto-rows-min">
        {/* 8-col Hero Chart Skeleton */}
        <div className="md:col-span-8 rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col min-h-100 justify-between">
          <div className="flex justify-between items-start mb-6">
            <div className="flex flex-col gap-2">
              <SkeletonText className="w-48 h-6" />
              <SkeletonText className="w-32 h-4" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="w-16 h-8 rounded-lg" />
              <Skeleton className="w-16 h-8 rounded-lg" />
            </div>
          </div>
          {/* Shimmer Chart Canvas placeholder */}
          <Skeleton className="w-full h-64 rounded-xl my-4" />
          <div className="flex justify-between items-center pt-4 border-t border-border-subtle/40">
            <SkeletonText className="w-40 h-4" />
            <SkeletonText className="w-24 h-4" />
          </div>
        </div>

        {/* 4-col Side Cards (Transformer Gauge, Surge Risk, Mitigation) */}
        <div className="md:col-span-4 flex flex-col gap-gap-grid">
          {/* Tile 1: Gauge */}
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col items-center justify-center">
            <div className="flex justify-between w-full mb-4">
              <SkeletonText className="w-36 h-5" />
              <Skeleton className="w-14 h-5 rounded-full" />
            </div>
            <Skeleton className="w-32 h-32 rounded-full my-2" />
            <SkeletonText className="w-28 h-4 mt-2" />
          </div>

          {/* Tile 2: Surge Risk */}
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <SkeletonText className="w-36 h-5" />
              <Skeleton className="w-20 h-6 rounded-full" />
            </div>
            <div className="my-4">
              <SkeletonText className="w-24 h-3 mb-2" />
              <Skeleton className="w-32 h-10 rounded" />
            </div>
            <SkeletonText className="w-48 h-4" />
          </div>

          {/* Tile 3: Mitigations */}
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col justify-between">
            <div className="flex justify-between items-start">
              <SkeletonText className="w-40 h-5" />
              <Skeleton className="w-16 h-6 rounded-full" />
            </div>
            <div className="flex flex-col gap-2 my-4">
              <SkeletonText className="w-full h-4" />
              <SkeletonText className="w-3/4 h-4" />
            </div>
            <Skeleton className="w-full h-8 rounded-lg" />
          </div>
        </div>
      </div>
    </>
  );
}

export function ControlCenterPage() {
  const {
    predictData,
    simulateData,
    recentEvents,
    isSimulationMode,
    addToast,
    isLoading,
    isRetrying,
    hasError,
    errorMessage,
    retryLoad,
    activeScenarioId,
    switchScenario,
    scenarios,
  } = useData();
  const { user } = useAuth();
  const reportRef = useRef<HTMLDivElement>(null);
  const incidentLogButtonRef = useRef<HTMLButtonElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);

  if (isLoading) {
    return <ControlCenterSkeleton />;
  }

  if (hasError || !predictData || !simulateData) {
    return (
      <div className="py-12 max-w-2xl mx-auto">
        <ErrorState
          title="Backend Telemetry Unavailable"
          message={errorMessage || 'Unable to connect to the Grid Pulse backend. The FastAPI service may be stopped or unreachable.'}
          onRetry={retryLoad}
          isRetrying={isRetrying}
        />
      </div>
    );
  }

  const displayCapacityPct = isSimulationMode
    ? (simulateData.simulated_peak_kw / predictData.transformer_capacity_kw) * 100
    : predictData.capacity_utilization_pct;
  const displaySurgeStatus = isSimulationMode
    ? simulateData.surge_risk
    : predictData.surge_status;
  const displayTariffMultiplier = isSimulationMode
    ? simulateData.dispatched_mitigations.dynamic_tariff_multiplier
    : predictData.recommended_actions.dynamic_tariff_multiplier;

  const handleGenerateReport = async () => {
    if (!reportRef.current) return;
    setIsGenerating(true);
    try {
      const [jsPDFModule, html2canvasModule] = await Promise.all([
        import('jspdf'),
        import('html2canvas-pro'),
      ]);
      const jsPDF = jsPDFModule.default;
      const html2canvas = html2canvasModule.default;

      // The element must be temporarily visible (opacity 1) for html2canvas to capture it 
      // accurately if it relies on SVG animations, though absolute offscreen is usually fine.
      // Wait a moment for Recharts to draw.
      await new Promise(r => setTimeout(r, 800));

      const canvas = await html2canvas(reportRef.current, {
        scale: 2, // High resolution
        useCORS: true,
        backgroundColor: '#121318', // match background
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [reportRef.current.offsetWidth, reportRef.current.offsetHeight]
      });

      pdf.addImage(imgData, 'PNG', 0, 0, reportRef.current.offsetWidth, reportRef.current.offsetHeight);
      
      const pdfBlob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `ev_surge_report_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Failed to generate PDF', err);
      addToast({
        type: 'CRITICAL',
        title: 'REPORT FAILED',
        message: 'Could not generate the PDF report. See console for details.'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      {/* Page Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline-xl text-headline-xl text-text-primary">System Overview</h1>
          <p className="font-body-sm text-text-secondary mt-1">2-Hour Ahead Transformer Load & Surge Mitigation</p>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap w-full sm:w-auto">
          {/* Telemetry Scenario Switcher */}
          <div className="flex items-center gap-2 bg-surface-container-low border border-border-subtle rounded-lg px-2.5 sm:px-3 py-1.5 shadow-sm max-w-full flex-wrap sm:flex-nowrap">
            <span className="material-symbols-outlined text-[18px] text-text-secondary shrink-0" aria-hidden="true">tune</span>
            <label htmlFor="feed-scenario-select" className="font-label-mono text-xs uppercase text-text-secondary tracking-wider shrink-0">
              Feed:
            </label>
            <select
              id="feed-scenario-select"
              value={activeScenarioId}
              onChange={(e) => switchScenario(e.target.value)}
              className="bg-transparent text-xs sm:text-sm font-medium text-text-primary focus:outline-none cursor-pointer max-w-[150px] xs:max-w-[200px] sm:max-w-none truncate pr-1"
              title="Switch simulated real-world telemetry scenario"
              aria-label="Select Telemetry Scenario"
            >
              {scenarios.map((scen) => (
                <option key={scen.id} value={scen.id} className="bg-surface-container text-text-primary">
                  {scen.name} ({scen.telemetry.active_plugs} bays, {scen.telemetry.ambient_temp_c}°C)
                </option>
              ))}
            </select>
            <span className="bg-primary/20 text-primary border border-primary/30 px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] uppercase font-bold tracking-widest font-label-mono leading-none shrink-0">
              Simulated telemetry
            </span>
          </div>

          <button
            ref={incidentLogButtonRef}
            onClick={() => setIsIncidentModalOpen(true)}
            aria-label="View persistent SQLite incident history"
            className="flex-1 xs:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] bg-surface-container-low hover:bg-surface-variant text-text-primary rounded-lg transition-colors border border-border-subtle font-label-mono text-sm tracking-wide shadow-sm cursor-pointer focus-visible:ring-2 focus-visible:ring-primary whitespace-nowrap"
            title="View persistent SQLite incident history"
          >
            <span className="material-symbols-outlined text-[18px] text-status-warning" aria-hidden="true">history_toggle_off</span>
            <span>Incident Log</span>
          </button>

          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            aria-label="Generate PDF diagnostic report"
            className="flex-1 xs:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-surface-variant hover:bg-surface-bright text-text-primary rounded-lg transition-colors border border-outline-variant font-label-mono text-sm tracking-wide shadow-lg disabled:opacity-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary whitespace-nowrap"
          >
            {isGenerating ? (
              <div className="w-5 h-5 border-2 border-text-secondary border-t-text-primary rounded-full animate-spin motion-reduce:animate-none" />
            ) : (
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">picture_as_pdf</span>
            )}
            {isGenerating ? 'GENERATING...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {isSimulationMode && (
        <div
          role="status"
          aria-live="polite"
          className="mb-8 p-3 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-between shadow-[0_0_15px_rgba(34,211,238,0.15)]"
        >
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">science</span>
            <span className="font-body-md text-text-primary font-bold tracking-wide">SIMULATION ACTIVE — viewing hypothetical data</span>
          </div>
          {user?.role === 'Operator' && (
            <Link 
              to="/sandbox" 
              className="font-label-mono text-sm text-primary hover:text-primary-container underline transition-colors font-bold"
            >
              Back to Sandbox
            </Link>
          )}
        </div>
      )}

      {/* Grid Container */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-gap-grid auto-rows-min">
        {/* Row 1: Hero Chart (8-col) + 3 Utility cards (4-col each stacked or side by side) */}
        <ForecastTimeline
          data={simulateData.timeline}
          capacityPct={displayCapacityPct}
          surgeStatus={displaySurgeStatus}
          tariffMultiplier={displayTariffMultiplier}
          predictedLoadKw={predictData.predicted_load_kw}
          transformerCapacityKw={predictData.transformer_capacity_kw}
          lowerBoundKw={predictData.lower_bound_kw}
          upperBoundKw={predictData.upper_bound_kw}
          recommendedActions={predictData.recommended_actions}
          recentEvents={recentEvents}
          isSimulated={isSimulationMode}
        />
      </div>

      <ReportTemplate ref={reportRef} />
      <IncidentHistoryModal
        isOpen={isIncidentModalOpen}
        onClose={() => setIsIncidentModalOpen(false)}
        triggerRef={incidentLogButtonRef}
      />
    </>
  );
}
