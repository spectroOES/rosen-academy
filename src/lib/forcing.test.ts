import { describe, expect, it } from 'vitest';
import { calculateWeights, estimatedLimits, fitCalibration, type Forcing, type Standard, type Weighting } from './model';

const weightings: Weighting[] = ['none', '1/x', '1/x2', '1/SD2', '1/RSD2'];
function data(): Standard[] {
  const xs = [0, 1, 2, 4];
  const means = [2, 5, 8, 11];
  const deviations = [1, 2, 1, 4];
  return xs.map((concentration, i) => ({
    id: `s${i}`,
    name: i === 0 ? 'Calibration blank' : `Standard ${i}`,
    concentration,
    included: true,
    readings: [means[i] - deviations[i], means[i], means[i] + deviations[i]],
  }));
}

// Exact rational normal-equation references for the means and SDs above.
// Free 1/c and 1/c² references use only x=[1,2,4]; their blank is omitted.
const reference: Record<Weighting, { free: [number, number]; blank: [number, number] }> = {
  none: { free: [78 / 35, 13 / 5], blank: [17 / 7, 2] },
  '1/x': { free: [27 / 13, 41 / 13], blank: [18 / 7, 2] },
  '1/x2': { free: [9 / 4, 20 / 7], blank: [11 / 4, 2] },
  '1/SD2': { free: [1050 / 377, 811 / 377], blank: [20 / 7, 2] },
  '1/RSD2': { free: [84030 / 39263, 135517 / 39263], blank: [1412 / 511, 2] },
};

