import calibrationData from '../data/calibration-profiles.json';

export { AXIAL_RADIAL_RATIO, TEACHING_ELEMENTS, TEACHING_LINES, TEACHING_MODEL_VERSION } from './teaching-method';

/**
 * Transparent educational ICP-OES model. TEACHING_LINES use export-informed
 * sensitivity/precision with explicit illustrative saturation. METHOD_LINES
 * retain exported means/SDs; LINES retain the earlier synthetic examples.
 * Signal units are intensity rates in counts per second.
 */
export type ResponseMode = 'linear' | 'saturation' | 'curvature' | 'measured' | 'teaching';
export type Weighting = 'none' | '1/x' | '1/x2' | '1/SD2' | '1/RSD2';
export type Forcing = 'none' | 'blank';

export interface MeasuredProfile {
  id: string;
  element: string;
  wavelength: number;
  view: 'Axial' | 'Radial';
  mode: 'iFR' | 'eUV';
  mixture: 'I' | 'II' | 'III';
  points: {
    concentration: number;
    mean: number;
    sd: number;
    reportedRsd: number | null;
    label: string;
  }[];
  baseline: number;
  referenceSlope: number;
  referenceRsd: number;
  referenceBlankSd: number;
  measuredMin: number;
  measuredMax: number;
  compressionRatio: number;
  description: string;
}

export interface SpectralLine {
  id: string;
  element: string;
  wavelength: number;
  sensitivity: number;
  background: number;
  saturation: number;
  curvature: number;
  label: string;
  description: string;
  recommendedMax: number;
  profile?: MeasuredProfile;
  view?: MeasuredProfile['view'];
  acquisitionMode?: MeasuredProfile['mode'];
  mixture?: MeasuredProfile['mixture'];
  teaching?: TeachingResponse;
}

/** Illustrative response parameters, not a detector full-well measurement. */
export interface TeachingResponse {
  role: 'high' | 'low';
  baseline: number;
  blankSd: number;
  /** Fractional replicate SD of the net response at the 5 s reference exposure. */
  relativeSd: number;
  /** Asymptotic net intensity, in cps. All teaching plateaus are assumptions. */
  plateau: number;
  provenance: string;
}

export const ELEMENTS = ['Cu', 'Cd', 'Pb', 'Fe', 'Zn'];

