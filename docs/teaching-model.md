# Five-element calibration teaching model

The current laboratory uses **Mg and Na** as macro-concentration examples and **As, Cd, and Pb** as trace examples. Each element has two selectable wavelengths and an independent **Observation view** selector offering **Radial** and **Axial**, giving twenty wavelength/view combinations. The sensitivity labels compare the two selected wavelengths within the same view; they are not universal rankings for every ICP-OES instrument.

## Selected wavelengths and reference views

| Element | Higher-sensitivity wavelength | Lower-sensitivity wavelength | Reference view / mode | Initial sensitivity ratio, higher / lower |
| --- | --- | --- | --- | ---: |
| Mg | 279.553 nm | 279.079 nm | Radial · iFR | 262× |
| Na | 589.592 nm | 330.237 nm | Radial · iFR | 547× |
| As | 189.042 nm | 193.759 nm | Axial · eUV | 1.40× |
| Cd | 214.438 nm | 226.502 nm | Axial · iFR | 1.09× |
| Pb | 220.353 nm | 216.999 nm | Axial · eUV | 7.15× |

All ten wavelength/reference-view/mode combinations in the table occur in the supplied calibration export. These reference views identify the source measurements; both views are selectable for every wavelength in the simulator. Initial reference-view sensitivity is the blank-subtracted intensity at the first positive source level divided by that concentration. Blank mean, blank SD, and fractional relative SD at the highest source standard also inform the model's numerical scale. These inputs are stored in [teaching-method.ts](../src/lib/teaching-method.ts).

Cd's two measured sensitivities differ by only about 9%; As has a modest 40% contrast. Their labels identify the larger and smaller response in this pair without implying a large separation. Qtegra scans with relative-intensity scales and acquisition view/mode visible can confirm these choices or identify additional weaker lines. The simulator does not assign a fabricated lower sensitivity to an unmeasured Cd wavelength.

## Observation view

The teaching ratio is **`k_Axial = 5.5 × k_Radial`**, where `k` is initial net sensitivity in cps/ppm. The reference-view sensitivity in the table remains anchored to the export. For a Radial reference, Axial sensitivity is multiplied by 5.5; for an Axial reference, Radial sensitivity is divided by 5.5. The additional view is derived rather than presented as another measured calibration.

Each wavelength has the **same net-signal plateau in both views**. Increasing Axial sensitivity therefore makes it approach that plateau at a lower concentration. The 5.5 ratio applies to initial sensitivity and approximately to low-concentration net intensities. Once saturation develops, the Axial/Radial intensity ratio decreases toward one as the common plateau is approached.

Blank mean, blank SD, and fractional relative SD are held equal across views as a simplifying assumption. The proportional noise contribution follows the net signal generated in the selected view. Switching view preserves the selected wavelength, concentration list, and exclusions, and clears acquired readings, the fitted curve, and saturation comments.

## Response model

For each line, the expected intensity is:

`I_expected(C) = I₀ + S × [1 − exp(−k × C / S)]`

| Symbol | Meaning | Unit |
| --- | --- | --- |
| `C` | Solution concentration | ppm, interpreted as mg/L |
| `I₀` | Blank mean intensity | cps |
| `k` | Initial sensitivity | cps/ppm |
| `S` | Illustrative net-signal plateau | cps |

The plateau is chosen as `S = k_reference × c_scale`, with `c_scale = 15 ppm` for higher-sensitivity examples and `600 ppm` for lower-sensitivity examples. `k_reference` is the source reference-view sensitivity; the selected view supplies `k` in the response equation. This creates a near-linear response at low concentrations and automatic flattening at higher concentrations. There is no student switch between Linear and Saturated response outcomes. The chart's **Linear / Log x** controls change only the concentration axis.

At 100 ppm **in the source reference view**, a higher-sensitivity example reaches about **99.87% of its modeled plateau**, and its signal per ppm is about **15%** of its initial sensitivity. A lower-sensitivity example retains about **92%** of its initial signal per ppm. Both responses remain finite, smooth, and increasing. The underlying curve can be shown separately from the fitted straight calibration line using **Show model**. The table displays no response definitions or classifications before acquisition. Only **Saturation** is shown after a saturated standard completes acquisition, when its expected net intensity reaches at least **98% of the illustrative plateau**. Unmeasured standards, partial acquisitions, blanks, and unsaturated results receive no response comment. This comment describes modeled saturation and does not assert a Qtegra detector flag.

**The plateaus and their differences are teaching assumptions.** They do not fit the source calibration's complete response, establish real detector saturation thresholds, or predict Qtegra `N/A`, peak-pixel, or adjacent-pixel flags. In particular, the original high-level Mg results were numeric without saturation flags; Na was nearly proportional across its measured high-concentration standards. The present artificial flattening is intentional for demonstrating calibration-range selection. Cd's and As's distinct teaching plateaus are not evidence of equally large differences in their real working ranges.

