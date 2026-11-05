import { describe, expect, it } from 'vitest';
import { AXIAL_RADIAL_RATIO, TEACHING_ELEMENTS, TEACHING_LINES, TEACHING_MODEL_VERSION, expectedSignal, isTeachingSaturated, mean, measureStandard, sd, teachingSD } from './model';

const net = (concentration: number, line: typeof TEACHING_LINES[number]) => expectedSignal(concentration, line, 'teaching') - line.teaching!.baseline;
const sourceView = (element: string) => ['Mg', 'Na'].includes(element) ? 'Radial' : 'Axial';
const pairFor = (element: string, view = sourceView(element)) => TEACHING_LINES.filter(line => line.element === element && line.view === view);

describe('compact teaching method', () => {
  it('offers two correctly ranked wavelengths in both plasma views for all five elements', () => {
    expect(TEACHING_ELEMENTS).toEqual(['Mg', 'Na', 'As', 'Cd', 'Pb']);
    expect(TEACHING_MODEL_VERSION).toBe('teaching-v2');
    expect(TEACHING_LINES).toHaveLength(20);
    expect(new Set(TEACHING_LINES.map(line => line.id)).size).toBe(20);
    for (const element of TEACHING_ELEMENTS) {
      for (const view of ['Radial', 'Axial']) {
        const pair = pairFor(element, view);
        expect(pair).toHaveLength(2);
        const high = pair.find(line => line.teaching!.role === 'high')!;
        const low = pair.find(line => line.teaching!.role === 'low')!;
        expect(high.sensitivity).toBeGreaterThan(low.sensitivity);
        expect(high.wavelength).not.toBe(low.wavelength);
        expect(high.acquisitionMode).toBe(low.acquisitionMode);
        expect(pair.every(line => !line.profile && !line.mixture)).toBe(true);
      }
    }
  });

  it('anchors source-view sensitivity and preserves the modest Cd contrast', () => {
    const magnesium = pairFor('Mg').find(line => line.teaching!.role === 'high')!;
    const cadmium = pairFor('Cd');
    expect(magnesium.sensitivity).toBe(37358.0794024984);
    expect(cadmium[0].sensitivity).toBe(13595.0152931);
    expect(cadmium[0].sensitivity / cadmium[1].sensitivity).toBeCloseTo(1.09, 2);
    expect(cadmium[1].label).toContain('92% response');
    expect(pairFor('Na')[1].label).toContain('0.18% response');
  });

  it('uses 5.5 times axial initial sensitivity with the same plateau and blank model', () => {
    expect(AXIAL_RADIAL_RATIO).toBe(5.5);
    for (const radial of TEACHING_LINES.filter(line => line.view === 'Radial')) {
      const axial = TEACHING_LINES.find(line => line.element === radial.element && line.wavelength === radial.wavelength && line.view === 'Axial')!;
      expect(axial.sensitivity / radial.sensitivity).toBeCloseTo(AXIAL_RADIAL_RATIO, 12);
      expect(axial.teaching!.plateau).toBe(radial.teaching!.plateau);
      expect(axial.teaching!.baseline).toBe(radial.teaching!.baseline);
      expect(axial.teaching!.blankSd).toBe(radial.teaching!.blankSd);
      expect(axial.teaching!.relativeSd).toBe(radial.teaching!.relativeSd);
      const lowLevelRatio = net(0.01, axial) / net(0.01, radial);
      expect(lowLevelRatio).toBeGreaterThan(5.48);
      expect(lowLevelRatio).toBeLessThan(5.5);
      expect(net(100, axial) / net(100, radial)).toBeLessThan(lowLevelRatio);
    }
  });

  it('retains a proportional low-level response and finite positive blank dispersion', () => {
    for (const line of TEACHING_LINES) {
      expect(expectedSignal(0, line, 'teaching')).toBe(line.teaching!.baseline);
      expect(teachingSD(0, line)).toBe(line.teaching!.blankSd);
      expect(teachingSD(0, line)).toBeGreaterThan(0);
      for (const concentration of [0.01, 0.1]) {
        const fraction = net(concentration, line) / (line.sensitivity * concentration);
        expect(fraction).toBeGreaterThan(0.98);
        expect(fraction).toBeLessThanOrEqual(1);
      }
    }
  });

  it('retains source-view high-level flattening and the broader lower-sensitivity range', () => {
    for (const element of TEACHING_ELEMENTS) {
      const pair = pairFor(element);
      const high = pair.find(line => line.teaching!.role === 'high')!;
      const low = pair.find(line => line.teaching!.role === 'low')!;
      expect(net(100, high) / high.teaching!.plateau).toBeGreaterThan(0.99);
      expect(net(100, high) / (high.sensitivity * 100)).toBeLessThan(0.16);
      expect(net(100, low) / (low.sensitivity * 100)).toBeGreaterThan(0.92);
      expect(net(100, high) - net(75, high)).toBeLessThan(0.02 * net(25, high));
      let previous = 0;
      for (const concentration of [0.01, 0.1, 0.5, 1, 10, 25, 50, 100]) {
        const current = net(concentration, high);
        expect(current).toBeGreaterThan(previous);
        expect(current).toBeLessThan(high.teaching!.plateau);
        previous = current;
      }
    }
  });

  it('reaches the shared saturation condition earlier in axial view', () => {
    const axial = TEACHING_LINES.find(line => line.id === 'mg-279553-axial-ifr')!;
    const radial = TEACHING_LINES.find(line => line.id === 'mg-279553-radial-ifr')!;
    expect(isTeachingSaturated(0, axial)).toBe(false);
    expect(isTeachingSaturated(1, axial)).toBe(false);
    expect(isTeachingSaturated(12, axial)).toBe(true);
    expect(isTeachingSaturated(12, radial)).toBe(false);
    expect(isTeachingSaturated(100, radial)).toBe(true);
    const radialThreshold = -Math.log(0.02) * radial.teaching!.plateau / radial.sensitivity;
    const axialThreshold = -Math.log(0.02) * axial.teaching!.plateau / axial.sensitivity;
    expect(radialThreshold / axialThreshold).toBeCloseTo(AXIAL_RADIAL_RATIO, 12);
    expect(isTeachingSaturated(radialThreshold - 0.01, radial)).toBe(false);
    expect(isTeachingSaturated(radialThreshold + 0.01, radial)).toBe(true);
  });

  it('keeps the teaching response independent of legacy outcome selectors', () => {
    for (const line of TEACHING_LINES) {
      const expected = expectedSignal(100, line, 'teaching');
      for (const mode of ['linear', 'saturation', 'curvature', 'measured'] as const) {
        expect(expectedSignal(100, line, mode)).toBe(expected);
      }
    }
  });

  it('generates reproducible Gaussian replicates around the selected-view response', () => {
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
      expect(() => isTeachingSaturated(concentration, TEACHING_LINES[0])).toThrow(RangeError);
    }
    const { teaching: _, ...withoutTeaching } = TEACHING_LINES[0];
    expect(() => teachingSD(1, withoutTeaching)).toThrow(/teaching response/);
    expect(isTeachingSaturated(100, withoutTeaching)).toBe(false);
  });
});
