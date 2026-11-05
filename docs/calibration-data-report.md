# Imported calibration data

Source: `261028-29  CALIBRATION CPS for Simulator.csv`. Instrument: Thermo iCAP PRO Duo ICP-OES.
SHA-256: `7c934432532f1e43db6ca5544a0d62a90890e921fa2d5e42ff768b6e345f4ff9`.

The starter dataset contains **25 measured channels for 10 elements**. The raw export remains outside the repository; the JSON retains only these channels and their relevant standards. Wavelengths and acquisition-mode names come directly from the header. For example, the exported Cd wavelength is 214.438 nm.

## Standard assignment

| Mixture | Selected elements | Retained positive standards (ppm) |
| --- | --- | --- |
| I | Cd, Cu, Zn, Pb, Fe | 0.01, 0.1, 1 |
| II | Ti, Sb | 0.05, 0.1 |
| III | Mg, Ca, P | 25, 50, 100 |

Every profile also retains the measured `blank icp HNO3 1%` at zero concentration. The user confirmed that `Mixture 0.1 ppm` belongs to Mixture I; it is retained only for Mixture I elements. Signals in another mixture's rows are not assigned concentrations for the selected element, even when their intensity resembles a possible standard.

Mixture II standards are labelled `HCL 1%`, whereas the only blank is labelled `HNO3 1%`. This blank is used transparently as the available baseline; matrix differences can affect the inferred sensitivity, especially at low concentrations.

## Per-channel observations

Sensitivity is `(mean at lowest positive standard − blank mean) / concentration`, in cps/ppm. The endpoint ratio is `(net cps/ppm at highest standard) / (net cps/ppm at lowest standard)`. A ratio below 0.90 is marked as observed compression. This screening threshold is descriptive and is not a validated linearity criterion. It does not identify where nonlinearity begins or prove detector saturation. A ratio above 0.90 does not establish a validated linear range.

| Channel | Mixture | Measured positive range (ppm) | Reference sensitivity (cps/ppm) | Endpoint ratio | Observation |
| --- | --- | --- | ---: | ---: | --- |
| P 177.495 Axial iFR | III | 25–100 | 196.413 | 0.887 | Response compression |
| Zn 206.200 Axial iFR | I | 0.01–1 | 4,061.658 | 0.985 | No >10% endpoint compression |
| Sb 206.833 Axial eUV | II | 0.05–0.1 | 393.891 | 1.009 | No >10% endpoint compression |
| Zn 213.856 Axial iFR | I | 0.01–1 | 4,117.962 | 0.975 | No >10% endpoint compression |
| Cd 214.438 Axial iFR | I | 0.01–1 | 13,595.015 | 1.001 | No >10% endpoint compression |
| P 214.914 Axial iFR | III | 25–100 | 215.278 | 0.965 | No >10% endpoint compression |
| P 214.914 Radial iFR | III | 25–100 | 38.393 | 0.985 | No >10% endpoint compression |
| Pb 216.999 Axial eUV | I | 0.01–1 | 123.020 | 1.023 | No >10% endpoint compression |
| Sb 217.581 Axial eUV | II | 0.05–0.1 | 424.010 | 0.995 | No >10% endpoint compression |
| Pb 220.353 Axial eUV | I | 0.01–1 | 879.318 | 1.000 | No >10% endpoint compression |
| Cd 226.502 Axial iFR | I | 0.01–1 | 12,475.611 | 1.000 | No >10% endpoint compression |
| Fe 238.204 Radial iFR | I | 0.01–1 | 746.817 | 1.027 | No >10% endpoint compression |
| Fe 259.940 Axial iFR | I | 0.01–1 | 6,407.027 | 1.016 | No >10% endpoint compression |
| Mg 279.079 Radial iFR | III | 25–100 | 142.439 | 0.981 | No >10% endpoint compression |
| Mg 279.553 Radial iFR | III | 25–100 | 37,358.079 | 0.648 | Response compression |
| Mg 280.270 Axial iFR | III | 25–100 | 79,782.223 | 0.474 | Response compression |
| Mg 280.270 Radial iFR | III | 25–100 | 14,884.069 | 0.788 | Response compression |
| Mg 285.213 Axial iFR | III | 25–100 | 12,374.028 | 0.700 | Response compression |
| Mg 285.213 Radial iFR | III | 25–100 | 1,240.009 | 0.928 | No >10% endpoint compression |
| Ca 317.933 Radial iFR | III | 25–100 | 697.616 | 0.948 | No >10% endpoint compression |
| Cu 324.754 Axial iFR | I | 0.01–1 | 9,986.729 | 0.969 | No >10% endpoint compression |
| Cu 327.396 Axial iFR | I | 0.01–1 | 5,902.336 | 0.952 | No >10% endpoint compression |
| Ti 334.941 Axial iFR | II | 0.05–0.1 | 26,985.411 | 1.013 | No >10% endpoint compression |
| Ti 336.121 Axial iFR | II | 0.05–0.1 | 14,110.361 | 1.004 | No >10% endpoint compression |
| Ca 396.847 Radial iFR | III | 25–100 | 44,335.556 | 0.782 | Response compression |

## Mg illustrates the measured differences

All six Mg channels have the same three known positive concentrations. Strong Mg 280.270 Axial increases from about 1.995 million cps at 25 ppm to 3.778 million cps at 100 ppm, well short of a fourfold increase. Weak Mg 279.079 Radial increases from about 3,561 to 13,967 cps, much closer to fourfold. These measurements support different response shapes and sensitivity rankings for those channels under this method. The user confirmed that the high-concentration Mg results remained numeric and had no saturation flag in Qtegra. They are retained as numeric measurements without invalid or N/A status. The observed compression is not confirmed detector saturation; these rows cannot distinguish self-absorption, other instrument effects, or matrix-dependent response.

Mixture I contains three positive levels; Mixture II contains only two. Endpoint ratios compare net sensitivity at the retained levels, but the intermediate shape and the location of any nonlinear onset are not established. In particular, the Cd data stop at 1 ppm and provide no measured basis for saturation at 100 ppm.

## Measurement and model boundary

- Each JSON point is one exported mean, SD, and reported RSD percentage. Negative blank means are retained without clamping to zero.
- `baseline` and `referenceBlankSd` are the exported blank mean and SD. `referenceSlope` uses the lowest known positive standard. `referenceRsd` is the highest known standard's SD divided by its absolute mean, as a fraction rather than a percentage.
- The SD is the exported intensity SD. The file supplies no raw replicate values or replicate count; generated simulator replicates are synthetic and cannot reproduce an unknown original acquisition.
- The user confirmed 5 s exposure for all modes. No exposure-dependent detector limit can be calibrated from these rows alone. The file contains numeric intensities throughout and supplies no N/A, peak-saturation, or adjacent-pixel saturation flags. Separately, the user confirmed that Qtegra did not flag the high-concentration Mg results as saturated.
- Only the concentration knots listed above were measured. Smooth curves between them and predictions outside those ranges are educational model assumptions. No interpolation or extrapolation value is stored as a measured point.
- Neither an endpoint ratio nor a shared cps threshold is a detector full-well measurement. Experimental exposure settings, saturation flags, and additional standards are needed to constrain such a model.

## Reproduce

```sh
python3 scripts/import-calibration.py '/path/to/261028-29  CALIBRATION CPS for Simulator.csv'
```

The importer uses Python's standard library and rewrites `src/data/calibration-profiles.json` and this report deterministically. Use `--output` and `--report` to choose other destinations. It validates sample triplets, finite numeric data, nonnegative SD, unique known concentrations, exact channel-header structure, and unique profile identifiers.
