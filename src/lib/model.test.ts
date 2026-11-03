import { describe, expect, it } from 'vitest';
import { ELEMENTS, LINES, estimatedLimits, expectedSignal, fitCalibration, mean, measureStandard, rsd, sd, type Standard } from './model';

const standards = (xs: number[], ys: number[]): Standard[] => xs.map((concentration, index) => ({
  id: `s-${index}`,
  name: `Standard ${index}`,
  concentration,
  included: true,
  readings: [ys[index]],
}));

describe('regression and reporting', () => {
  it('recovers a free intercept and slope on an exact linear calibration', () => {
    const fit = fitCalibration(standards([0, 0.01, 0.1, 1, 10, 100], [7, 7.2, 9, 27, 207, 2007]), 'none')!;
    expect(fit.slope).toBeCloseTo(20, 10);
    expect(fit.intercept).toBeCloseTo(7, 10);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.residualSE).toBeCloseTo(0, 10);
    expect(fit.points[0].relativeError).toBeNull();
    expect(fit.points[2].backCalculated).toBeCloseTo(0.1, 10);
  });

  it('matches independently calculated OLS and WLS reference answers', () => {
    // References from the normal equations for x=[1,2,4], y=[1,2,3].
    const data = standards([1, 2, 4], [1, 2, 3]);
    const ols = fitCalibration(data, 'none')!;
    expect(ols.slope).toBeCloseTo(9 / 14, 12);
    expect(ols.intercept).toBeCloseTo(0.5, 12);
    const inverse = fitCalibration(data, '1/x')!;
    expect(inverse.slope).toBeCloseTo(9 / 13, 12);
    expect(inverse.intercept).toBeCloseTo(5 / 13, 12);
    const inverseSquared = fitCalibration(data, '1/x2')!;
    expect(inverseSquared.slope).toBeCloseTo(3 / 4, 12);
    expect(inverseSquared.intercept).toBeCloseTo(2 / 7, 12);
  });

  it('uses the lowest positive concentration as a finite blank-weight floor', () => {
    const fit = fitCalibration(standards([0, 1, 2], [1, 2, 4]), '1/x2')!;
    // Weights [1,1,1/4], centered WLS normal-equation solution.
    expect(fit.slope).toBeCloseTo(4 / 3, 12);
    expect(fit.intercept).toBeCloseTo(8 / 9, 12);
    expect(Number.isFinite(fit.r2)).toBe(true);
  });

  it('fits standard means and honors excluded standards', () => {
    const data = standards([0, 1, 2, 100], [1, 3, 5, -100000]);
    data[1].readings = [2, 4];
    data[3].included = false;
    const fit = fitCalibration(data, 'none')!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.points).toHaveLength(3);
  });

  it('reports undefined or invalid calibrations instead of misleading statistics', () => {
    expect(fitCalibration([], 'none')).toBeNull();
    expect(fitCalibration(standards([0, 1], [1, 2]), 'none')).toBeNull();
    expect(fitCalibration(standards([1, 1, 1], [1, 2, 3]), 'none')).toBeNull();
    expect(fitCalibration(standards([0, 1, 2], [3, 3, 3]), 'none')).toBeNull();
    expect(fitCalibration(standards([0, 1, Number.NaN], [1, 2, 3]), 'none')).toBeNull();
    expect(fitCalibration(standards([0, 1, 2], [1, Number.POSITIVE_INFINITY, 3]), 'none')).toBeNull();
  });

  it('uses sample SD and never reports a defined RSD for a zero mean', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(sd([1, 2, 3])).toBe(1);
    expect(rsd([1, 2, 3])).toBe(50);
    expect(rsd([-1, 0, 1])).toBeNull();
    expect(rsd([1])).toBeNull();
  });
});