## Replicate generation

The UI uses **5 s exposure** and 3, 5, or 10 repeat readings. The expected net signal is `I_expected − I₀`. At 5 s, the generating SD is:

`σ(C) = sqrt(blank_SD² + [relative_SD × net_signal(C)]²)`

Each replicate is an independent seeded Gaussian draw with mean `I_expected(C)` and SD `σ(C)`. Blank statistics and relative SD are export-informed scales; the combined noise formula is assumed. Negative blank results are retained. New acquisitions advance the seed, so a repeated calibration fluctuates around the same response curve. These readings are simulated rather than reconstructed original instrument replicates.

The red graph bars are **mean ± one sample SD of the generated readings**, using the `n − 1` denominator. They do not show SEM, a confidence interval, or the uncertainty of a source mean. The concentration-error graph propagates this SD through the fixed fitted line; calibration-parameter uncertainty is not included.

## Standard editing and session behavior

The solution table uses **Calibration blank** and generic **Standard 1, Standard 2, …** names. It does not expose the source method's standard names. Positive concentrations may be edited from **0.01 to 100 ppm**, added singly, added as a comma-separated list, or deleted. The zero blank is retained even when all positive levels are removed; an insufficient level set produces no regression rather than an invented fit.

Every preset includes the blank:

| Standard set | Positive concentrations, ppm |
| --- | --- |
| Low range, default | 0.1, 0.5, 1 |
| Wide range | 0.1, 0.5, 1, 10, 25, 50, 100 |
| High range | 10, 25, 50, 100 |
| Trace range | 0.01, 0.05, 0.1, 0.5, 1 |

Changing the analytical wavelength or observation view preserves the user's concentration list and clears incompatible readings, the fitted calibration, and saturation comments. Changing a single concentration clears readings for that standard. Excluding a standard preserves its readings while recalculating the fit. CSV exports use the current generic names, identify the selected observation view, record the teaching model's parameters, and leave the saturation-comment cells empty for unsaturated results.

The model version is **`teaching-v2`**. Teaching sessions use a separate browser-storage key from earlier synthetic and measured-method sessions. Changing the model version prevents old acquisitions from being combined silently with a new response model. The independent intercept control does not alter this response-model version. Existing teaching sessions without a saved intercept choice retain their former effective choice: Force to blank for inverse-concentration weighting, Free intercept otherwise. Their readings are preserved; subsequent weighting changes leave the saved intercept choice unchanged.

## Calibration calculations

The calibration is still a straight-line fit, **`I = b + m × C`**, with inverse **`C = (I − b) / m`**. `I` is mean intensity in cps, `C` is concentration in ppm, `m` is fitted sensitivity in cps/ppm, and `b` is intercept in cps. Including a flattened region can bias back-calculated concentrations even when the precision is good. Weighting changes the fit's emphasis; it cannot restore a linear physical response.

The **Intercept** control is independent of **None**, **1/x**, **1/x²**, **1/SD²**, and **1/RSD²** weighting:

- **Free intercept**, the new-session default, fits both slope `m` and intercept `b`. It applies no zero or blank constraint. At least three distinct numerical fit levels are required.
- **Force to blank** fixes `b` to the included, measured blank mean, then fits only the slope. It requires that blank and at least two distinct positive measured levels. The blank has no numeric weight and the table shows **ANCHOR**, for every weighting option.

With a free intercept and **1/x** or **1/x²**, the zero blank is omitted from the numerical regression because its weight is undefined. The table shows **NO WEIGHT**; three distinct positive levels are required. Other free-intercept weighting modes can use the blank as a normal numerical observation when their precision requirements are satisfied. A blank serving only as a fixed anchor needs a measured mean and does not need its own numerical SD/RSD weight.

Changing intercept or weighting refits the same acquired readings. The slope, intercept, back-calculated concentrations, errors, residual statistics and slope-dependent LOD/LOQ may change; measured replicate values and their means, SDs and RSDs do not. Selecting **Force to blank** with inverse-concentration weighting reproduces the documented legacy regression. Details and statistical scope remain in [the Qtegra calculation note](qtegra-legacy-calibration.md) and the [README](../README.md).

Internal-standard correction is **None**. The current simulator fits generated intensity directly and applies no Ar normalization. The comprehensive report's internally standardized results remain reference information rather than an implemented correction path.

The earlier [measured-data report](calibration-data-report.md) and imported profiles are retained as an archive. They are not the current teaching response curves.