export const LINES: SpectralLine[] = [
  { id: 'cu-324754', element: 'Cu', wavelength: 324.754, sensitivity: 52000, background: 2400, saturation: 1200000, curvature: -0.003, label: 'High sensitivity', description: 'Strong response at trace levels; reaches detector compression earlier.', recommendedMax: 5 },
  { id: 'cu-327396', element: 'Cu', wavelength: 327.396, sensitivity: 27000, background: 1800, saturation: 1600000, curvature: -0.0018, label: 'Medium sensitivity', description: 'Balanced trace response and usable concentration range.', recommendedMax: 10 },
  { id: 'cu-224700', element: 'Cu', wavelength: 224.700, sensitivity: 4200, background: 1300, saturation: 2200000, curvature: -0.0006, label: 'Low sensitivity', description: 'Weaker trace signal with a wider high-concentration range.', recommendedMax: 100 },
  { id: 'cd-214439', element: 'Cd', wavelength: 214.439, sensitivity: 42000, background: 2100, saturation: 1100000, curvature: -0.0035, label: 'High sensitivity', description: 'Strong trace response; susceptible to compression at high concentrations.', recommendedMax: 5 },
  { id: 'cd-226502', element: 'Cd', wavelength: 226.502, sensitivity: 21000, background: 1600, saturation: 1500000, curvature: -0.0015, label: 'Medium sensitivity', description: 'Intermediate sensitivity and upper working range.', recommendedMax: 10 },
  { id: 'cd-228802', element: 'Cd', wavelength: 228.802, sensitivity: 5200, background: 1100, saturation: 2400000, curvature: -0.0005, label: 'Low sensitivity', description: 'Lower sensitivity for examining higher-concentration calibrations.', recommendedMax: 100 },
  { id: 'pb-220353', element: 'Pb', wavelength: 220.353, sensitivity: 18000, background: 2600, saturation: 1000000, curvature: -0.0025, label: 'High sensitivity', description: 'Most sensitive Pb line in this synthetic teaching model.', recommendedMax: 10 },
  { id: 'pb-217000', element: 'Pb', wavelength: 217.000, sensitivity: 8000, background: 1900, saturation: 1800000, curvature: -0.0012, label: 'Medium sensitivity', description: 'Moderate signal and improved high-concentration headroom.', recommendedMax: 25 },
  { id: 'pb-283306', element: 'Pb', wavelength: 283.306, sensitivity: 1900, background: 1200, saturation: 2200000, curvature: -0.0004, label: 'Low sensitivity', description: 'Weak trace signal and a broad upper concentration range.', recommendedMax: 100 },
  { id: 'fe-238204', element: 'Fe', wavelength: 238.204, sensitivity: 46000, background: 3000, saturation: 1300000, curvature: -0.003, label: 'High sensitivity', description: 'High response with early compression in saturation mode.', recommendedMax: 5 },
  { id: 'fe-259940', element: 'Fe', wavelength: 259.940, sensitivity: 23000, background: 2300, saturation: 1700000, curvature: -0.0018, label: 'Medium sensitivity', description: 'An intermediate line for comparing working ranges.', recommendedMax: 10 },
  { id: 'fe-239562', element: 'Fe', wavelength: 239.562, sensitivity: 3900, background: 1500, saturation: 2300000, curvature: -0.0007, label: 'Low sensitivity', description: 'Reduced response makes high-concentration measurements possible.', recommendedMax: 100 },
  { id: 'zn-213857', element: 'Zn', wavelength: 213.857, sensitivity: 65000, background: 2800, saturation: 1200000, curvature: -0.004, label: 'High sensitivity', description: 'Very strong trace response; limited high-concentration headroom.', recommendedMax: 2 },
  { id: 'zn-206200', element: 'Zn', wavelength: 206.200, sensitivity: 28000, background: 2000, saturation: 1600000, curvature: -0.002, label: 'Medium sensitivity', description: 'Moderate response for a wider calibration range.', recommendedMax: 10 },
  { id: 'zn-202548', element: 'Zn', wavelength: 202.548, sensitivity: 4800, background: 1400, saturation: 2400000, curvature: -0.0006, label: 'Low sensitivity', description: 'Lower response for high-concentration calibration exercises.', recommendedMax: 100 },
];

const methodProfiles = calibrationData.profiles as MeasuredProfile[];
const preferredMethodElements = ['Cu', 'Cd', 'Mg', 'Ca', 'P', 'Pb', 'Ti', 'Zn', 'Fe', 'Sb'];
export const METHOD_ELEMENTS = preferredMethodElements.filter((element) => methodProfiles.some((profile) => profile.element === element));

/**
 * Method channels retain exact wavelength, geometry and acquisition mode.
 * Relative response compares blank-to-first-standard slopes within an element;
 * it is a property of this measured method, not a universal line ranking.
 * No detector saturation ceiling can be inferred from the numeric export.
 */
export const METHOD_LINES: SpectralLine[] = methodProfiles.map((profile) => {
  const strongest = Math.max(...methodProfiles.filter((candidate) => candidate.element === profile.element).map((candidate) => candidate.referenceSlope));
  const relativeResponse = 100 * profile.referenceSlope / strongest;
  const responseLabel = relativeResponse > 0 && relativeResponse < 1 ? relativeResponse.toFixed(2) : relativeResponse.toFixed(0);
  return {
    id: profile.id,
    element: profile.element,
    wavelength: profile.wavelength,
    sensitivity: profile.referenceSlope,
    background: 0,
    saturation: Number.POSITIVE_INFINITY,
    curvature: 0,
    label: `${responseLabel}% relative response`,
    description: `${profile.description} Initial measured response: ${profile.referenceSlope.toPrecision(4)} cps/ppm (${relativeResponse.toFixed(1)}% of the strongest selected ${profile.element} channel).`,
    recommendedMax: profile.measuredMax,
    profile,
    view: profile.view,
    acquisitionMode: profile.mode,
    mixture: profile.mixture,
  };
}).sort((a, b) => METHOD_ELEMENTS.indexOf(a.element) - METHOD_ELEMENTS.indexOf(b.element)
  || a.wavelength - b.wavelength || a.id.localeCompare(b.id));

