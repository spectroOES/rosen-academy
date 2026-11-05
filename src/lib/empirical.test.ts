import { describe, expect, it } from 'vitest';
import { LINES, METHOD_ELEMENTS, METHOD_LINES, describeRange, expectedSignal, mean, measuredSD, measureStandard, sd } from './model';

const channel = (id: string) => {
  const line = METHOD_LINES.find((candidate) => candidate.id === id);
  if (!line) throw new Error(`Missing measured channel ${id}`);
  return line;
};

describe('imported iCAP PRO Duo calibration method', () => {
  it('retains distinct method channels and the requested starter elements', () => {
    expect(METHOD_ELEMENTS).toEqual(['Cu', 'Cd', 'Mg', 'Ca', 'P', 'Pb', 'Ti', 'Zn', 'Fe', 'Sb']);
    expect(METHOD_LINES).toHaveLength(25);
    expect(new Set(METHOD_LINES.map((line) => line.id)).size).toBe(METHOD_LINES.length);
    for (const line of METHOD_LINES) {
      expect(line.view).toBe(line.profile!.view);
      expect(line.acquisitionMode).toBe(line.profile!.mode);
      expect(line.mixture).toBe(line.profile!.mixture);
      expect(line.saturation).toBe(Number.POSITIVE_INFINITY);
    }
    const axial = channel('mg-280270-axial-ifr');
    const radial = channel('mg-280270-radial-ifr');
    expect(axial.wavelength).toBe(radial.wavelength);
    expect(axial.view).toBe('Axial');
    expect(radial.view).toBe('Radial');
    expect(expectedSignal(100, axial, 'measured')).not.toBe(expectedSignal(100, radial, 'measured'));
  });

  it('reproduces every exported mean and SD exactly at reference concentrations', () => {
    for (const line of METHOD_LINES) {
      for (const point of line.profile!.points) {
        expect(expectedSignal(point.concentration, line, 'measured')).toBe(point.mean);
        expect(measuredSD(point.concentration, line)).toBe(point.sd);
        expect(describeRange(point.concentration, line)).toBe('measured');
      }
    }
  });

  it('uses the measured Cd response and preserves its small negative blank', () => {
    const cd214 = channel('cd-214438-axial-ifr');
    const cd226 = channel('cd-226502-axial-ifr');
    expect(expectedSignal(0, cd214, 'measured')).toBe(-0.415414831);
    expect(expectedSignal(1, cd214, 'measured')).toBe(13613.56395);
    expect(expectedSignal(1, cd226, 'measured')).toBe(12476.04007);
    expect(cd214.sensitivity / cd226.sensitivity).toBeCloseTo(1.09, 2);
    expect(cd226.label).toBe('92% relative response');
    // Historical synthetic scenarios remain available for their own tests.
    expect(LINES.find((line) => line.id === 'cd-214439')!.sensitivity).toBe(42000);
  });

  it('shows recorded strong Mg compression while its weak line stays nearly proportional', () => {
    const strong = channel('mg-280270-axial-ifr');
    const weak = channel('mg-279079-radial-ifr');
    const net = (concentration: number, line: typeof strong) => expectedSignal(concentration, line, 'measured') - expectedSignal(0, line, 'measured');
    expect(net(100, strong) / (4 * net(25, strong))).toBeCloseTo(0.4735610065, 9);
    expect(net(100, weak) / (4 * net(25, weak))).toBeCloseTo(0.9805368002, 9);
    expect(expectedSignal(25, strong, 'measured')).toBe(1994673.785);
    expect(expectedSignal(100, strong, 'measured')).toBe(3778293.184);
    expect(weak.label).toBe('0.18% relative response');
    // Imported data cannot be switched to an artificially perfect response.
    expect(expectedSignal(100, strong, 'linear')).toBe(expectedSignal(100, strong, 'measured'));
    expect(expectedSignal(100, strong, 'saturation')).toBe(expectedSignal(100, strong, 'measured'));
  });

  it('interpolates local measured segments and labels the sparse blank-to-standard gap', () => {
    const mg = channel('mg-280270-axial-ifr');
    expect(expectedSignal(37.5, mg, 'measured')).toBeCloseTo((1994673.785 + 2979675.644) / 2, 8);
    expect(measuredSD(37.5, mg)).toBeCloseTo((8443.908517 + 9824.874907) / 2, 8);
    expect(describeRange(37.5, mg)).toBe('interpolated');
    expect(describeRange(1, mg)).toBe('interpolated');
    expect(expectedSignal(12.5, mg, 'measured')).toBeCloseTo((118.2191579 + 1994673.785) / 2, 8);
    expect(describeRange(100.01, mg)).toBe('extrapolated');
  });

  it('continues the final secant above the export without inventing a saturation ceiling', () => {
    const mg = channel('mg-280270-axial-ifr');
    const lastIncrement = 3778293.184 - 2979675.644;
    const extrapolated = expectedSignal(150, mg, 'measured');
    expect(extrapolated).toBeCloseTo(3778293.184 + lastIncrement, 8);
    expect(measuredSD(150, mg)).toBeCloseTo(25483.63187 * extrapolated / 3778293.184, 8);
    expect(describeRange(150, mg)).toBe('extrapolated');
    expect(expectedSignal(1000, mg, 'measured')).toBeGreaterThan(extrapolated);
  });
});

describe('synthetic replicates using measured precision', () => {
  it('draws repeatable Gaussian readings using the exported SD at 5 s', () => {
    const cd = channel('cd-214438-axial-ifr');
    const readings = measureStandard(1, cd, 'measured', 1000, 5, 731);
    expect(readings).toEqual(measureStandard(1, cd, 'measured', 1000, 5, 731));
    expect(readings).not.toEqual(measureStandard(1, cd, 'measured', 1000, 5, 732));
    // SD already describes total observed variability; adding a photon term
    // would inflate this reference dispersion substantially.
    expect(sd(readings) / 73.60830154).toBeGreaterThan(0.92);
    expect(sd(readings) / 73.60830154).toBeLessThan(1.08);
    expect(Math.abs(mean(readings) - 13613.56395)).toBeLessThan(3 * 73.60830154 / Math.sqrt(1000));
  });

  it('scales only random deviations with exposure and retains measured blank precision', () => {
    const cd = channel('cd-214438-axial-ifr');
    const reference = measureStandard(0, cd, 'measured', 1000, 5, 91);
    const longer = measureStandard(0, cd, 'measured', 1000, 20, 91);
    const baseline = -0.415414831;
    for (let index = 0; index < reference.length; index++) {
      expect(longer[index] - baseline).toBeCloseTo((reference[index] - baseline) / 2, 12);
    }
    expect(sd(reference) / 0.44533751).toBeGreaterThan(0.92);
    expect(sd(reference) / 0.44533751).toBeLessThan(1.08);
    expect(reference.some((reading) => reading < 0)).toBe(true);
    expect(expectedSignal(0, cd, 'measured')).toBe(baseline);
  });

  it('rejects invalid concentrations consistently and does not fabricate measured SDs for synthetic lines', () => {
    const cd = channel('cd-214438-axial-ifr');
    for (const concentration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => expectedSignal(concentration, cd, 'measured')).toThrow(RangeError);
      expect(() => measuredSD(concentration, cd)).toThrow(RangeError);
      expect(() => describeRange(concentration, cd)).toThrow(RangeError);
    }
    expect(() => measuredSD(1, LINES[0])).toThrow(/imported calibration profile/);
  });
});