describe('synthetic acquisition', () => {
  const line = LINES[0];

  it('has three synthetic line choices for every element', () => {
    for (const element of ELEMENTS) {
      const lines = LINES.filter((item) => item.element === element);
      expect(lines).toHaveLength(3);
      expect(new Set(lines.map((item) => item.wavelength)).size).toBe(3);
      expect(lines[0].sensitivity).toBeGreaterThan(lines[2].sensitivity);
    }
  });

  it('produces repeatable acquisitions from a seed and distinct new acquisitions', () => {
    const first = measureStandard(1, line, 'linear', 5, 5, 123);
    expect(first).toEqual(measureStandard(1, line, 'linear', 5, 5, 123));
    expect(first).not.toEqual(measureStandard(1, line, 'linear', 5, 5, 124));
    expect(first).toHaveLength(5);
  });

  it('preserves negative background-corrected blank signals', () => {
    const blank = measureStandard(0, line, 'linear', 50, 5, 42);
    expect(blank.some((value) => value < 0)).toBe(true);
    expect(blank.some((value) => value > 0)).toBe(true);
  });

  it('reduces noise with longer integration for the same random realization', () => {
    const short = measureStandard(0, line, 'linear', 5, 1, 123);
    const long = measureStandard(0, line, 'linear', 5, 4, 123);
    short.forEach((value, index) => expect(long[index]).toBeCloseTo(value / 2, 10));
  });

  it('models sensitivity, finite saturation, and distinct curvature', () => {
    expect(expectedSignal(1, line, 'linear')).toBe(line.sensitivity);
    expect(expectedSignal(0, line, 'saturation')).toBe(0);
    const saturated = expectedSignal(100, line, 'saturation');
    expect(saturated).toBeLessThan(line.saturation);
    expect(saturated).toBeLessThan(expectedSignal(100, line, 'linear') / 2);
    expect(expectedSignal(100, line, 'curvature')).toBeCloseTo(expectedSignal(100, line, 'linear') * 0.7, 8);
    expect(expectedSignal(0.01, line, 'saturation') / expectedSignal(0.01, line, 'linear')).toBeGreaterThan(0.999);
  });

  it('keeps all curved responses monotonic and sublinear over 0–100 ppm', () => {
    for (const selectedLine of LINES) {
      let previous = 0;
      for (const concentration of [0.01, 0.1, 1, 10, 25, 50, 75, 100]) {
        const intensity = expectedSignal(concentration, selectedLine, 'curvature');
        expect(intensity).toBeGreaterThan(previous);
        expect(intensity).toBeLessThan(expectedSignal(concentration, selectedLine, 'linear'));
        previous = intensity;
      }
    }
  });

  it('rejects invalid acquisition parameters', () => {
    expect(() => measureStandard(-1, line, 'linear', 3, 5, 1)).toThrow(RangeError);
    expect(() => measureStandard(1, line, 'linear', 0, 5, 1)).toThrow(RangeError);
    expect(() => measureStandard(1, line, 'linear', 3, 0, 1)).toThrow(RangeError);
  });
});

describe('estimated instrumental detection limits', () => {
  it('requires ten blank replicates and uses their sample SD and calibration slope', () => {
    const data = standards([0, 1, 2], [0, 10, 20]);
    data[0].readings = [-1, 1, -1, 1, -1, 1, -1, 1, 0, 0];
    const fit = fitCalibration(data, 'none')!;
    const limits = estimatedLimits(data, fit)!;
    expect(limits.count).toBe(10);
    expect(limits.lod).toBeCloseTo(3 * Math.sqrt(8 / 9) / 10, 12);
    expect(limits.loq).toBeCloseTo(10 * Math.sqrt(8 / 9) / 10, 12);
    expect(estimatedLimits([{ ...data[0], readings: [0, 1, -1] }, ...data.slice(1)], fit)).toBeNull();
    expect(estimatedLimits(data, { ...fit, slope: -1 })).toBeNull();
    expect(estimatedLimits([{ ...data[0], included: false }, ...data.slice(1)], fit)).toBeNull();
  });
});