export interface Standard {
  id: string;
  name: string;
  concentration: number;
  included: boolean;
  readings: number[];
  /** True only after the requested replicate sequence completed. */
  acquisitionComplete?: boolean;
}

export interface FitPoint {
  id: string;
  concentration: number;
  signal: number;
  predictedSignal: number;
  backCalculated: number;
  relativeError: number | null;
  residual: number;
}

export interface FitResult {
  slope: number;
  intercept: number;
  forcing: Forcing;
  anchorId: string | null;
  freeParameters: 1 | 2;
  observationCount: number;
  /** Unweighted 1 - SSE/SST, even for a weighted fit. */
  r2: number;
  /** Unweighted residual SE, cps; n - freeParameters degrees of freedom. */
  residualSE: number;
  /** Relative concentration error (%), nonzero standards, k - 2 df. */
  relativeSE: number | null;
  points: FitPoint[];
}

export function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sd(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

export function rsd(values: number[]): number | null {
  const average = mean(values);
  const deviation = sd(values);
  if (!Number.isFinite(average) || !Number.isFinite(deviation) || average === 0) return null;
  const relative = 100 * (deviation / Math.abs(average));
  return Number.isFinite(relative) ? relative : null;
}

export interface WeightPoint {
  id: string;
  role: 'fit' | 'anchor' | 'omitted';
  sd: number | null;
  rsd: number | null;
  /** Raw, unnormalized regression weight; relative SD uses fractional units. */
  weight: number | null;
}

export interface WeightResult {
  points: WeightPoint[];
  error: string | null;
  forcing: Forcing;
  anchor: { id: string; intensity: number } | null;
}

/**
 * Inspect included, measured standards without modifying their readings.
 * SD is sample SD of replicate intensities (n - 1 denominator), in cps.
 * RSD diagnostics are 100 * SD / abs(mean), in percent. Qtegra precision weights
 * are 1/SD² and 1/(SD/abs(mean))², respectively. The relative weight therefore
 * equals (100 / RSDpercent)², not 1/RSDpercent². Explicit forcing is independent
 * of weighting. A forced blank is an intercept anchor without a numeric weight;
 * a free inverse-concentration fit omits the zero-concentration blank. Undefined
 * precision weights on numerical fit observations invalidate the fit.
 *
 * Omitting the third argument preserves the earlier two-argument API's legacy
 * concentration-weighting/blank-forcing link. Interactive callers pass forcing
 * explicitly so both choices remain independent.
 */
export function calculateWeights(standards: Standard[], weighting: Weighting, selectedForcing?: Forcing): WeightResult {
  const measured = standards.filter((standard) => standard.included && standard.readings.length > 0);
  const concentrationWeighted = weighting === '1/x' || weighting === '1/x2';
  const forcing = selectedForcing ?? (concentrationWeighted ? 'blank' : 'none');
  const blanks = measured.filter((standard) => standard.concentration === 0);
  const precision = weighting === '1/SD2' || weighting === '1/RSD2';
  const weightingLabel = weighting === '1/SD2' ? '1/SD²' : weighting === '1/RSD2' ? '1/RSD²' : weighting;
  let error: string | null = forcing === 'blank' && blanks.length !== 1
    ? 'Force to blank requires exactly one included, measured calibration blank to anchor the fit.'
    : null;
  let anchor: WeightResult['anchor'] = null;
  const points = measured.map((standard): WeightPoint => {
    const isBlank = standard.concentration === 0;
    const role: WeightPoint['role'] = isBlank && forcing === 'blank' ? 'anchor' : isBlank && concentrationWeighted ? 'omitted' : 'fit';
    const point: WeightPoint = { id: standard.id, role, sd: null, rsd: null, weight: null };
    const fail = (reason: string) => {
      error ??= `${standard.name}: ${reason}`;
      return point;
    };
    if (!Number.isFinite(standard.concentration) || standard.concentration < 0) return fail('concentration must be finite and nonnegative.');
    if (standard.readings.some((value) => !Number.isFinite(value))) return fail('all replicate intensities must be finite.');
    const average = mean(standard.readings);
    if (!Number.isFinite(average)) return fail('the mean replicate intensity must be finite.');
    if (standard.readings.length > 1) {
      const deviation = sd(standard.readings);
      if (!Number.isFinite(deviation)) return fail('the replicate SD must be finite.');
      point.sd = deviation;
      if (average !== 0) {
        const relative = 100 * (deviation / Math.abs(average));
        if (!Number.isFinite(relative)) return fail('the replicate RSD must be finite.');
        point.rsd = relative;
      }
    }
    if (point.role === 'anchor') {
      if (blanks.length === 1) anchor = { id: standard.id, intensity: average };
      return point;
    }
    if (point.role === 'omitted') return point;
    if (precision) {
      if (standard.readings.length < 2) return fail(`${weightingLabel} weighting requires at least 2 replicate readings.`);
      if (point.sd === null || point.sd <= 0) return fail(`${weightingLabel} weighting requires a positive replicate SD.`);
      if (weighting === '1/RSD2' && average === 0) return fail('1/RSD² weighting requires a nonzero mean intensity.');
      point.weight = weighting === '1/SD2' ? (1 / point.sd) ** 2 : (Math.abs(average) / point.sd) ** 2;
    } else if (weighting === 'none') {
      point.weight = 1;
    } else {
      point.weight = weighting === '1/x2' ? 1 / standard.concentration ** 2 : 1 / standard.concentration;
    }
    if (!Number.isFinite(point.weight) || point.weight <= 0) {
      point.weight = null;
      return fail(`${weightingLabel} weighting requires a finite, positive weight.`);
    }
    return point;
  });
  return { points, error, forcing, anchor };
}

/**
 * Fit standard mean responses with independently selected intercept forcing.
 * Every included measured standard supplies one mean. A forced blank sets the
 * intercept and is excluded from numeric fit observations. A free intercept
 * estimates both parameters; inverse-concentration weights omit zero rather
 * than inventing a blank coefficient. Precision weights use inverse sample
 * variance or inverse squared fractional relative SD.
 *
 * Omitting selectedForcing preserves the archival two-argument API defaults.
 */
export function fitCalibration(standards: Standard[], weighting: Weighting, selectedForcing?: Forcing): FitResult | null {
  const measured = standards.filter((standard) => standard.included && standard.readings.length > 0);
  if (measured.length < 3 || new Set(measured.map((standard) => standard.concentration)).size < 3) return null;
  if (measured.some((standard) => !Number.isFinite(standard.concentration) || standard.concentration < 0 || standard.readings.some((value) => !Number.isFinite(value)))) return null;
  const weights = calculateWeights(standards, weighting, selectedForcing);
  const numericWeights = weights.points.filter((point) => point.role === 'fit');
  if (weights.error || numericWeights.some((point) => point.weight === null)) return null;
  if (weights.forcing === 'blank' && !weights.anchor) return null;
  const weightById = new Map(numericWeights.map((point) => [point.id, point.weight!]));
  const maximumWeight = Math.max(...numericWeights.map((point) => point.weight!));
  if (!Number.isFinite(maximumWeight) || maximumWeight <= 0) return null;
  const observations = measured.filter((standard) => weightById.has(standard.id)).map((standard) => ({
    standard,
    x: standard.concentration,
    y: mean(standard.readings),
    // A common normalization preserves the WLS objective while
    // avoiding overflow in sums. Diagnostic weights above remain raw.
    weight: weightById.get(standard.id)! / maximumWeight,
  }));
  if (observations.some((point) => !Number.isFinite(point.weight) || point.weight <= 0)) return null;
  const freeParameters = weights.forcing === 'blank' ? 1 : 2;
  if (observations.length <= freeParameters || new Set(observations.map(point => point.x)).size <= freeParameters) return null;
  let slope: number;
  let intercept: number;
  if (weights.forcing === 'blank') {
    intercept = weights.anchor!.intensity;
    const xx = observations.reduce((sum, point) => sum + point.weight * point.x ** 2, 0);
    const xy = observations.reduce((sum, point) => sum + point.weight * point.x * (point.y - intercept), 0);
    if (!(xx > 0) || !Number.isFinite(xx) || !Number.isFinite(xy)) return null;
    slope = xy / xx;
  } else {
    const totalWeight = observations.reduce((sum, point) => sum + point.weight, 0);
    const xMean = observations.reduce((sum, point) => sum + point.weight * point.x, 0) / totalWeight;
    const yMean = observations.reduce((sum, point) => sum + point.weight * point.y, 0) / totalWeight;
    const xx = observations.reduce((sum, point) => sum + point.weight * (point.x - xMean) ** 2, 0);
    const xy = observations.reduce((sum, point) => sum + point.weight * (point.x - xMean) * (point.y - yMean), 0);
    if (!(xx > 0) || !Number.isFinite(xx) || !Number.isFinite(xy)) return null;
    slope = xy / xx;
    intercept = yMean - slope * xMean;
  }
  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || Math.abs(slope) < Number.EPSILON) return null;
  const points: FitPoint[] = observations.map(({ standard, x, y }) => {
    const predictedSignal = intercept + slope * x;
    const backCalculated = (y - intercept) / slope;
    return {
      id: standard.id,
      concentration: x,
      signal: y,
      predictedSignal,
      backCalculated,
      relativeError: x > 0 ? 100 * (backCalculated - x) / x : null,
      residual: y - predictedSignal,
    };
  });
  const averageSignal = mean(points.map((point) => point.signal));
  const sse = points.reduce((sum, point) => sum + point.residual ** 2, 0);
  const sst = points.reduce((sum, point) => sum + (point.signal - averageSignal) ** 2, 0);
  if (!(sst > 0) || !Number.isFinite(sse) || !Number.isFinite(sst)) return null;
  const relativePoints = points.filter((point) => point.relativeError !== null);
  // Preserve the simulator's existing relative-error diagnostic denominator
  // k - 2 (two-term linear model), including legacy blank-forced fits. This is
  // not a claim of reproducing a vendor-specific historical RSE calculation.
  const relativeSE = relativePoints.length > 2
    ? Math.sqrt(relativePoints.reduce((sum, point) => sum + point.relativeError! ** 2, 0) / (relativePoints.length - 2))
    : null;
  return {
    slope,
    intercept,
    forcing: weights.forcing,
    anchorId: weights.anchor?.id ?? null,
    freeParameters,
    observationCount: observations.length,
    r2: 1 - sse / sst,
    residualSE: Math.sqrt(sse / (points.length - freeParameters)),
    relativeSE,
    points,
  };
}