describe('independent intercept forcing', () => {
  it('matches hand-calculated free and blank-fixed fits for all five weightings', () => {
    const standards = data();
    for (const weighting of weightings) {
      const free = fitCalibration(standards, weighting, 'none')!;
      const anchored = fitCalibration(standards, weighting, 'blank')!;
      expect(free).not.toBeNull();
      expect(anchored).not.toBeNull();
      expect(free.slope).toBeCloseTo(reference[weighting].free[0], 11);
      expect(free.intercept).toBeCloseTo(reference[weighting].free[1], 11);
      expect(anchored.slope).toBeCloseTo(reference[weighting].blank[0], 11);
      expect(anchored.intercept).toBe(reference[weighting].blank[1]);
      expect(free.forcing).toBe('none');
      expect(free.anchorId).toBeNull();
      expect(free.freeParameters).toBe(2);
      expect(anchored.forcing).toBe('blank');
      expect(anchored.anchorId).toBe('s0');
      expect(anchored.freeParameters).toBe(1);
      expect(anchored.observationCount).toBe(3);
      expect(free.observationCount).toBe(weighting === '1/x' || weighting === '1/x2' ? 3 : 4);
      expect(anchored.points.map(point => point.id)).toEqual(['s1', 's2', 's3']);
      expect(anchored.slope).not.toBeCloseTo(free.slope, 6);
    }
    // Independently summed OLS SSE: free=54/35, blank-fixed=15/7.
    expect(fitCalibration(standards, 'none', 'none')!.residualSE).toBeCloseTo(Math.sqrt(27 / 35), 12);
    expect(fitCalibration(standards, 'none', 'blank')!.residualSE).toBeCloseTo(Math.sqrt(15 / 14), 12);
  });

  it('omits the zero blank from free inverse-concentration fits without inventing a weight', () => {
    for (const weighting of ['1/x', '1/x2'] as const) {
      const standards = data();
      const result = calculateWeights(standards, weighting, 'none');
      expect(result.error).toBeNull();
      expect(result.forcing).toBe('none');
      expect(result.anchor).toBeNull();
      expect(result.points[0]).toEqual({ id: 's0', role: 'omitted', sd: 1, rsd: 50, weight: null });
      const original = fitCalibration(standards, weighting, 'none')!;
      expect(original.intercept).not.toBe(2);
      expect(original.points.map(point => point.id)).toEqual(['s1', 's2', 's3']);
      standards[0].readings = [1000];
      const changedBlank = fitCalibration(standards, weighting, 'none')!;
      expect(changedBlank.slope).toBe(original.slope);
      expect(changedBlank.intercept).toBe(original.intercept);
      expect(fitCalibration(standards.slice(1), weighting, 'none')!.intercept).toBe(original.intercept);
    }
  });

  it('lets any weighting anchor to a measured blank without needing a blank precision weight', () => {
    for (const weighting of weightings) {
      const standards = data();
      standards[0].readings = [2];
      const result = calculateWeights(standards, weighting, 'blank');
      expect(result.error).toBeNull();
      expect(result.anchor).toEqual({ id: 's0', intensity: 2 });
      expect(result.points[0]).toEqual({ id: 's0', role: 'anchor', sd: null, rsd: null, weight: null });
      expect(fitCalibration(standards, weighting, 'blank')!.slope).toBeCloseTo(reference[weighting].blank[0], 11);
      standards[0].readings = [0, 0, 0];
      expect(calculateWeights(standards, weighting, 'blank').error).toBeNull();
      expect(fitCalibration(standards, weighting, 'blank')!.intercept).toBe(0);
    }
  });

  it('requires one usable blank only when blank forcing is selected', () => {
    for (const weighting of weightings) {
      const standards = data();
      const invalidSets = [
        standards.slice(1),
        standards.map(row => row.concentration === 0 ? { ...row, included: false } : row),
        standards.map(row => row.concentration === 0 ? { ...row, readings: [] } : row),
        [...standards, { ...standards[0], id: 'second-blank' }],
      ];
      for (const invalid of invalidSets) {
        expect(calculateWeights(invalid, weighting, 'blank').error).toMatch(/exactly one included, measured calibration blank/);
        expect(fitCalibration(invalid, weighting, 'blank')).toBeNull();
      }
      expect(calculateWeights(standards.slice(1), weighting, 'none').error).toBeNull();
      expect(fitCalibration(standards.slice(1), weighting, 'none')).not.toBeNull();
    }
  });

  it('counts distinct numeric observations and free parameters after blank omission', () => {
    const standards = data();
    for (const weighting of ['1/x', '1/x2'] as const) {
      expect(fitCalibration(standards.slice(0, 3), weighting, 'none')).toBeNull();
      expect(fitCalibration(standards.slice(0, 3), weighting, 'blank')).not.toBeNull();
      const duplicate = [...standards.slice(0, 3), { ...standards[1], id: 'duplicate-positive' }];
      expect(fitCalibration(duplicate, weighting, 'none')).toBeNull();
    }
    expect(fitCalibration(standards.slice(0, 3), 'none', 'none')).not.toBeNull();
    expect(fitCalibration(standards.slice(0, 2), 'none', 'blank')).toBeNull();
  });

  it('refits without changing readings and updates blank-derived limits through the slope', () => {
    const standards = data();
    standards[0].readings = [1, 3, 1, 3, 1, 3, 1, 3, 2, 2];
    const before = structuredClone(standards);
    for (const weighting of weightings) {
      const free = fitCalibration(standards, weighting, 'none')!;
      const anchored = fitCalibration(standards, weighting, 'blank')!;
      const freeLimits = estimatedLimits(standards, free)!;
      const anchoredLimits = estimatedLimits(standards, anchored)!;
      expect(freeLimits.count).toBe(10);
      expect(anchoredLimits.count).toBe(10);
      expect(freeLimits.lod).toBeCloseTo(3 * Math.sqrt(8 / 9) / free.slope, 12);
      expect(anchoredLimits.loq).toBeCloseTo(10 * Math.sqrt(8 / 9) / anchored.slope, 12);
      expect(freeLimits.lod).not.toBeCloseTo(anchoredLimits.lod, 8);
    }
    expect(standards).toEqual(before);
  });

  it('preserves the omitted-argument legacy behavior for archival callers', () => {
    const standards = data();
    for (const weighting of weightings) {
      const historicalForcing: Forcing = weighting === '1/x' || weighting === '1/x2' ? 'blank' : 'none';
      expect(fitCalibration(standards, weighting)).toEqual(fitCalibration(standards, weighting, historicalForcing));
      expect(calculateWeights(standards, weighting)).toEqual(calculateWeights(standards, weighting, historicalForcing));
    }
  });
});
