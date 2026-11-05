import { describe, expect, it } from 'vitest';
import { TEACHING_ELEMENTS, TEACHING_LINES, TEACHING_MODEL_VERSION, expectedSignal, mean, measureStandard, sd, teachingSD } from './model';

const net = (concentration: number, line: typeof TEACHING_LINES[number]) => expectedSignal(concentration, line, 'teaching') - line.teaching!.baseline;

describe('compact teaching method', () => {
  it('offers two distinct, correctly ranked channels for the five requested elements', () => {
    expect(TEACHING_ELEMENTS).toEqual(['Mg', 'Na', 'As', 'Cd', 'Pb']);
    expect(TEACHING_MODEL_VERSION).toBeTruthy();
    expect(TEACHING_LINES).toHaveLength(10);
    expect(new Set(TEACHING_LINES.map(line => line.id)).size).toBe(10);
    for (const element of TEACHING_ELEMENTS) {
      const pair = TEACHING_LINES.filter(line => line.element === element);
      expect(pair).toHaveLength(2);
      const high = pair.find(line => line.teaching!.role === 'high')!;
      const low = pair.find(line => line.teaching!.role === 'low')!;
      expect(high.sensitivity).toBeGreaterThan(low.sensitivity);
      expect(high.wavelength).not.toBe(low.wavelength);
      expect(high.view).toBe(low.view);
      expect(high.acquisitionMode).toBe(low.acquisitionMode);
      expect(pair.every(line => !line.profile && !line.mixture)).toBe(true);
    }
  });

  it('preserves export-informed relative sensitivity instead of inventing a large Cd difference', () => {
    const pair = TEACHING_LINES.filter(line => line.element === 'Cd');
    expect(pair[0].sensitivity / pair[1].sensitivity).toBeCloseTo(1.09, 2);
    expect(pair[1].label).toContain('92% response');
    const weakNa = TEACHING_LINES.find(line => line.element === 'Na' && line.teaching!.role === 'low')!;
    expect(weakNa.label).toContain('0.18% response');
  });

  it('is nearly linear at low levels while retaining finite positive blank dispersion', () => {
    for (const line of TEACHING_LINES) {
      expect(expectedSignal(0, line, 'teaching')).toBe(line.teaching!.baseline);
      expect(teachingSD(0, line)).toBe(line.teaching!.blankSd);
      expect(teachingSD(0, line)).toBeGreaterThan(0);
      for (const concentration of [0.01, 0.1, 0.5, 1]) {
        const fraction = net(concentration, line) / (line.sensitivity * concentration);
        expect(fraction).toBeGreaterThan(0.96);
        expect(fraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('naturally flattens higher-sensitivity curves at 100 ppm while lower lines retain a wider range', () => {
    for (const element of TEACHING_ELEMENTS) {
      const pair = TEACHING_LINES.filter(line => line.element === element);
      const high = pair.find(line => line.teaching!.role === 'high')!;
      const low = pair.find(line => line.teaching!.role === 'low')!;
      expect(net(100, high) / high.teaching!.plateau).toBeGreaterThan(0.99);
      expect(net(100, high) / (high.sensitivity * 100)).toBeLessThan(0.16);
      expect(net(100, low) / (low.sensitivity * 100)).toBeGreaterThan(0.92);
      expect(net(100, high) - net(75, high)).toBeLessThan(0.02 * (net(25, high) - net(0, high)));
      let previous = 0;
      for (const concentration of [0.01, 0.1, 0.5, 1, 10, 25, 50, 100]) {
        const current = net(concentration, high);
        expect(current).toBeGreaterThan(previous);
        expect(current).toBeLessThan(high.teaching!.plateau);
        previous = current;
      }
    }
  });

  it('keeps the teaching response independent of legacy outcome selectors', () => {
    for (const line of TEACHING_LINES) {
      const expected = expectedSignal(100, line, 'teaching');
      for (const mode of ['linear', 'saturation', 'curvature', 'measured'] as const) {
        expect(expectedSignal(100, line, mode)).toBe(expected);
      }
    }
  });

  it('generates reproducible Gaussian replicates around the teaching response and dispersion', () => {
    const line = TEACHING_LINES.find(line => line.id === 'cd-214438-axial-ifr')!;
    const readings = measureStandard(100, line, 'teaching', 1000, 5, 731);
    expect(readings).toEqual(measureStandard(100, line, 'teaching', 1000, 5, 731));
    expect(readings).not.toEqual(measureStandard(100, line, 'teaching', 1000, 5, 732));
    const sigma = teachingSD(100, line);
    expect(sd(readings) / sigma).toBeGreaterThan(0.92);
    expect(sd(readings) / sigma).toBeLessThan(1.08);
    expect(Math.abs(mean(readings) - expectedSignal(100, line, 'teaching'))).toBeLessThan(3 * sigma / Math.sqrt(readings.length));
    expect(measureStandard(0, line, 'teaching', 1000, 5, 91).some(value => value < 0)).toBe(true);
  });

  it('rejects invalid concentrations and cannot silently use teaching SD for archival channels', () => {
    for (const concentration of [-1, NaN, Infinity]) {
      expect(() => expectedSignal(concentration, TEACHING_LINES[0], 'teaching')).toThrow(RangeError);
      expect(() => teachingSD(concentration, TEACHING_LINES[0])).toThrow(RangeError);
    }
    const { teaching: _, ...withoutTeaching } = TEACHING_LINES[0];
    expect(() => teachingSD(1, withoutTeaching)).toThrow(/teaching response/);
  });
});
