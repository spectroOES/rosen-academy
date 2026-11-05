# Five-element calibration teaching model

The current laboratory uses **Mg and Na** as macro-concentration examples and **As, Cd, and Pb** as trace examples. Each element has two selectable lines. The labels compare the two selected channels under the supplied acquisition conditions; they are not universal rankings for every ICP-OES instrument.

## Selected channels

| Element | Higher-sensitivity example | Lower-sensitivity example | Initial sensitivity ratio, higher / lower |
| --- | --- | --- | ---: |
| Mg | 279.553 nm · Radial · iFR | 279.079 nm · Radial · iFR | 262× |
| Na | 589.592 nm · Radial · iFR | 330.237 nm · Radial · iFR | 547× |
| As | 189.042 nm · Axial · eUV | 193.759 nm · Axial · eUV | 1.40× |
| Cd | 214.438 nm · Axial · iFR | 226.502 nm · Axial · iFR | 1.09× |
| Pb | 220.353 nm · Axial · eUV | 216.999 nm · Axial · eUV | 7.15× |

All ten wavelength/view/mode combinations occur in the supplied calibration export. Initial sensitivity is the blank-subtracted intensity at the first positive source level divided by that concentration. Blank mean, blank SD, and fractional relative SD at the highest source standard also inform the model's numerical scale. These inputs are stored in [teaching-method.ts](../src/lib/teaching-method.ts).

Cd's two measured sensitivities differ by only about 9%; As has a modest 40% contrast. Their labels identify the larger and smaller response in this pair without implying a large separation. Qtegra scans with relative-intensity scales and acquisition view/mode visible can confirm these choices or identify additional weaker lines. The simulator does not assign a fabricated lower sensitivity to an unmeasured Cd wavelength.

## Response model

For each line, the expected intensity is:

`I_expected(C) = I₀ + S × [1 − exp(−k × C / S)]`

| Symbol | Meaning | Unit |
| --- | --- | --- |
| `C` | Solution concentration | ppm, interpreted as mg/L |
| `I₀` | Blank mean intensity | cps |
| `k` | Initial sensitivity | cps/ppm |
| `S` | Illustrative net-signal plateau | cps |

The plateau is chosen as `S = k × c_scale`, with `c_scale = 15 ppm` for higher-sensitivity examples and `600 ppm` for lower-sensitivity examples. This creates a near-linear response at low concentrations and automatic flattening at higher concentrations. There is no student switch between Linear and Saturated response outcomes. The chart's **Linear / Log x** controls change only the concentration axis.

At 100 ppm, a higher-sensitivity example reaches about **99.87% of its modeled plateau**, and its signal per ppm is about **15%** of its initial sensitivity. A lower-sensitivity example retains about **92%** of its initial signal per ppm. Both responses remain finite, smooth, and increasing. The underlying curve is shown separately from the fitted straight calibration line.

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

Changing the analytical channel preserves the user's concentration list and clears incompatible readings. Changing a single concentration clears readings for that standard. Excluding a standard preserves its readings while recalculating the fit. CSV exports use the current generic names and record the teaching model's parameters.

The model version is **`teaching-v1`**. Teaching sessions use a separate browser-storage key from earlier synthetic and measured-method sessions. Changing the model version prevents old acquisitions from being combined silently with a new response model.

## Calibration calculations

The calibration is still a straight-line fit, **`I = b + m × C`**, with inverse **`C = (I − b) / m`**. `I` is mean intensity in cps, `C` is concentration in ppm, `m` is fitted sensitivity in cps/ppm, and `b` is intercept in cps. Including a flattened region can bias back-calculated concentrations even when the precision is good. Weighting changes the fit's emphasis; it cannot restore a linear physical response.

The earlier Qtegra-compatible weighting behavior remains: **None**, **1/x**, **1/x²**, **1/SD²**, and **1/RSD²**. Inverse-concentration options fix the intercept to the acquired blank mean under the legacy **Forcing = Blank** convention. The blank is an anchor without a numeric inverse-concentration weight. Details and statistical scope remain in [the Qtegra calculation note](qtegra-legacy-calibration.md) and the [README](../README.md).

The earlier [measured-data report](calibration-data-report.md) and imported profiles are retained as an archive. They are not the current teaching response curves.