function validateConcentration(concentration: number): void {
  if (!Number.isFinite(concentration) || concentration < 0) throw new RangeError('Concentration must be finite and nonnegative.');
}

/** Interpolate reference values; the final secant continues beyond the export. */
function measuredValue(concentration: number, profile: MeasuredProfile, key: 'mean' | 'sd'): number {
  const exact = profile.points.find((point) => point.concentration === concentration);
  if (exact) return exact[key];
  const upperIndex = profile.points.findIndex((point) => point.concentration > concentration);
  if (upperIndex === 0) return profile.points[0][key];
  const right = profile.points[upperIndex < 0 ? profile.points.length - 1 : upperIndex];
  const left = profile.points[upperIndex < 0 ? profile.points.length - 2 : upperIndex - 1];
  return left[key] + (right[key] - left[key]) * (concentration - left.concentration) / (right.concentration - left.concentration);
}

/**
 * Reference support for the expected mean, not an assertion of a validated
 * linear range. Blank-to-first-standard gaps also count as interpolation.
 */
export function describeRange(concentration: number, line: SpectralLine): 'measured' | 'interpolated' | 'extrapolated' {
  validateConcentration(concentration);
  if (!line.profile) return 'extrapolated';
  const points = line.profile.points;
  if (points.some((point) => point.concentration === concentration)) return 'measured';
  return concentration > points[0].concentration && concentration < points[points.length - 1].concentration ? 'interpolated' : 'extrapolated';
}

