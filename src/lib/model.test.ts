import { describe, expect, it } from 'vitest';
import { ELEMENTS, LINES, calculateWeights, estimatedLimits, expectedSignal, fitCalibration, mean, measureStandard, rsd, sd, type Standard } from './model';

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

  it('matches an independently calculated free-intercept OLS reference', () => {
    // References from the normal equations for x=[1,2,4], y=[1,2,3].
    const data = standards([1, 2, 4], [1, 2, 3]);
    const ols = fitCalibration(data, 'none')!;
    expect(ols.slope).toBeCloseTo(9 / 14, 12);
    expect(ols.intercept).toBeCloseTo(0.5, 12);
    expect(ols.forcing).toBe('none');
    expect(ols.anchorId).toBeNull();
    expect(ols.freeParameters).toBe(2);
    expect(ols.observationCount).toBe(3);
  });

  it('uses a blank anchor without assigning a numeric blank weight', () => {
    const fit = fitCalibration(standards([0, 1, 2], [1, 2, 4]), '1/x2')!;
    // Fixed b=1; positive weights [1,1/4]. m=(1+1.5)/(1+1).
    expect(fit.slope).toBeCloseTo(5 / 4, 12);
    expect(fit.intercept).toBe(1);
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

describe('legacy Qtegra inverse-concentration weighting', () => {
  function anchoredStandards() {
    const data = standards([0, 1, 2, 4], [2, 5, 8, 11]);
    data[0].name = 'Calibration blank';
    return data;
  }

  it('matches independent constrained-fit references with a nonzero measured blank', () => {
    const data = anchoredStandards();
    for (const weighting of ['1/x', '1/x2'] as const) {
      const diagnostics = calculateWeights(data, weighting);
      expect(diagnostics.error).toBeNull();
      expect(diagnostics.forcing).toBe('blank');
      expect(diagnostics.anchor).toEqual({ id: data[0].id, intensity: 2 });
      expect(diagnostics.points[0]).toEqual({ id: data[0].id, role: 'anchor', sd: null, rsd: null, weight: null });
      expect(diagnostics.points.slice(1).every((point) => point.role === 'fit')).toBe(true);
      expect(diagnostics.points.slice(1).map((point) => point.weight)).toEqual(weighting === '1/x' ? [1, 1 / 2, 1 / 4] : [1, 1 / 4, 1 / 16]);
      const fit = fitCalibration(data, weighting)!;
      // Hand calculations for b=2: 1/c => 18/7; 1/c² => (3+3+9/4)/3.
      expect(fit.slope).toBeCloseTo(weighting === '1/x' ? 18 / 7 : 11 / 4, 12);
      expect(fit.intercept).toBe(2);
      expect(fit.forcing).toBe('blank');
      expect(fit.anchorId).toBe(data[0].id);
      expect(fit.freeParameters).toBe(1);
      expect(fit.observationCount).toBe(3);
      expect(fit.points.map((point) => point.id)).toEqual(data.slice(1).map((point) => point.id));
      // At c=0 the fitted response is exactly the measured blank mean.
      expect(fit.intercept + fit.slope * 0).toBe(mean(data[0].readings));
      const sse = fit.points.reduce((sum, point) => sum + point.residual ** 2, 0);
      expect(fit.residualSE).toBeCloseTo(Math.sqrt(sse / 2), 12);
      const average = mean(fit.points.map((point) => point.signal));
      const sst = fit.points.reduce((sum, point) => sum + (point.signal - average) ** 2, 0);
      expect(fit.r2).toBeCloseTo(1 - sse / sst, 12);
    }
  });

  it('uses only the blank mean as the intercept constraint, independent of blank precision', () => {
    const data = anchoredStandards();
    for (const weighting of ['1/x', '1/x2'] as const) {
      const original = fitCalibration(data, weighting)!;
      const sameMean = structuredClone(data);
      sameMean[0].readings = [-98, 2, 102];
      const differentPrecision = fitCalibration(sameMean, weighting)!;
      expect(differentPrecision.slope).toBeCloseTo(original.slope, 12);
      expect(differentPrecision.intercept).toBe(original.intercept);
      sameMean[0].readings = [2, 3, 4];
      const changedMean = fitCalibration(sameMean, weighting)!;
      expect(changedMean.intercept).toBe(3);
      expect(changedMean.slope).toBeCloseTo(weighting === '1/x' ? 15 / 7 : 13 / 6, 12);
    }
  });

  it('rejects missing, excluded, unmeasured, and duplicate measured blank anchors', () => {
    const data = anchoredStandards();
    const missing = data.slice(1);
    const excluded = data.map((point) => point.concentration === 0 ? { ...point, included: false } : point);
    const unmeasured = data.map((point) => point.concentration === 0 ? { ...point, readings: [] } : point);
    const duplicate = [...data, { ...data[0], id: 'second-blank', name: 'Second blank' }];
    for (const weighting of ['1/x', '1/x2'] as const) {
      for (const invalid of [missing, excluded, unmeasured, duplicate]) {
        const diagnostics = calculateWeights(invalid, weighting);
        expect(diagnostics.error).toMatch(/exactly one included, measured calibration blank/);
        expect(diagnostics.anchor).toBeNull();
        expect(fitCalibration(invalid, weighting)).toBeNull();
      }
    }
  });

  it('accepts a negative measured blank and requires two nonzero levels beyond the anchor', () => {
    const data = standards([0, 1, 2], [-2, 1, 4]);
    for (const weighting of ['1/x', '1/x2'] as const) {
      const fit = fitCalibration(data, weighting)!;
      expect(fit.intercept).toBe(-2);
      expect(fit.slope).toBeCloseTo(3, 12);
      expect(fit.observationCount).toBe(2);
      expect(fit.residualSE).toBeCloseTo(0, 12);
      expect(fit.relativeSE).toBeNull();
      expect(fitCalibration(data.slice(0, 2), weighting)).toBeNull();
    }
  });

  it('honors excluded outliers and maps numeric weights by id when the blank is out of order', () => {
    const data = anchoredStandards();
    const outlier = { id: 'outlier', name: 'Excluded outlier', concentration: 100, included: false, readings: [1e9] };
    for (const weighting of ['1/x', '1/x2'] as const) {
      const expected = fitCalibration(data, weighting)!;
      const reordered = fitCalibration([data[1], outlier, data[2], data[0], data[3]], weighting)!;
      expect(reordered.slope).toBeCloseTo(expected.slope, 12);
      expect(reordered.intercept).toBe(expected.intercept);
      expect(reordered.points).toHaveLength(3);
    }
  });

  it('changes blank-based detection-limit estimates through the constrained slope', () => {
    const data = anchoredStandards();
    data[0].readings = [1, 3, 1, 3, 1, 3, 1, 3, 2, 2];
    const blankSD = Math.sqrt(8 / 9);
    const inverse = fitCalibration(data, '1/x')!;
    const squared = fitCalibration(data, '1/x2')!;
    const inverseLimits = estimatedLimits(data, inverse)!;
    const squaredLimits = estimatedLimits(data, squared)!;
    expect(inverseLimits.count).toBe(10);
    expect(inverseLimits.lod).toBeCloseTo(3 * blankSD / (18 / 7), 12);
    expect(squaredLimits.loq).toBeCloseTo(10 * blankSD / (11 / 4), 12);
    expect(inverseLimits.lod).not.toBeCloseTo(squaredLimits.lod, 5);
  });
});

describe('Qtegra inverse-variance precision weighting', () => {
  function precisionStandards(): Standard[] {
    const data = standards([0, 1, 2, 4], [2, 5, 8, 11]);
    [1, 2, 1, 4].forEach((deviation, index) => {
      const center = data[index].readings[0];
      data[index].readings = [center - deviation, center, center + deviation];
    });
    data[0].name = 'Calibration blank';
    return data;
  }

  it('uses squared precision weights, matching independent normal-equation references', () => {
    const data = precisionStandards();
    const inverseSD = calculateWeights(data, '1/SD2');
    expect(inverseSD.error).toBeNull();
    expect(inverseSD.points.map((point) => point.sd)).toEqual([1, 2, 1, 4]);
    expect(inverseSD.points.map((point) => point.weight)).toEqual([1, 1 / 4, 1, 1 / 16]);
    // Exact normal-equation results for w=[1,1/4,1,1/16].
    const fitSD = fitCalibration(data, '1/SD2')!;
    expect(fitSD.slope).toBeCloseTo(1050 / 377, 12);
    expect(fitSD.intercept).toBeCloseTo(811 / 377, 12);
    expect(fitSD.slope).not.toBeCloseTo(222 / 89, 5);

    const inverseRSD = calculateWeights(data, '1/RSD2');
    expect(inverseRSD.error).toBeNull();
    const weights = [4, 25 / 4, 64, 121 / 16];
    inverseRSD.points.forEach((point, index) => expect(point.weight).toBeCloseTo(weights[index], 12));
    // Exact references for inverse squared fractional relative SD.
    const fitRSD = fitCalibration(data, '1/RSD2')!;
    expect(fitRSD.slope).toBeCloseTo(84030 / 39263, 12);
    expect(fitRSD.intercept).toBeCloseTo(135517 / 39263, 12);
    expect(fitRSD.slope).not.toBeCloseTo(5766 / 2615, 5);
  });

  it('uses the actual measured blank mean for RSD and does not use a concentration floor', () => {
    const data = precisionStandards();
    const result = calculateWeights(data, '1/RSD2');
    expect(result.points[0]).toEqual({ id: data[0].id, role: 'fit', sd: 1, rsd: 50, weight: 4 });
    expect(result.points[0].weight).not.toBe(result.points[1].weight);
    data[0].readings = [-3, -2, -1];
    const negativeBlank = calculateWeights(data, '1/RSD2');
    expect(negativeBlank.error).toBeNull();
    expect(negativeBlank.points[0]).toEqual(result.points[0]);
  });

  it('keeps near-zero nonzero means eligible without an epsilon cutoff or weight floor', () => {
    const data = precisionStandards();
    data[0].readings = [1e-18, 2e-18, 3e-18];
    const result = calculateWeights(data, '1/RSD2');
    expect(result.error).toBeNull();
    expect(result.points[0].rsd).toBeCloseTo(50, 10);
    expect(result.points[0].weight).toBeCloseTo(4, 12);
    expect(rsd(data[0].readings)).toBeCloseTo(50, 10);
    expect(fitCalibration(data, '1/RSD2')).not.toBeNull();
  });

  it('rejects zero-mean RSD while zero-mean SD weighting remains defined', () => {
    const data = precisionStandards();
    data[0].readings = [-1, 0, 1];
    const invalid = calculateWeights(data, '1/RSD2');
    expect(invalid.error).toMatch(/Calibration blank.*nonzero mean/);
    expect(invalid.points[0]).toEqual({ id: data[0].id, role: 'fit', sd: 1, rsd: null, weight: null });
    expect(fitCalibration(data, '1/RSD2')).toBeNull();
    expect(calculateWeights(data, '1/SD2').error).toBeNull();
    expect(fitCalibration(data, '1/SD2')).not.toBeNull();
  });

  it('rejects incomplete or zero-SD standards without dropping them or falling back', () => {
    for (const weighting of ['1/SD2', '1/RSD2'] as const) {
      const partial = precisionStandards();
      partial[2].readings = [8];
      const incomplete = calculateWeights(partial, weighting);
      expect(incomplete.error).toMatch(/Standard 2.*at least 2 replicate/);
      expect(incomplete.error).toContain(weighting === '1/SD2' ? '1/SD²' : '1/RSD²');
      expect(incomplete.points).toHaveLength(4);
      expect(incomplete.points[2]).toEqual({ id: partial[2].id, role: 'fit', sd: null, rsd: null, weight: null });
      expect(fitCalibration(partial, weighting)).toBeNull();
      partial[2].readings = [8, 8, 8];
      const zeroSD = calculateWeights(partial, weighting);
      expect(zeroSD.error).toMatch(/Standard 2.*positive replicate SD/);
      expect(zeroSD.points[2].weight).toBeNull();
      expect(fitCalibration(partial, weighting)).toBeNull();
      expect(fitCalibration(partial, 'none')).not.toBeNull();
    }
  });

  it('ignores unmeasured/excluded rows but does not mutate any input readings', () => {
    const data = precisionStandards();
    data.push({ id: 'unmeasured', name: 'Not acquired', concentration: 10, included: true, readings: [] });
    data.push({ id: 'excluded', name: 'Excluded invalid', concentration: 100, included: false, readings: [Number.NaN] });
    const original = structuredClone(data);
    for (const weighting of ['none', '1/x', '1/x2', '1/SD2', '1/RSD2'] as const) {
      const diagnostics = calculateWeights(data, weighting);
      expect(diagnostics.error).toBeNull();
      expect(diagnostics.points).toHaveLength(4);
      expect(fitCalibration(data, weighting)).not.toBeNull();
    }
    expect(data).toEqual(original);
  });

  it('reduces equal-SD weighting to OLS and still requires three distinct levels', () => {
    const data = precisionStandards();
    data.forEach((point) => { const center = mean(point.readings); point.readings = [center - 2, center, center + 2]; });
    const plain = fitCalibration(data, 'none')!;
    const weighted = fitCalibration(data, '1/SD2')!;
    expect(weighted.slope).toBeCloseTo(plain.slope, 12);
    expect(weighted.intercept).toBeCloseTo(plain.intercept, 12);
    const twoLevels = data.slice(0, 2);
    expect(calculateWeights(twoLevels, '1/SD2').error).toBeNull();
    expect(fitCalibration(twoLevels, '1/SD2')).toBeNull();
  });

  it('reports fractional relative-SD weights while percent-based weights give the same curve', () => {
    const data = precisionStandards();
    const fractionalRSD = calculateWeights(data, '1/RSD2');
    fractionalRSD.points.forEach((point) => {
      expect(point.weight).toBeCloseTo((100 / point.rsd!) ** 2, 12);
      expect(point.weight).toBeCloseTo(10000 / point.rsd! ** 2, 12);
    });
    const percentRSDAsSD = data.map((point) => {
      const center = mean(point.readings);
      const relativePercent = rsd(point.readings)!;
      return { ...point, readings: [center - relativePercent, center, center + relativePercent] };
    });
    const percentWeights = calculateWeights(percentRSDAsSD, '1/SD2');
    percentWeights.points.forEach((point, index) => {
      expect(point.weight! * 10000).toBeCloseTo(fractionalRSD.points[index].weight!, 10);
    });
    const fractionFit = fitCalibration(data, '1/RSD2')!;
    const percentFit = fitCalibration(percentRSDAsSD, '1/SD2')!;
    expect(fractionFit.slope).toBeCloseTo(percentFit.slope, 10);
    expect(fractionFit.intercept).toBeCloseTo(percentFit.intercept, 10);
  });

  it('rejects nonfinite squared weights instead of clipping or falling back', () => {
    const data = precisionStandards();
    data[0].readings = [1e-160, 2e-160, 3e-160];
    const result = calculateWeights(data, '1/SD2');
    expect(result.error).toMatch(/Calibration blank.*1\/SD².*finite, positive weight/);
    expect(result.points[0].weight).toBeNull();
    expect(fitCalibration(data, '1/SD2')).toBeNull();
  });

  it('rejects nonfinite measurements and nonfinite precision statistics', () => {
    for (const readings of [[Number.NaN, 1], [Number.POSITIVE_INFINITY, 1], [1e200, -1e200, 1]]) {
      const data = precisionStandards();
      data[0].readings = readings;
      const result = calculateWeights(data, '1/SD2');
      expect(result.error).toMatch(/Calibration blank.*finite/);
      expect(result.points[0].weight).toBeNull();
      expect(fitCalibration(data, '1/SD2')).toBeNull();
    }
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
