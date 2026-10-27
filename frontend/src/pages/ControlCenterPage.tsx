import { ForecastTimeline } from '../components/Dashboard/ForecastTimeline';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import { ReportTemplate } from '../components/Dashboard/ReportTemplate';
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
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col items-center justify-center min-h-[220px]">
            <div className="flex justify-between w-full mb-4">
              <SkeletonText className="w-36 h-5" />
              <Skeleton className="w-14 h-5 rounded-full" />
            </div>
            <Skeleton className="w-32 h-32 rounded-full my-2" />
            <SkeletonText className="w-28 h-4 mt-2" />
          </div>

          {/* Tile 2: Surge Risk */}
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col justify-between min-h-[200px]">
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
          <div className="rounded-2xl bg-surface-container-lowest/60 border border-border-subtle/50 p-6 flex flex-col justify-between min-h-[200px]">
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
  } = useData();
  const { user } = useAuth();
  const reportRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

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

  const displayCapacityPct =
    (simulateData.simulated_peak_kw / predictData.transformer_capacity_kw) * 100;
  const displaySurgeStatus = simulateData.surge_risk;

  const handleGenerateReport = async () => {
    if (!reportRef.current) return;
    setIsGenerating(true);
    try {
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
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-headline-xl text-headline-xl text-text-primary">System Overview</h2>
        
        <button
          onClick={handleGenerateReport}
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2 bg-surface-variant hover:bg-surface-bright text-text-primary rounded-lg transition-colors border border-outline-variant font-label-mono text-sm tracking-wide shadow-lg disabled:opacity-50"
        >
          {isGenerating ? (
            <div className="w-5 h-5 border-2 border-text-secondary border-t-text-primary rounded-full animate-spin" />
          ) : (
            <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
          )}
          {isGenerating ? 'GENERATING...' : 'Generate Report'}
        </button>
      </div>

      {isSimulationMode && (
        <div className="mb-8 p-3 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-between shadow-[0_0_15px_rgba(34,211,238,0.15)]">
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
          tariffMultiplier={simulateData.dispatched_mitigations.dynamic_tariff_multiplier}
          predictedLoadKw={predictData.predicted_load_kw}
          transformerCapacityKw={predictData.transformer_capacity_kw}
          recommendedActions={predictData.recommended_actions}
          recentEvents={recentEvents}
          isSimulated={isSimulationMode}
        />
      </div>

      <ReportTemplate ref={reportRef} />
    </>
  );
}