/**
 * Exported replicate SD at reference exposure, linearly interpolated between
 * standards. Above the measured range, retain the last relative precision,
 * with the exported blank SD as a floor. This is a modelling assumption.
 */
export function measuredSD(concentration: number, line: SpectralLine): number {
  validateConcentration(concentration);
  if (!line.profile) throw new RangeError('Measured SD requires an imported calibration profile.');
  const profile = line.profile;
  const last = profile.points[profile.points.length - 1];
  if (concentration <= last.concentration) return measuredValue(concentration, profile, 'sd');
  const signal = measuredValue(concentration, profile, 'mean');
  return Math.max(profile.referenceBlankSd, last.sd * Math.abs(signal) / Math.max(Math.abs(last.mean), 1e-9));
}

/** Total illustrative replicate SD; the blank term remains finite near zero. */
export function teachingSD(concentration: number, line: SpectralLine): number {
  validateConcentration(concentration);
  if (!line.teaching) throw new RangeError('Teaching SD requires a teaching response.');
  const netSignal = expectedSignal(concentration, line, 'teaching') - line.teaching.baseline;
  return Math.hypot(line.teaching.blankSd, line.teaching.relativeSd * netSignal);
}

/** A teaching-model saturation condition; callers decide when an acquired result may show it. */
export function isTeachingSaturated(concentration: number, line: SpectralLine): boolean {
  validateConcentration(concentration);
  if (!line.teaching || concentration === 0) return false;
  const netSignal = expectedSignal(concentration, line, 'teaching') - line.teaching.baseline;
  return netSignal / line.teaching.plateau >= 0.98;
}

