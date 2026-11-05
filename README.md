# Rosen Academy · ICP-OES Calibration Lab

An interactive educational instrument for exploring ICP-OES calibration. The entire interface is in English. Measurements and calculations run in the browser. The app can run locally, as a standalone file, or through Streamlit; it needs no instrument connection or external API credentials.

![Calibration workspace](docs/calibration-preview.png)

## Streamlit: persistent browser link

Live app: [Rosen Academy ICP-OES simulator](https://rosen-academy-3v6duxmcsbzvmerc3s52mk.streamlit.app/).

The **LEXICON** visual theme uses black text on white panels and bright green on black instrument controls. Graphs use gray backgrounds, black curves/axes/labels, and red replicate-SD bars.

The Streamlit entrypoint is **`streamlit_app.py`**. The existing English React laboratory is embedded unchanged, including its calibration model, CSV downloads, and browser-local session storage.

For Streamlit Community Cloud:

1. Sign in at [share.streamlit.io](https://share.streamlit.io/) and connect the GitHub account that can access this repository.
2. Create an app from repository **`spectroOES/rosen-academy`**, branch **`streamlit-calibration`**, entrypoint **`streamlit_app.py`**.
3. Select Python **3.12** in advanced settings, then deploy. `requirements.txt` installs the pinned Streamlit runtime. No secrets are required.
4. Streamlit provides the app's permanent URL after deployment. Repository access/privacy and app sharing are configured in the account's Streamlit settings.

This setup is deploy-ready; a local server or a successful test is not evidence that a Community Cloud app has been deployed. The first connection and deployment require access to the owner's Streamlit account.

### Updating the same link

The hosting server does not need Node.js: a deliberate, verified deployment bundle is committed in `streamlit_assets/`. After frontend changes, the developer runs:

```sh
npm run build:streamlit
```

Commit both source changes and `streamlit_assets/`, then push to the deployed branch. Community Cloud pulls the update. Open sessions check for a changed release every two seconds and refresh only when necessary; normal polling does not interrupt measurements. Community Cloud may take additional time to process a GitHub update or restart the app. After the update is processed, reload the existing app URL if needed. If an old version remains, the app owner can use **Manage app → Reboot app**. Keep the same app and URL; no new deployment needs to be created for an ordinary update.

### Streamlit development locally

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

When Node/npm and the frontend dependencies are installed, saving a frontend source file triggers a new build on the next update check. Completed calibration readings survive the iframe refresh through browser-local storage. A failed update keeps the previous working simulator and retries after another source change. On a Python-only host, always commit a fresh deployment bundle.

The two-second watcher is outside the simulator iframe; it does not reset an active acquisition. Browser storage is specific to the app's domain: a session from a downloaded HTML file is separate from one on the public Streamlit URL.

## Run

Requires Node.js 22.12+ (tested with Node 24) and npm.

```sh
npm ci
npm run dev
```

Vite uses port 5173 by default. Open the address printed by the command in an environment that provides browser access to that port. To create and serve a production build:

```sh
npm run build
npm run preview
```

## Open without installing anything

Generate a self-contained simulator:

```sh
npm run build:standalone
```

Download `dist/rosen-academy.html` and open it directly in Chrome, Edge, or Firefox. It includes the application, styles, and fonts, and works without a server or Internet connection. Keep the file at the same location to retain its browser-local session; if the browser restricts local-file storage, CSV export remains available.

## First experiment

1. In a fresh session, start with **Cu 324.754 Axial iFR**. Its four method levels load automatically: the blank, **0.01, 0.1, and 1 ppm**. Click **Load demo** for immediate simulated readings, or **Run calibration** to watch sequential acquisition.
2. Compare **None**, **1/x**, **1/x²**, **1/SD²**, and **1/RSD²** weighting without regenerating measurements. Inspect back-calculated concentration errors as well as R².
3. Select **Mg 280.270 Axial iFR** and acquire its blank, **25, 50, and 100 ppm** standards. Its recorded high-level response is compressed. Exclude the **100 ppm** standard with its checkbox and compare the fit; the readings are retained.
4. Compare **Mg 279.079 Radial iFR**, a weaker channel with much less recorded compression over the same levels. Changing the channel loads its own source levels and clears incompatible readings. Response follows the selected channel's data; exposure stays at **5 s**.
5. Use **Log x** to inspect the concentration range. The zero-concentration blank is hidden on this axis, but its regression inclusion remains unchanged.
6. Acquire **10 blank readings** to estimate instrumental LOD and LOQ. Export the session using **Export CSV**.

## Included

- **25 measured channels for 10 elements:** Cu, Cd, Mg, Ca, P, Pb, Ti, Zn, Fe, and Sb. Each channel retains its exported wavelength, **Axial/Radial** view, and **iFR/eUV** mode.
- Source standard levels load for each channel: **0, 0.01, 0.1, 1 ppm** for Mixture I; **0, 0.05, 0.1 ppm** for Mixture II; **0, 25, 50, 100 ppm** for Mixture III. Standards remain editable from **0.01 to 100 ppm**, plus the zero blank. Here ppm denotes mg/L in the simulated aqueous solutions.
- Channel response and precision based on the uploaded method's measured mean intensities and SDs. Added levels are labelled **Reference level**, **Interpolated**, or **Extrapolated** according to their source support.
- **3, 5, or 10 simulated repeat readings**, fixed **5 s** reference exposure, and accelerated acquisition playback.
- Standard means, sample SD, RSD, weighted linear regression with a free or legacy blank-fixed intercept, back-calculated concentrations, and error plots.
- A reference response curve defined by the imported means, distinct from the fitted calibration line, and a calibration equation with variable explanations.
- Red **±1 sample SD** bars on measured calibration points, including blank anchors and excluded measurements when visible. One reading has no estimable SD. The concentration-error graph propagates replicate SD through the fixed fitted line; calibration-parameter uncertainty is not included.
- Browser-local session persistence and CSV export containing raw replicate data and calculation metadata.
- Locally bundled fonts: no remote font or analytics requests.


### Reading the SD bars

On the calibration graph, red vertical bars span `mean intensity − sample SD` to `mean intensity + sample SD`, with caps. The axes include these extents, including negative blank signals. These bars represent variation between replicate readings, not SEM or confidence limits for a mean. Small bars remain to scale; the simulator does not exaggerate their height.

On the concentration-error graph, the red bar half-width is `100 * SD_signal / (abs(slope) * nominal concentration)` percentage points, centered on the back-calculated relative error. This conditional propagation treats the fitted line as fixed and excludes zero nominal concentration. On a logarithmic concentration axis, the zero blank and its bar are hidden while its legacy intercept constraint remains active.

## Scientific model and limitations

**Reference means and SDs are measured; new replicate readings are simulated.** The source is the supplied calibration CSV from a **Thermo iCAP PRO Duo ICP-OES**. The user confirmed that `Mixture 0.1 ppm` belongs to Mixture I and that every acquisition mode used **5 s exposure**. The imported dataset contains 96 mean/SD/RSD point triplets across 25 channels. See the [data provenance and response report](docs/calibration-data-report.md) for all channel ranges, sensitivity comparisons, and limitations.

At an exported concentration, the expected signal equals that channel's recorded mean. Between reference levels, **piecewise linear interpolation** connects the means, including the measured blank. Above the last reference level, the last segment's slope continues as **last-secant extrapolation**. The UI labels added levels and warns when they exceed the measured maximum. Extrapolated responses are unverified; for example, the Cd measurements stop at 1 ppm and do not establish its response at 100 ppm. Relative sensitivity compares the blank-to-first-standard slopes within this method, rather than claiming a universal ranking of emission lines.

The measured Mg channels show different degrees of high-level response compression. The user confirmed that those high-level Mg results remained numeric and **had no saturation flag in Qtegra**. They remain numeric reference points in the simulator. Their curvature does not establish detector saturation, a universal cps ceiling, or the onset of a validated nonlinear range. There is no manual Linear/Saturation outcome selector and no invented detector clipping threshold.

Simulated replicates are independent, seeded Gaussian draws around the reference response. At reference levels their generating SD is the exported intensity SD; between levels SD is linearly interpolated. Above the measured range, the model retains the final standard's relative precision, with blank SD as a floor. It adds no separate electronic, photon, or proportional noise to those measured SDs. A repeated seed reproduces the same readings; new acquisitions advance the seed. The resulting sample mean and SD vary around the source values and are not a reconstruction of the instrument's original replicates. Exposure is fixed at the confirmed 5 s, so the UI makes no exposure-dependent detector prediction.

The calibration remains a **linear regression**, so fitting a straight line across a compressed response exposes concentration bias. Its displayed equation is **`I = b + m × C`**, where `I` is mean intensity in cps, `C` is concentration in ppm, `m` is the slope in cps/ppm, and `b` is the intercept in cps. The inverse is **`C = (I − b) / m`**. In legacy concentration weighting, `b` is fixed to the acquired blank mean. Weighting cannot remove physical response compression, and there is no polynomial/nonlinear fitting in this version.

Blank signals may be negative. Blank RSD is normally labelled **n/a**, because percentages around zero are not informative. In **1/RSD²** mode its calculated numerical value is shown with **†**, because it contributes to the selected weighting; the warning about instability remains visible. The only exported blank is labelled 1% HNO3 while Mixture II standards are labelled 1% HCl, which limits interpretation of the latter's blank-corrected response. Only the selected channel is acquired; simultaneous multi-line acquisition and scanned spectra are not implemented.

Reproduce the selected-channel JSON and report from the original CSV with Python's standard library:

```sh
python3 scripts/import-calibration.py '/path/to/261028-29  CALIBRATION CPS for Simulator.csv'
```

The raw export is not committed. The generated [channel profiles](src/data/calibration-profiles.json) preserve the relevant measured values and the source file's SHA-256 hash.

Regression uses each included standard's mean as an observation and minimizes `sum(w_i * (mean_signal_i − intercept − slope * concentration_i)^2)`. Unconstrained fits require at least three distinct included, measured concentrations. Legacy concentration-weighted fits require an included measured blank plus at least two distinct nonzero measured concentrations.

| Option | Literal coefficient `w_i` |
| --- | --- |
| None | `1` |
| 1/x | `1 / concentration` |
| 1/x² | `1 / concentration²` |
| 1/SD² | `1 / SD²`, with SD the replicate sample SD in cps |
| 1/RSD² | `1 / (SD / abs(mean intensity))² = (100 / RSD%)²` |

For **1/x and 1/x²**, the documented **Qtegra legacy** behavior is used: the measured included blank mean fixes the intercept (**Forcing = Blank**), the blank has no numeric weight, and only nonzero standards enter the weighted slope calculation. The blank Weight cell displays **ANCHOR**. No substitute concentration is used. Missing, excluded, unmeasured or ambiguous blanks produce a clear error. The slope is `sum(w*c*(mean_signal − blank_mean)) / sum(w*c²)`. Other options retain a free intercept. For precision modes, each included measured standard requires at least two replicates and a finite, positive sample SD (`n − 1` denominator). **1/RSD²** additionally requires a nonzero measured mean. Undefined weights produce an explicit error: the simulator does not drop the standard, invent a floor, or revert to an unweighted fit. The user can acquire valid readings or explicitly exclude that standard.

Precision weights follow Qtegra Absolute SD and Relative SD: **1/SD²** and **1/(SD/abs(mean))²**. SD is the sample SD of replicate intensity, not the standard error of the mean. The displayed RSD is a percentage, whereas weighting uses fractional relative SD: `w = (100/RSD%)²`. Raw relative weights are therefore 10000 times `1/(RSD%)²`; that common scale does not change the fitted curve. A nonzero observed blank mean permits a relative-variance coefficient, but this coefficient is unstable near zero. Raw coefficients are shown in the **Weight** column and CSV; the regression rescales all weights by one common factor for numerical stability. Earlier fully synthetic sessions remain stored separately. Measured-method sessions are restored only when their source file and selected channel match this release.

**Vendor-algorithm status:** legacy inverse-concentration weighting and automatic blank forcing are verified against the supplied Qtegra manual and the 2.25 change notes. See [source references, formulas and scope](docs/qtegra-legacy-calibration.md). The precision weights also follow the squared definitions in Qtegra Algorithms Table 4-2 (PDF38 / printed4-10). The simulator does not claim complete historical Qtegra statistics compatibility.

- R² is `1 − SSE/SST` with **unweighted** SSE over numerical fit observations, including for weighted fits. It may be negative for a weighted fit and is not presented as the revised Qtegra 2.25 Pearson R.
- Residual SE is `sqrt(SSE / (n − p))`, in cps, over numerical fit observations; p=1 for a blank-fixed intercept and p=2 for a free line. The blank anchor is excluded from n in legacy concentration-weighted fits.
- Relative concentration SE is `sqrt(sum(relative concentration error in % squared) / (k − 2))`, where `k` is the count of included nonzero standards. It is undefined for `k <= 2`.
- Back-calculated concentration is `(mean signal − intercept) / slope`.
- Estimated instrumental LOD and LOQ are `3 s / slope` and `10 s / slope`, where `s` is the **sample SD of at least 10 included blank readings**. A positive slope is required. These are not validated method limits; an unsuitable calibration also biases these estimates.
- The ±10% error band is an illustrative teaching reference, not a universal acceptance criterion.

Independent verification standards, unknown samples, matrix effects, internal standards, and dilution studies are planned next; they are not implemented yet.

## Validation

```sh
npm test          # numerical/model tests
npm run build     # strict TypeScript + production build
npm run test:e2e  # browser workflow tests
npm run test:streamlit # iframe, CSV, persistence, and acquisition through Streamlit
npm run test:release   # deterministic deployment packaging
.venv/bin/python -m unittest discover -s tests -p 'test_*.py' # release/update runtime
```

Playwright uses system Chromium at `/usr/bin/chromium`. Set `CHROMIUM_PATH` if installed elsewhere. The browser tests start Vite automatically if necessary; they test actual acquisition, stopping, recalculation, exclusions, parameter invalidation, concentration validation, persistence, log plotting, and CSV export.

## Structure

- `streamlit_app.py` — Python hosting entrypoint and nonintrusive update polling.
- `streamlit_runtime.py` — verified release loading, source hashing, and build caching.
- `streamlit_assets/` — committed self-contained deployment bundle; regenerate with `npm run build:streamlit`.
- `src/lib/model.ts` — instrument response, reproducible acquisition, statistics, and calibration fitting.
- `src/data/calibration-profiles.json` — selected-channel measured means, SDs, and source provenance.
- `scripts/import-calibration.py` — reproducible import from the original Qtegra CSV.
- `docs/calibration-data-report.md` — measured channel ranges, response comparisons, and model limitations.
- `src/App.tsx` — instrument workflow, standards, session persistence, and export.
- `src/components/CalibrationCharts.tsx` — interactive SVG calibration and concentration-error plots.
- `src/lib/model.test.ts` — numerical and scientific behavior checks.
- `tests/calibration.spec.ts` — browser workflow checks.

Each cloud task already has an isolated checkout; use the existing repository rather than creating a worktree unless explicitly requested.
