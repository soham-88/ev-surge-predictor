/**
 * Utility functions for estimating EV charging session costs and durations.
 */

export interface TariffEstimateInput {
  energyKwh: number;
  baseRateRupeesPerKwh: number;
  effectiveMultiplier: number;
  avgPowerKw: number;
}

export interface TariffEstimateOutput {
  durationHours: number;
  durationMins: number;
  durationFormatted: string;
  costNow: number;
  costNominal: number;
  diff: number;
  diffFormatted: string;
  summaryText: string;
}

export const CATEGORY_DEFAULTS = {
  two_wheeler: {
    energyKwh: 3,
    avgPowerKw: 1.2,
    label: 'Two-Wheeler EV',
  },
  standard_4w: {
    energyKwh: 30,
    avgPowerKw: 7.2,
    label: 'Standard 4W EV',
  },
  fast_charging: {
    energyKwh: 50,
    avgPowerKw: 45.0,
    label: 'Fast-Charging EV',
  },
} as const;

export const DEFAULT_ILLUSTRATIVE_BASE_RATE = 12.0; // ₹12.00/kWh

export function formatRupees(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toString();
  }
  return amount.toFixed(2);
}

export function formatDuration(totalHours: number): {
  hours: number;
  mins: number;
  formatted: string;
} {
  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return { hours: 0, mins: 0, formatted: '~0m' };
  }
  let hours = Math.floor(totalHours);
  let mins = Math.round((totalHours - hours) * 60);
  if (mins === 60) {
    hours += 1;
    mins = 0;
  }
  let formatted: string;
  if (hours === 0 && mins === 0) {
    formatted = '~0m';
  } else if (hours === 0) {
    formatted = `~${mins}m`;
  } else if (mins === 0) {
    formatted = `~${hours}h`;
  } else {
    formatted = `~${hours}h ${mins}m`;
  }
  return { hours, mins, formatted };
}

export function calculateTariffEstimate(input: TariffEstimateInput): TariffEstimateOutput {
  const energy = Number.isFinite(input.energyKwh) ? Math.max(0, input.energyKwh) : 0;
  const baseRate = Number.isFinite(input.baseRateRupeesPerKwh) ? Math.max(0, input.baseRateRupeesPerKwh) : 0;
  const multiplier = Number.isFinite(input.effectiveMultiplier) ? Math.max(0, input.effectiveMultiplier) : 1.0;
  const avgPower = Number.isFinite(input.avgPowerKw) && input.avgPowerKw > 0 ? input.avgPowerKw : 1.0;

  const totalHours = avgPower > 0 ? energy / avgPower : 0;
  const { hours, mins, formatted: durationFormatted } = formatDuration(totalHours);

  const costNowRaw = energy * baseRate * multiplier;
  const costNominalRaw = energy * baseRate;
  const diffRaw = costNowRaw - costNominalRaw;

  const costNow = Math.round(costNowRaw * 100) / 100;
  const costNominal = Math.round(costNominalRaw * 100) / 100;
  const diff = Math.round(diffRaw * 100) / 100;

  let diffFormatted: string;
  if (diff > 0) {
    diffFormatted = `+₹${formatRupees(diff)}`;
  } else if (diff < 0) {
    diffFormatted = `-₹${formatRupees(Math.abs(diff))}`;
  } else {
    diffFormatted = '₹0';
  }

  const formattedCharger = Number.isInteger(avgPower) ? avgPower.toString() : avgPower.toFixed(1);
  const summaryText = `A ${energy} kWh session costs ₹${formatRupees(costNow)} (${diffFormatted} vs nominal) and takes ${durationFormatted} on a ${formattedCharger} kW charger.`;

  return {
    durationHours: hours,
    durationMins: mins,
    durationFormatted,
    costNow,
    costNominal,
    diff,
    diffFormatted,
    summaryText,
  };
}