/**
 * Expected intensity before random acquisition noise. Teaching channels always
 * use their smooth saturation curve. Archival imported channels always follow
 * measured means, including the nonzero blank; their extrapolation adds no cap.
 */
export function expectedSignal(concentration: number, line: SpectralLine, mode: ResponseMode): number {
  validateConcentration(concentration);
  if (line.teaching) {
    const { baseline, plateau } = line.teaching;
    return baseline - plateau * Math.expm1(-line.sensitivity * concentration / plateau);
  }
  if (line.profile) return measuredValue(concentration, line.profile, 'mean');
  const ideal = line.sensitivity * concentration;
  if (mode === 'saturation') return -line.saturation * Math.expm1(-ideal / line.saturation);
  if (mode === 'curvature') return ideal * Math.max(0, 1 + line.curvature * concentration);
  return ideal;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic independent Gaussian replicates, not the instrument's raw runs.
 * Teaching channels combine a blank SD and proportional net-signal SD, using
 * export-informed scales. Archival imported channels use the exported SD
 * without adding electronic, photon or
 * proportional noise a second time. Their reference exposure is 5 s; an
 * optional 1/sqrt(t) precision scaling is a noise-only teaching assumption and
 * does not change the measured response curve or predict detector saturation.
 * Legacy channels keep their synthetic electronic/photon/proportional model.
 */
export function measureStandard(concentration: number, line: SpectralLine, mode: ResponseMode, replicates: number, integration: number, seed: number): number[] {
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 1000) throw new RangeError('Replicates must be an integer from 1 to 1000.');
  if (!Number.isFinite(integration) || integration <= 0) throw new RangeError('Integration time must be positive.');
  if (!Number.isFinite(seed)) throw new RangeError('Seed must be finite.');
  const signal = expectedSignal(concentration, line, mode);
  const sigma = line.teaching
    ? teachingSD(concentration, line) * Math.sqrt(5 / integration)
    : line.profile
    ? measuredSD(concentration, line) * Math.sqrt(calibrationData.source.referenceExposureSeconds / integration)
    : Math.sqrt(4 ** 2 + Math.abs(signal) + line.background + (0.003 * Math.abs(signal)) ** 2) / Math.sqrt(integration);
  const random = seededRandom(seed);
  return Array.from({ length: replicates }, () => {
    const u = Math.max(random(), Number.MIN_VALUE);
    const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    return signal + normal * sigma;
  });
}

/** Estimated instrumental limits in ppm: LOD = 3s/m; LOQ = 10s/m. */
export function estimatedLimits(standards: Standard[], fit: FitResult | null): { lod: number; loq: number; count: number } | null {
  if (!fit || !Number.isFinite(fit.slope) || fit.slope <= 0) return null;
  const blankReadings = standards
    .filter((standard) => standard.included && standard.concentration === 0)
    .flatMap((standard) => standard.readings);
  if (blankReadings.length < 10 || blankReadings.some((value) => !Number.isFinite(value))) return null;
  const blankSD = sd(blankReadings);
  if (!Number.isFinite(blankSD)) return null;
  return { lod: 3 * blankSD / fit.slope, loq: 10 * blankSD / fit.slope, count: blankReadings.length };
}
