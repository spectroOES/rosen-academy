import type { SpectralLine, TeachingResponse } from './model';

/** Bump when teaching parameters change so saved acquisitions cannot mix models. */
export const TEACHING_MODEL_VERSION = 'teaching-v1';
export const TEACHING_ELEMENTS = ['Mg', 'Na', 'As', 'Cd', 'Pb'] as const;

type Channel = {
  element: typeof TEACHING_ELEMENTS[number];
  wavelength: number;
  view: 'Axial' | 'Radial';
  mode: 'iFR' | 'eUV';
  role: TeachingResponse['role'];
  sensitivity: number;
  baseline: number;
  blankSd: number;
  relativeSd: number;
};

// Sensitivity is the blank-to-first-positive-standard slope in the supplied
// calibration export. Blank statistics and fractional relative SD at its last
// standard retain the same export's precision scale. These inputs do not make
// the new saturation curve a fit or prediction of the physical detector.
const channels: Channel[] = [
  { element: 'Mg', wavelength: 279.553, view: 'Radial', mode: 'iFR', role: 'high', sensitivity: 37358.0794024984, baseline: 47.90223754, blankSd: 1.265996031, relativeSd: 0.0036470884044264456 },
  { element: 'Mg', wavelength: 279.079, view: 'Radial', mode: 'iFR', role: 'low', sensitivity: 142.43908266892, baseline: 0.189355277, blankSd: 0.497108382, relativeSd: 0.004216185749089034 },
  { element: 'Na', wavelength: 589.592, view: 'Radial', mode: 'iFR', role: 'high', sensitivity: (21772.86205 + 9.96646786) / 25, baseline: -9.96646786, blankSd: 1.68292208, relativeSd: 593.6863908 / 84589.6446 },
  { element: 'Na', wavelength: 330.237, view: 'Radial', mode: 'iFR', role: 'low', sensitivity: (38.49891075 + 1.287814411) / 25, baseline: -1.287814411, blankSd: 0.947689116, relativeSd: 0.27060455 / 152.1580202 },
  { element: 'As', wavelength: 189.042, view: 'Axial', mode: 'eUV', role: 'high', sensitivity: (2.685614408 + 0.582223326) / 0.01, baseline: -0.582223326, blankSd: 0.346968587, relativeSd: 0.299600294 / 334.696152 },
  { element: 'As', wavelength: 193.759, view: 'Axial', mode: 'eUV', role: 'low', sensitivity: (1.811047247 + 0.516971276) / 0.01, baseline: -0.516971276, blankSd: 0.458388064, relativeSd: 0.674415074 / 231.2468333 },
  { element: 'Cd', wavelength: 214.438, view: 'Axial', mode: 'iFR', role: 'high', sensitivity: 13595.0152931, baseline: -0.415414831, blankSd: 0.44533751, relativeSd: 0.005406982463251293 },
  { element: 'Cd', wavelength: 226.502, view: 'Axial', mode: 'iFR', role: 'low', sensitivity: 12475.6110494, baseline: 0.101870506, blankSd: 1.642824786, relativeSd: 0.0038000214742817833 },
  { element: 'Pb', wavelength: 220.353, view: 'Axial', mode: 'eUV', role: 'high', sensitivity: 879.3178475, baseline: 0.369273011, blankSd: 0.287762165, relativeSd: 0.002056850896196633 },
  { element: 'Pb', wavelength: 216.999, view: 'Axial', mode: 'eUV', role: 'low', sensitivity: 123.0198822, baseline: 0.020030416, blankSd: 0.414793624, relativeSd: 0.006079884415938814 },
];

/**
 * Every channel has a smooth, concentration-dependent response. The chosen
 * plateau/slope ratios (15 ppm for higher, 600 ppm for lower sensitivity) are
 * explicit teaching choices. They demonstrate high-level flattening without
 * asserting measured detector saturation or inventing Qtegra invalid flags.
 */
export const TEACHING_LINES: SpectralLine[] = channels.map((channel) => {
  const strongest = Math.max(...channels.filter(other => other.element === channel.element).map(other => other.sensitivity));
  const relative = 100 * channel.sensitivity / strongest;
  const relativeLabel = relative < 1 ? relative.toFixed(2) : relative.toFixed(0);
  const roleLabel = channel.role === 'high' ? 'Higher sensitivity' : 'Lower sensitivity';
  const plateau = channel.sensitivity * (channel.role === 'high' ? 15 : 600);
  return {
    id: `${channel.element.toLowerCase()}-${channel.wavelength.toFixed(3).replace('.', '')}-${channel.view.toLowerCase()}-${channel.mode.toLowerCase()}`,
    element: channel.element,
    wavelength: channel.wavelength,
    sensitivity: channel.sensitivity,
    background: 0,
    saturation: plateau,
    curvature: 0,
    label: `${roleLabel} · ${relativeLabel}% response`,
    description: `${roleLabel} in the selected pair. Initial sensitivity is export-informed; high-concentration saturation is illustrative.${channel.element === 'Cd' ? ' These two Cd lines have similar initial sensitivities (about 9% apart).' : ''}`,
    recommendedMax: channel.role === 'high' ? 1 : 100,
    view: channel.view,
    acquisitionMode: channel.mode,
    teaching: {
      role: channel.role,
      baseline: channel.baseline,
      blankSd: channel.blankSd,
      relativeSd: channel.relativeSd,
      plateau,
      provenance: 'Initial sensitivity, blank mean/SD, and high-standard relative SD are based on the calibration export. The smooth response, saturation plateau, and noise scaling are teaching assumptions.',
    },
  };
});
