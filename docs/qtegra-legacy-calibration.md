# Qtegra legacy inverse-concentration calibration

## Implemented behavior

For the simulator's `1/x` and `1/x²` options (`x` is concentration), use the pre-2.25 workflow documented in the iCAP PRO manual:

- The included, measured calibration blank fixes the intercept: `b = mean(blank replicate intensities)`.
- Zero-concentration blank observations have no numerical regression weight. They are not replaced by an epsilon or the lowest positive concentration.
- Only included, measured nonzero standards contribute to the weighted fit, with `w = 1/c` or `w = 1/c²`.
- With that intercept fixed, calculate `slope = sum(w*c*(mean_signal − b)) / sum(w*c²)`.
- At least two distinct nonzero measured concentrations are required in addition to the blank. The UI labels the blank's role **ANCHOR** and displays **Forcing: Blank (legacy)**.
- If the blank is absent, unmeasured, excluded, or ambiguous, display an explicit error. Do not substitute a zero intercept or revert to a free fit. This is a simulator validation policy: the supplied documents do not specify every historical missing-blank fallback.
- The simulator currently models one blank analysis with multiple replicates. It does not implement multiple BLK/AVERAGE BLK blocks or their selection rules.

Switching weighting refits existing readings. Re-measuring the blank changes its mean anchor and therefore the weighted slope, fitted concentrations, and slope-dependent limits. It does not change the acquired nonzero-standard readings.

## Source evidence

References are to the PDF files supplied by the user. Full vendor PDFs are not distributed with this repository.

| Source | PDF page / printed page | Relevant statement |
| --- | --- | --- |
| *iCAP PRO Series ICP-OES Software Manual*, P/N BRE0016950, Revision J | 430 / 9-38 | For 1/Concentration and 1/Concentration², “Blanks are ignored (as their concentration is 0) and Forcing is set to Blank.” |
| *Data Processing Algorithms for ICP-OES*, P/N BRE0009766, Revision G, Table 4-2 | 37 / 4-9 | Blank forcing fixes `f(0)` to the BLK or AVERAGE BLK intensity. |
| Same document, Table 4-2 | 38 / 4-10 | The concentration weights are `1/c` and `1/c²`; blanks are ignored because their concentration is zero. |
| *Qtegra ISDS Software 2.25 Release Notes*, P/N BRE0066666, Revision B, feature 771937 | 3 / 3 | “Allow forcing to be defined for 1/concentration and 1/concentration2 weighting options.” |
| Same release notes, issue 864758 | 8 / 8 | Disabling the blank sets forcing to NO rather than ZERO in 2.25. This is not used to infer an undocumented legacy fallback. |

The user requested the legacy automatic blank-forcing behavior, not the new independent None/Zero/Blank controls. Accordingly, this implementation adds no modern forcing selector for the concentration-weighted modes.

## Diagnostics and scope

The requested regression and blank handling are verified against the sections above. This is not a complete, bug-for-bug reproduction of every Qtegra release's statistics.

- **Residual SE:** an unweighted signal-residual diagnostic, `sqrt(SSE / (n − p))`. Here `n` counts numerical fit observations; `p` is one free slope with a fixed blank intercept, or two fitted parameters for an unconstrained line. The blank anchor is not counted as a weighted observation.
- **Displayed R²:** the simulator's declared centered `1 − SSE/SST`, evaluated over numerical fit observations. Release 2.25 issue 602501 changes Pearson's R for several fit types but does not fully specify those revised formulas; this display is not labelled as that vendor R.
- **Relative concentration SE:** retains `sqrt(sum(relative_error_percent²) / (k − 2))`, omitting zero concentrations and using the two-term linear-polynomial convention. It is undefined for `k <= 2`. Algorithms PDF16 / printed2-2 defines polynomial term count; release2.25 issue603413 (PDF6) changes the forcing-related p calculation. No undocumented historical correction is inferred here.
- **Detection limits:** Algorithms PDF33 / printed4-5 defines `LOD = 3*SD_blank/slope` and `MQL = 10*SD_blank/slope*TDF`. The simulator shows estimated solution LOD and LOQ with TDF=1, requires at least ten included blank readings as its own readiness rule, and uses the newly fitted slope. Blank forcing changes the slope estimate; it is not a separate switch that enables the LOD formula.

## Precision-weighting options

The displayed **1/SD²** and **1/RSD²** options follow Qtegra's **Absolute SD** and **Relative SD** definitions in Algorithms Table4-2 (PDF38 / printed4-10):

- `w = 1/SD²`, where SD is the sample SD of replicate net intensities.
- `w = 1/(SD/abs(mean intensity))² = (mean intensity/SD)²`.

RSD values in tables and CSV are still percentages. Thus `w = (100/RSD%)²`, rather than `1/(RSD%)²`; the common factor10000 does not change the resulting regression but matters when displaying raw coefficients. Both precision modes retain a free intercept and require at least two readings, positive SD and finite positive weights; relative weighting also requires a nonzero mean.

Saved browser sessions using the earlier literal `1/SD` or `1/RSD` prototype selections migrate to the corresponding squared mode without discarding measurements.
