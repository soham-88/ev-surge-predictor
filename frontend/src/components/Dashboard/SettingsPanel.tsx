import { motion, AnimatePresence } from 'motion/react';
import { useData } from '../../context/DataContext';
import { StyledSlider } from '../ui/StyledSlider';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: Props) {
  const { settings, updateSettings } = useData();

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-background/60 backdrop-blur-sm">
          {/* Backdrop click to close */}
          <div className="absolute inset-0" onClick={onClose} />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md bg-surface border border-border-subtle rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-border-subtle bg-surface-variant/20">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-2xl">tune</span>
                <h2 className="font-headline-md text-text-primary">System Settings</h2>
              </div>
              <button 
                onClick={onClose}
                className="text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 flex flex-col gap-8">
              <p className="font-body-sm text-text-secondary -mt-2">
                Adjust surge thresholds and transformer parameters. Changes apply immediately across all modules.
              </p>
              
              <StyledSlider
                label="WARNING Threshold"
                value={settings.warningThresholdPct}
                min={50}
                max={99}
                step={1}
                unit="%"
                onChange={(v) => updateSettings({ warningThresholdPct: v })}
              />

              <StyledSlider
                label="CRITICAL Threshold"
                value={settings.criticalThresholdPct}
                min={50}
                max={99}
                step={1}
                unit="%"
                onChange={(v) => updateSettings({ criticalThresholdPct: v })}
              />

              <StyledSlider
                label="Transformer Capacity"
                value={settings.transformerCapacityKw}
                min={100}
                max={1000}
                step={10}
                unit="kW"
                onChange={(v) => updateSettings({ transformerCapacityKw: v })}
              />
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border-subtle bg-surface-variant/10 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg font-label-mono text-sm tracking-widest font-bold transition-colors cursor-pointer"
              >
                DONE
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
