import { describe, it, expect } from 'vitest';
import {
  calculateTariffEstimate,
  formatDuration,
  formatRupees,
} from '../utils/tariffEstimate';

describe('Tariff Estimate Calculations', () => {
  it('correctly calculates example scenario: 30 kWh, 7.2 kW, 12 INR/kWh, 1.2x multiplier', () => {
    const result = calculateTariffEstimate({
      energyKwh: 30,
      baseRateRupeesPerKwh: 12.0,
      effectiveMultiplier: 1.2,
      avgPowerKw: 7.2,
    });

    expect(result.costNow).toBe(432);
    expect(result.costNominal).toBe(360);
    expect(result.diff).toBe(72);
    expect(result.diffFormatted).toBe('+₹72');
    expect(result.durationHours).toBe(4);
    expect(result.durationMins).toBe(10);
    expect(result.durationFormatted).toBe('~4h 10m');
    expect(result.summaryText).toBe(
      'A 30 kWh session costs ₹432 (+₹72 vs nominal) and takes ~4h 10m on a 7.2 kW charger.'
    );
  });

  it('handles zero energy kWh', () => {
    const result = calculateTariffEstimate({
      energyKwh: 0,
      baseRateRupeesPerKwh: 12.0,
      effectiveMultiplier: 1.5,
      avgPowerKw: 7.2,
    });

    expect(result.costNow).toBe(0);
    expect(result.costNominal).toBe(0);
    expect(result.diff).toBe(0);
    expect(result.diffFormatted).toBe('₹0');
    expect(result.durationHours).toBe(0);
    expect(result.durationMins).toBe(0);
    expect(result.durationFormatted).toBe('~0m');
    expect(result.summaryText).toContain('A 0 kWh session costs ₹0 (₹0 vs nominal)');
  });

  it('handles zero base rate', () => {
    const result = calculateTariffEstimate({
      energyKwh: 50,
      baseRateRupeesPerKwh: 0,
      effectiveMultiplier: 1.35,
      avgPowerKw: 45.0,
    });

    expect(result.costNow).toBe(0);
    expect(result.costNominal).toBe(0);
    expect(result.diff).toBe(0);
  });

  it('handles negative or invalid NaN energy values by clamping to 0', () => {
    const resultNegative = calculateTariffEstimate({
      energyKwh: -25,
      baseRateRupeesPerKwh: 12.0,
      effectiveMultiplier: 1.2,
      avgPowerKw: 7.2,
    });
    expect(resultNegative.costNow).toBe(0);
    expect(resultNegative.durationFormatted).toBe('~0m');

    const resultNaN = calculateTariffEstimate({
      energyKwh: Number.NaN,
      baseRateRupeesPerKwh: Number.NaN,
      effectiveMultiplier: Number.NaN,
      avgPowerKw: Number.NaN,
    });
    expect(resultNaN.costNow).toBe(0);
    expect(resultNaN.costNominal).toBe(0);
    expect(resultNaN.diff).toBe(0);
    expect(resultNaN.durationFormatted).toBe('~0m');
  });

  it('handles discount / sub-nominal multipliers (< 1.0x, e.g. Two-Wheeler 0.85x)', () => {
    const result = calculateTariffEstimate({
      energyKwh: 10,
      baseRateRupeesPerKwh: 10.0,
      effectiveMultiplier: 0.85,
      avgPowerKw: 1.2,
    });

    expect(result.costNow).toBe(85);
    expect(result.costNominal).toBe(100);
    expect(result.diff).toBe(-15);
    expect(result.diffFormatted).toBe('-₹15');
  });

  it('handles very large values without overflowing or precision errors', () => {
    const result = calculateTariffEstimate({
      energyKwh: 100000,
      baseRateRupeesPerKwh: 25.5,
      effectiveMultiplier: 2.43,
      avgPowerKw: 150.0,
    });

    expect(result.costNow).toBe(6196500);
    expect(result.costNominal).toBe(2550000);
    expect(result.diff).toBe(3646500);
    expect(Number.isFinite(result.durationHours)).toBe(true);
    expect(result.summaryText).toContain('A 100000 kWh session costs ₹6196500');
  });

  it('formats duration edge cases correctly', () => {
    expect(formatDuration(0).formatted).toBe('~0m');
    expect(formatDuration(0.5).formatted).toBe('~30m');
    expect(formatDuration(2.0).formatted).toBe('~2h');
    expect(formatDuration(1.99).formatted).toBe('~1h 59m');
    expect(formatDuration(1.999).formatted).toBe('~2h');
    expect(formatDuration(2.25).formatted).toBe('~2h 15m');
    expect(formatDuration(-5).formatted).toBe('~0m');
    expect(formatDuration(Number.POSITIVE_INFINITY).formatted).toBe('~0m');
  });

  it('formats rupees correctly for integer and decimal values', () => {
    expect(formatRupees(432)).toBe('432');
    expect(formatRupees(432.5)).toBe('432.50');
    expect(formatRupees(0)).toBe('0');
  });
});
