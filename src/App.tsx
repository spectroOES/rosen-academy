import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, Beaker, ChevronDown, CircleHelp, FlaskConical, Info, ListRestart, LoaderCircle, Play, Plus, RotateCcw, Settings2, Square, Trash2, Waves, X } from 'lucide-react';
import { CalibrationCharts } from './components/CalibrationCharts';
import { METHOD_ELEMENTS as ELEMENTS, METHOD_LINES as LINES, calculateWeights, describeRange, estimatedLimits, fitCalibration, mean, measureStandard, rsd, sd } from './lib/model';
import type { ResponseMode, SpectralLine, Standard, Weighting } from './lib/model';
import methodData from './data/calibration-profiles.json';

const STORAGE_KEY = 'rosen-calibration-v2-measured';
const DEFAULT_LINE = LINES.find(line => line.id === 'cu-324754-axial-ifr')!;
const SOURCE_HASH = methodData.source.sha256;
const SUPPORT_LABELS = { measured: 'Reference level', interpolated: 'Interpolated', extrapolated: 'Extrapolated' };
const WEIGHTING_OPTIONS: { value: Weighting; label: string }[] = [
  { value: 'none', label: 'None' }, { value: '1/x', label: '1/x' }, { value: '1/x2', label: '1/x²' },
  { value: '1/SD2', label: '1/SD²' }, { value: '1/RSD2', label: '1/RSD²' },
];
const WEIGHTING_NOTES: Record<Weighting, string> = {
  none: '',
  '1/x': 'Qtegra legacy: Forcing = Blank. The measured blank mean fixes the intercept; zero concentration has no regression weight. ',
  '1/x2': 'Qtegra legacy: Forcing = Blank. The measured blank mean fixes the intercept; zero concentration has no regression weight. ',
  '1/SD2': 'Qtegra Absolute SD: w = 1 / SD², using the sample SD of replicate intensities (cps). ',
  '1/RSD2': 'Qtegra Relative SD: w = 1 / (SD / |mean|)² = (100 / RSD%)². The table reports RSD in percent. Blank RSD and its weight are unstable near zero. ',
};
const ELEMENT_NAMES: Record<string, string> = { Cu: 'Copper', Cd: 'Cadmium', Pb: 'Lead', Fe: 'Iron', Zn: 'Zinc', Mg: 'Magnesium', Ca: 'Calcium', P: 'Phosphorus', Ti: 'Titanium', Sb: 'Antimony' };
function initialStandards(line: SpectralLine = DEFAULT_LINE): Standard[] {
  return line.profile!.points.map((point, i) => ({ id: `std-${i}`, name: i === 0 ? 'Calibration blank' : `Standard ${i}`, concentration: point.concentration, included: true, readings: [] }));
}
interface SavedState { sourceHash: string; lineId: string; mode: ResponseMode; weighting: Weighting; replicates: number; integration: number; standards: Standard[]; sequence: number }
function loadSession(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Preserve acquired data when restoring sessions from the unsquared prototype.
    if (parsed.weighting === '1/SD') parsed.weighting = '1/SD2';
    if (parsed.weighting === '1/RSD') parsed.weighting = '1/RSD2';
    const s = parsed as SavedState;
    if (!LINES.some(l => l.id === s.lineId) || s.mode !== 'measured' || s.sourceHash !== SOURCE_HASH || !WEIGHTING_OPTIONS.some(option => option.value === s.weighting)) return null;
    if (![3, 5, 10].includes(s.replicates) || s.integration !== 5 || !Number.isInteger(s.sequence) || s.sequence < 0) return null;
    if (!Array.isArray(s.standards) || s.standards.length < 3 || s.standards.length > 20) return null;
    if (new Set(s.standards.map(row => row.id)).size !== s.standards.length || new Set(s.standards.map(row => row.concentration)).size !== s.standards.length) return null;
    if (!s.standards.every(row => typeof row.id === 'string' && typeof row.name === 'string' && typeof row.included === 'boolean' && Number.isFinite(row.concentration) && (row.concentration === 0 || row.concentration >= 0.01 && row.concentration <= 100) && Array.isArray(row.readings) && row.readings.every(Number.isFinite))) return null;
    if (s.standards.filter(row => row.concentration === 0).length !== 1) return null;
    return s;
  } catch { return null; }
}
function fmt(value: number | null | undefined, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e7) return value.toExponential(2);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}
function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export default function App() {
  const [saved] = useState(loadSession);
  const [lineId, setLineId] = useState(saved?.lineId ?? DEFAULT_LINE.id);
  const mode: ResponseMode = 'measured';
  const [weighting, setWeighting] = useState<Weighting>(saved?.weighting ?? 'none');
  const [replicates, setReplicates] = useState(saved?.replicates ?? 3);
  const integration = 5;
  const [standards, setStandards] = useState<Standard[]>(saved?.standards ?? initialStandards());
  const [selectedId, setSelectedId] = useState<string | null>(saved?.standards[0]?.id ?? 'std-0');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState(() => { try { return !saved && localStorage.getItem('rosen-calibration-v1') ? 'The measured-method model starts a new session. Your previous synthetic session remains stored separately in this browser.' : ''; } catch { return ''; } });
  const [helpOpen, setHelpOpen] = useState(false);
  const [concentrationDraft, setConcentrationDraft] = useState<Record<string, string>>({});
  const [storageAvailable, setStorageAvailable] = useState(true);
  const sequence = useRef(saved?.sequence ?? 0);
  const runToken = useRef(0);
  const latestRows = useRef(standards); latestRows.current = standards;
  const isBusy = busyId !== null;
  const line = LINES.find(l => l.id === lineId)!;
  const profile = line.profile!;
  const extrapolated = standards.filter(row => row.concentration > profile.measuredMax).length;
  const weightInfo = useMemo(() => calculateWeights(standards, weighting), [standards, weighting]);
  const weightsById = useMemo(() => new Map(weightInfo.points.map(point => [point.id, point])), [weightInfo]);
  const usesRsdWeighting = weighting === '1/RSD2';
  const legacyConcentrationWeighting = weighting === '1/x' || weighting === '1/x2';
  const fit = useMemo(() => fitCalibration(standards, weighting), [standards, weighting]);
  const limits = useMemo(() => estimatedLimits(standards, fit), [standards, fit]);
  const selected = standards.find(row => row.id === selectedId) ?? standards[0];
  const measured = standards.filter(row => row.readings.length > 0).length;
  const included = standards.filter(row => row.included && row.readings.length > 0).length;
  const blank = standards.find(row => row.concentration === 0)!;
  const needsReview = Boolean(fit && fit.points.some(p => p.relativeError !== null && Math.abs(p.relativeError) > 10));
  const weightingLabel = weighting === 'none' ? 'Unweighted' : WEIGHTING_OPTIONS.find(option => option.value === weighting)!.label;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sourceHash: SOURCE_HASH, lineId, mode, weighting, replicates, integration, standards, sequence: sequence.current }));
      setStorageAvailable(true);
    } catch { setStorageAvailable(false); }
  }, [lineId, mode, weighting, replicates, integration, standards]);
  useEffect(() => () => { runToken.current++; }, []);
  useEffect(() => {
    if (!helpOpen) return;
    const previousFocus = document.querySelector<HTMLElement>('.help-button');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setHelpOpen(false); }
      if (event.key === 'Tab') {
        const nodes = document.querySelectorAll<HTMLElement>('.guide-modal button:not(:disabled), .guide-modal a[href], .guide-modal [tabindex="0"]');
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [helpOpen]);

  function clearReadings(message: string) {
    runToken.current++;
    setBusyId(null); setProgress('');
    setStandards(rows => rows.map(row => ({ ...row, readings: [] })));
    setNotice(message);
  }
  function changeLine(id: string) {
    if (id === lineId) return;
    const next = LINES.find(line => line.id === id)!;
    runToken.current++; setBusyId(null); setProgress('');
    setLineId(id); setStandards(initialStandards(next)); setSelectedId('std-0'); setConcentrationDraft({});
    setNotice('Channel changed. The exported standard concentrations for this mixture have been loaded; acquire new readings.');
  }
  async function acquire(ids: string[], blankCount?: number) {
    if (isBusy) return;
    const token = ++runToken.current;
    setNotice(''); sequence.current++;
    const runSeed = sequence.current * 100003;
    for (let i = 0; i < ids.length; i++) {
      if (token !== runToken.current) return;
      const row = latestRows.current.find(s => s.id === ids[i]);
      if (!row) continue;
      setBusyId(row.id); setSelectedId(row.id);
      const count = blankCount ?? replicates;
      const readings = measureStandard(row.concentration, line, mode, count, integration, runSeed + i * 7919);
      const previous = blankCount ? [...row.readings] : [];
      setStandards(rows => rows.map(s => s.id === row.id ? { ...s, readings: previous } : s));
      for (let j = 0; j < readings.length; j++) {
        setProgress(`${row.name} · replicate ${j + 1} of ${count}`);
        await new Promise(resolve => setTimeout(resolve, 210));
        if (token !== runToken.current) return;
        setStandards(rows => rows.map(s => s.id === row.id ? { ...s, readings: [...previous, ...readings.slice(0, j + 1)] } : s));
      }
    }
    if (token === runToken.current) {
      setBusyId(null); setProgress('');
      setNotice(blankCount ? 'Ten blank readings added. Detection-limit estimates use all included blank readings.' : 'Acquisition complete. Inspect the curve and back-calculated errors before accepting the calibration.');
    }
  }
  function stopAcquisition() {
    runToken.current++; setBusyId(null); setProgress(''); setNotice('Acquisition stopped. Completed readings have been retained.');
  }
  function loadDemo() {
    if (isBusy) return;
    sequence.current++;
    setStandards(rows => rows.map((row, i) => ({ ...row, readings: measureStandard(row.concentration, line, mode, row.concentration === 0 ? 10 : replicates, integration, sequence.current * 100003 + i * 7919) })));
    setSelectedId(blank.id);
    setNotice('Demo acquired: simulated replicates from this channel’s measured mean/SD reference, including 10 blank readings. Try a different weighting or exclude the highest standard.');
  }
  function updateConcentration(id: string) {
    const text = concentrationDraft[id];
    if (text === undefined) return;
    const value = Number(text);
    const duplicate = standards.some(row => row.id !== id && row.concentration === value);
    if (!text.trim() || !Number.isFinite(value) || value < 0.01 || value > 100 || duplicate) {
      setNotice(duplicate ? 'Each standard must have a unique concentration.' : 'Enter a concentration from 0.01 to 100 ppm. The calibration blank stays at 0 ppm.');
    } else {
      setStandards(rows => rows.map(row => row.id === id && row.concentration !== value ? { ...row, concentration: value, readings: [] } : row));
      if (standards.find(s => s.id === id)?.concentration !== value) setNotice('Concentration changed. Re-measure this standard; its previous readings have been cleared.');
    }
    setConcentrationDraft(draft => { const next = { ...draft }; delete next[id]; return next; });
  }
  function addStandard() {
    const available = [0.05, 0.5, 5, 25, 50, 0.02, 0.2, 2, 20, 75].find(c => !standards.some(row => row.concentration === c));
    if (available === undefined) { setNotice('All suggested levels are present. Edit an existing standard to change its concentration.'); return; }
    const id = `std-${Date.now()}`;
    const nextNumber = 1 + Math.max(0, ...standards.map(row => Number(row.name.match(/^Standard (\d+)$/)?.[1] ?? 0)));
    setStandards(rows => [...rows, { id, name: `Standard ${nextNumber}`, concentration: available, included: true, readings: [] }].sort((a, b) => a.concentration - b.concentration));
    setSelectedId(id);
  }
  function resetSession() {
    if (!window.confirm('Clear all measurements and restore the default standards and method?')) return;
    sequence.current = 0; setLineId(DEFAULT_LINE.id); setWeighting('none'); setReplicates(3); setStandards(initialStandards()); setSelectedId('std-0'); setConcentrationDraft({}); setNotice('Session reset. Ready for a new calibration.');
  }
  function download() {
    const rows = [['Element', 'Line (nm)', 'Response basis', 'Weighting', 'Integration (s)', 'Standard', 'Nominal (ppm)', 'Included', 'Replicate', 'Intensity (cps)', 'Mean (cps)', 'SD (cps)', 'RSD (%)', 'Back-calculated (ppm)', 'Error (%)', 'Reference support', 'Regression role', 'Regression weight']];
    standards.forEach(row => row.readings.forEach((reading, i) => {
      const back = fit && fit.slope > 0 ? (mean(row.readings) - fit.intercept) / fit.slope : null;
      const error = back !== null && row.concentration > 0 ? 100 * (back - row.concentration) / row.concentration : null;
      rows.push([line.element, String(line.wavelength), mode, WEIGHTING_OPTIONS.find(option => option.value === weighting)!.label, String(integration), row.name, String(row.concentration), String(row.included), String(i + 1), String(reading), String(mean(row.readings)), row.readings.length > 1 ? String(sd(row.readings)) : '', row.concentration === 0 && !usesRsdWeighting ? '' : String(rsd(row.readings) ?? ''), String(back ?? ''), String(error ?? ''), SUPPORT_LABELS[describeRange(row.concentration, line)], row.included ? weightsById.get(row.id)?.role ?? 'unavailable' : 'excluded', String(weightsById.get(row.id)?.weight ?? '')]);
    }));
    if (fit) {
      rows.push([], ['Fit summary', 'Value'], ['Slope (cps/ppm)', String(fit.slope)], ['Intercept (cps)', String(fit.intercept)], ['Unweighted R squared', String(fit.r2)], ['Residual standard error (cps)', String(fit.residualSE)], ['Relative fit error (%)', String(fit.relativeSE ?? '')], ['Estimated instrumental LOD (ppm)', String(limits?.lod ?? '')], ['Estimated instrumental LOQ (ppm)', String(limits?.loq ?? '')]);
    }
    rows.push([], ['Weighting algorithm profile', legacyConcentrationWeighting ? 'Qtegra legacy concentration weighting' : weighting === 'none' ? 'Ordinary least squares' : weighting === '1/SD2' ? 'Qtegra Absolute SD (inverse variance)' : 'Qtegra Relative SD (inverse squared fractional RSD)']);
    rows.push([], ['Effective forcing', legacyConcentrationWeighting ? 'Blank (Qtegra legacy)' : 'None']);
    if (weightInfo.anchor) rows.push(['Blank anchor intensity (cps)', String(weightInfo.anchor.intensity)]);
    if (fit) rows.push(['Regression observation count', String(fit.observationCount)], ['Fitted parameter count', String(fit.freeParameters)], ['Residual SE degrees of freedom', String(fit.observationCount - fit.freeParameters)], ['Relative concentration SE convention', 'Linear polynomial term count p = 2; zero concentrations omitted']);
    rows.push([], ['Weighting definition', WEIGHTING_NOTES[weighting] || 'All included standard means have weight 1.']);
    rows.push([], ['Data source', 'Measured method calibration; generated replicates are simulated, not original instrument readings.'], ['Reference file', methodData.source.fileName], ['Reference SHA256', SOURCE_HASH], ['Reference exposure (s)', '5'], ['Plasma view', line.view!], ['Wavelength mode', line.acquisitionMode!], ['Standard mixture', profile.mixture], ['Nonzero measured range (ppm)', `${profile.measuredMin}–${profile.measuredMax}`], ['Reference model', 'Piecewise interpolation of recorded means and sample SDs; explicit extrapolation outside source range. No CID saturation flags were supplied.']);
    exportCSV(rows, `rosen-${line.element}-${line.wavelength.toFixed(3)}-calibration.csv`);
  }

  return <div className="app-shell" id="top" data-theme="lexicon">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Rosen Academy home"><span className="brand-mark"><Activity size={25} strokeWidth={2.1}/></span><span>ROSEN<span className="brand-light"> ACADEMY</span><small>ANALYTICAL SCIENCE, IN PRACTICE</small></span></a>
      <div className="topbar-middle"><span className="topbar-divider"/>ICP-OES Simulator<span className="version-tag">LEXICON</span></div>
      <button className="help-button" onClick={() => setHelpOpen(true)}><CircleHelp size={17}/>Lab guide</button>
    </header>
    <nav className="workflow" aria-label="Workflow"><span className="workflow-active"><span className="step-number">01</span> Calibration</span><span className="workflow-future"><span className="step-number">02</span> Verification <span className="soon">COMING NEXT</span></span><span className="workflow-future"><span className="step-number">03</span> Samples</span><span className="training-label"><FlaskConical size={14}/>Measured method · simulated replicates</span></nav>
    <div className="page-title"><div><div className="eyebrow">THE VIRTUAL LABORATORY</div><h1>Calibration workspace<span className="title-dot">.</span></h1><p>Calibrate with a measured response. Explore sensitivity and compression.</p></div><div className={`instrument-status ${isBusy ? 'running' : ''}`}><span className="status-dot"/><span>{isBusy ? 'Acquiring signals' : 'Instrument ready'}<small>{isBusy ? progress : 'Measured method model · 5 s reference'}</small></span></div></div>
    <main className="workspace">
      <aside className="method-panel">
        <div className="panel-title"><Settings2 size={17}/><h2>Method setup</h2><span>01</span></div>
        <div className="method-body">
          <label className="field-label" htmlFor="element">Analyte</label>
          <div className="select-wrap"><select id="element" disabled={isBusy} value={line.element} onChange={e => changeLine(LINES.find(l => l.element === e.target.value)!.id)}>{ELEMENTS.map(element => <option key={element} value={element}>{element} — {ELEMENT_NAMES[element]}</option>)}</select><ChevronDown size={15}/></div>
          <div className="field-heading"><span className="field-label">Analytical line</span><span>nm</span></div>
          <div className="line-options" role="group" aria-label="Analytical line">{LINES.filter(l => l.element === line.element).map(l => <button key={l.id} className={`line-option ${l.id === lineId ? 'selected' : ''}`} disabled={isBusy} aria-pressed={l.id === lineId} aria-label={`${l.element} ${l.wavelength.toFixed(3)} ${l.view} ${l.acquisitionMode}`} onClick={() => changeLine(l.id)}><span className="radio-indicator">{l.id === lineId && <span/>}</span><span className="line-info"><strong>{l.element} {l.wavelength.toFixed(3)}</strong><small>{l.view} · {l.acquisitionMode}</small><small>{l.label}</small></span><span className="sensitivity-bars" aria-hidden="true">{[0, 1, 2, 3].map((_, i) => <i key={i} style={{ height: 5 + i * 4, background: i < Math.max(1, Math.ceil(l.sensitivity / Math.max(...LINES.filter(v => v.element === line.element).map(v => v.sensitivity)) * 4)) ? 'currentColor' : 'transparent', border: '1px solid currentColor' }}/>)}</span></button>)}</div>
          <p className="line-description">{line.description}</p>
          <div className="method-separator"/>
          <div className="reference-method">
            <strong>Measured method · Mixture {profile.mixture}</strong>
            <p>Nonzero reference range: <b>{fmt(profile.measuredMin)}–{fmt(profile.measuredMax)} ppm</b></p>
            <p>Response per ppm at the highest level: <b>{fmt(profile.compressionRatio * 100, 1)}%</b> of the first nonzero standard’s response per ppm.</p>
            <p>{profile.compressionRatio < 0.9 ? 'Observed high-level response compression. This does not establish CID pixel saturation.' : 'No large endpoint compression in this export. This is not a validated linear-range limit.'}</p>
          </div>
          <div className="two-fields"><div><label className="field-label" htmlFor="replicates">Replicates</label><div className="select-wrap"><select id="replicates" value={replicates} disabled={isBusy} onChange={e => setReplicates(Number(e.target.value))}>{[3, 5, 10].map(n => <option key={n} value={n}>{n} readings</option>)}</select><ChevronDown size={13}/></div></div><div><label className="field-label" htmlFor="reference-exposure">Reference exposure</label><input id="reference-exposure" className="reference-exposure" readOnly value="5 s" /></div></div>
          <p className="fine-print">Reference means and SDs are measured; new replicates are simulated. Exposure is fixed to your source method. Playback is accelerated.</p>

        </div>
        <div className="method-footer"><Beaker size={18}/><p><strong>Your measured method</strong>Thermo iCAP PRO Duo · 25 channels. Interpolation follows the export; detector saturation is not inferred from cps alone.</p></div>
      </aside>

      <div className="main-column">
        <section className="acquisition-toolbar"><div className="toolbar-label"><span className="small-kicker">METHOD</span><strong>{line.element} {line.wavelength.toFixed(3)} · {line.view} · {line.acquisitionMode}</strong><span className="subtle-tag">5 s · Mixture {profile.mixture}</span></div><div className="toolbar-actions"><button className="button secondary" disabled={isBusy} onClick={loadDemo}><Waves size={15}/>Load demo</button>{isBusy ? <button className="button stop" onClick={stopAcquisition}><Square size={14}/>Stop acquisition</button> : <button className="button primary" onClick={() => void acquire(standards.filter(row => row.included).map(row => row.id))} disabled={!standards.some(row => row.included)}><Play size={15} fill="currentColor"/>Run calibration</button>}</div></section>

        {extrapolated > 0 && <div className="source-warning" role="note"><Info size={16}/><span>{extrapolated} standard(s) exceed this channel’s measured maximum of {fmt(profile.measuredMax)} ppm. These are extrapolations, not verified responses or saturation limits.</span></div>}
        <CalibrationCharts standards={standards} fit={fit} line={line} mode={mode} selectedId={selectedId} onSelect={setSelectedId} weighting={weighting}/>

        <section className="results-section card">
          <div className="card-heading"><div><span className="section-kicker">ACQUISITION</span><h2>Calibration standards <span className="count-badge">{standards.length}</span></h2></div><div className="inline-actions"><span className="measurement-count">{measured}/{standards.length} measured</span><button className="text-button" onClick={addStandard} disabled={isBusy || standards.length >= 16}><Plus size={15}/>Add standard</button></div></div>
          <div className="table-scroll"><table className="standards-table"><thead><tr><th><span className="sr-only">Include</span></th><th>Solution</th><th>Conc. <span>ppm</span></th><th>Mean <span>cps</span></th><th>RSD <span>%</span></th><th title="Raw coefficient used in weighted least squares">Weight</th><th>Calculated <span>ppm</span></th><th>Error <span>%</span></th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{standards.map(row => {
            const n = row.readings.length;
            const back = fit && n && fit.slope > 0 ? (mean(row.readings) - fit.intercept) / fit.slope : null;
            const error = back !== null && row.concentration > 0 ? 100 * (back - row.concentration) / row.concentration : null;
            const isBlank = row.concentration === 0;
            const weight = weightsById.get(row.id);
            const showRsd = n > 1 && (!isBlank || usesRsdWeighting);
            return <tr key={row.id} className={`${selectedId === row.id ? 'selected-row' : ''} ${!row.included ? 'excluded-row' : ''}`} onClick={() => setSelectedId(row.id)}>
              <td><input type="checkbox" aria-label={`Include ${row.name}`} checked={row.included} disabled={isBusy} onChange={() => setStandards(rows => rows.map(s => s.id === row.id ? { ...s, included: !s.included } : s))}/></td>
              <td><button className="solution-button" aria-label={row.name} onClick={() => setSelectedId(row.id)}>{busyId === row.id ? <LoaderCircle className="spin" size={14}/> : n ? <span className="measured-dot"/> : <span className="pending-dot"/>}{row.name}</button><span className={`support-label ${describeRange(row.concentration, line)}`}>{SUPPORT_LABELS[describeRange(row.concentration, line)]}</span></td>
              <td>{isBlank ? <span className="blank-concentration">0 <span className="blank-tag">BLK</span></span> : <input className="concentration-input" aria-label={`${row.name} concentration`} type="number" min="0.01" max="100" step="any" disabled={isBusy} value={concentrationDraft[row.id] ?? row.concentration} onChange={e => setConcentrationDraft(d => ({ ...d, [row.id]: e.target.value }))} onBlur={() => updateConcentration(row.id)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>}</td>
              <td className="number">{n ? fmt(mean(row.readings), 1) : <span className="empty-value">—</span>}</td>
              <td className="number">{showRsd ? <span title={isBlank ? 'Calculated blank RSD is used by 1/RSD² weighting, but is unstable near a zero mean.' : 'Sample SD divided by the absolute mean intensity, multiplied by 100.'}>{fmt(rsd(row.readings), 2)}{isBlank ? '†' : ''}</span> : <span className="empty-value" title={isBlank ? 'RSD is not informative near zero. Inspect blank SD instead.' : 'At least two readings are required.'}>{isBlank && n ? 'n/a' : '—'}</span>}</td>
              <td className="number regression-weight" title={weight?.role === 'anchor' ? `No numeric weight. This blank fixes the intercept at ${fmt(weightInfo.anchor?.intensity, 4)} cps.` : weight ? `Sample SD: ${fmt(weight.sd, 4)} cps; RSD: ${fmt(weight.rsd, 4)}%. ${WEIGHTING_NOTES[weighting]}` : row.included ? 'Measure this standard to calculate its weight.' : 'Excluded from the regression.'}>{weight?.role === 'anchor' ? <span className="blank-tag">ANCHOR</span> : fmt(weight?.weight, 5)}</td>
              <td className="number">{fmt(back, 4)}</td>
              <td className="number">{error !== null ? <span className={`error-badge ${Math.abs(error) > 10 ? 'warning' : 'good'}`}>{error > 0 ? '+' : ''}{fmt(error, 1)}%</span> : <span className="empty-value">—</span>}</td>
              <td><div className="row-actions"><button className="icon-button" aria-label={`Measure ${row.name}`} title={`Measure ${row.name}`} disabled={isBusy} onClick={() => void acquire([row.id])}><Play size={13}/></button>{!isBlank && <button className="icon-button delete-button" aria-label={`Remove ${row.name}`} title={`Remove ${row.name}`} disabled={isBusy || standards.length <= 3} onClick={e => { e.stopPropagation(); setStandards(rows => rows.filter(s => s.id !== row.id)); if (selectedId === row.id) setSelectedId(blank.id); }}><Trash2 size={13}/></button>}</div></td>
            </tr>;
          })}</tbody></table></div>
          <div className="table-footer"><span><Info size={13}/>{legacyConcentrationWeighting ? 'The checked blank anchors the intercept; only nonzero standards receive weights.' : 'Uncheck a standard to exclude it from the fit. Measurements are retained.'}</span><button className="text-button" disabled={isBusy || measured === 0} onClick={() => clearReadings('Measurements cleared. Standard concentrations and exclusions have been retained.')}><ListRestart size={14}/>Clear readings</button></div>
        </section>

        <section className="bottom-grid">
          <div className="card fit-card"><div className="card-heading"><div><span className="section-kicker">REGRESSION</span><h2>Fit & detection limits</h2></div><span className={`fit-status ${fit ? needsReview ? 'review' : 'available' : ''}`}>{fit ? needsReview ? 'Review errors' : 'Fit available' : weightInfo.error ? 'Weighting needs data' : 'Awaiting data'}</span></div>
            <div className="fit-options"><label htmlFor="weighting">Weighting</label><div className="segmented" role="group" aria-label="Regression weighting">{WEIGHTING_OPTIONS.map(({ value, label }) => <button key={value} className={weighting === value ? 'active' : ''} aria-pressed={weighting === value} onClick={() => setWeighting(value)}>{label}</button>)}</div><span className="intercept-label" title={legacyConcentrationWeighting ? 'Automatically fixed to the measured blank mean, following the legacy Qtegra concentration-weighting workflow.' : 'Slope and intercept are fitted freely.'}>{legacyConcentrationWeighting ? 'Forcing: Blank (legacy)' : 'Free intercept'}</span></div>
            {weightInfo.error && <div className="weighting-error" role="alert"><Info size={16}/><span>{weightInfo.error}</span></div>}
            <div className="formula-explainer" aria-label="Calibration equation and variable definitions"><strong>I = b + m × C</strong><dl><div><dt>I</dt><dd>Mean intensity (cps)</dd></div><div><dt>C</dt><dd>Standard concentration (ppm)</dd></div><div><dt>m</dt><dd>Slope / sensitivity (cps per ppm)</dd></div><div><dt>b</dt><dd>Intercept (cps); fixed to the blank mean in legacy concentration weighting</dd></div></dl><p>Calculated concentration: <b>C = (I − b) / m</b>. The fitted line approximates the channel response; weighting cannot remove physical response compression.</p></div>
            <div className="equation"><span>Fitted I = </span>{fit ? <><strong>{fmt(fit.slope, 2)}</strong><span> × concentration </span><strong>{fit.intercept >= 0 ? '+' : '−'} {fmt(Math.abs(fit.intercept), 2)}</strong></> : <span className="empty-value">measure at least 3 included levels</span>}</div>
            <div className="fit-metrics"><div><span>R² <small>unweighted</small></span><strong>{fit ? fmt(fit.r2, 6) : '—'}</strong></div><div><span>Residual SE <small>cps</small></span><strong>{fmt(fit?.residualSE, 2)}</strong></div><div><span>Est. LOD <small>ppm</small></span><strong>{fmt(limits?.lod, 5)}</strong></div><div><span>Est. LOQ <small>ppm</small></span><strong>{fmt(limits?.loq, 5)}</strong></div></div>
            <div className="fit-footnote">{fit && <span className="relative-fit-error">Relative concentration SE: <strong>{fmt(fit.relativeSE, 2)}%</strong> <span title="Square root of the sum of squared relative concentration errors divided by k − 2, where k is the number of included nonzero standards.">ⓘ</span></span>}{fit ? `${legacyConcentrationWeighting ? `${fit.observationCount} weighted levels + blank anchor` : `${included} included levels`} · ${weightingLabel} fit. ` : legacyConcentrationWeighting ? 'Fit requires an included measured blank and at least two distinct measured nonzero levels. ' : 'Fit requires at least three distinct measured, included levels. '}{WEIGHTING_NOTES[weighting]}{limits ? `Instrumental estimates: 3s / slope and 10s / slope; n = ${limits.count} blank readings. Not a validated method LOQ.` : 'LOD / LOQ require at least 10 included blank readings and a positive calibration slope.'}</div>
            {!limits && <button className="blank-action" disabled={isBusy || !blank.included} onClick={() => void acquire([blank.id], 10)}><Plus size={14}/>Acquire 10 blank readings<span>{blank.readings.length}/10 available</span></button>}
          </div>
          <div className="card replicate-card"><div className="card-heading"><div><span className="section-kicker">SELECTED SOLUTION</span><h2>{selected.name}</h2></div><span className="subtle-tag">{fmt(selected.concentration)} ppm</span></div>
            <div className="replicate-bars" aria-label="Replicate intensities">{selected.readings.length ? selected.readings.map((reading, i) => { const max = Math.max(...selected.readings.map(Math.abs), 1); return <div className="replicate-bar-row" key={i}><span>R{i + 1}</span><div className="replicate-track"><i style={{ width: `${Math.max(1, Math.abs(reading) / max * 100)}%` }} className={reading < 0 ? 'negative' : ''}/></div><strong>{fmt(reading, 1)}</strong></div>; }) : <div className="replicate-empty"><Waves size={27}/><span>No readings yet</span><small>Select a solution and start acquisition.</small></div>}</div>
            <div className="replicate-summary"><div><span>Mean <small>cps</small></span><strong>{selected.readings.length ? fmt(mean(selected.readings), 1) : '—'}</strong></div><div><span>SD <small>cps</small></span><strong>{selected.readings.length > 1 ? fmt(sd(selected.readings), 2) : '—'}</strong></div><div><span>RSD <small>%</small></span><strong>{selected.concentration === 0 && !usesRsdWeighting ? 'n/a' : selected.readings.length > 1 ? fmt(rsd(selected.readings), 2) + (selected.concentration === 0 ? '†' : '') : '—'}</strong></div></div>
            {selected.concentration === 0 && <p className="blank-rsd-note">{usesRsdWeighting ? '† Calculated blank RSD is used for 1/RSD² weighting. It is unstable near a zero mean; use blank SD to assess variability.' : 'Near zero, RSD is not informative. Use blank SD to assess variability.'}</p>}
            <button className="button secondary selected-measure" disabled={isBusy} onClick={() => void acquire([selected.id])}><Play size={13}/>Measure selected<ArrowRight size={14}/></button>
          </div>
        </section>
        {notice && <div className="notice" role="status"><Info size={16}/><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14}/></button></div>}
      </div>
    </main>
    <footer className="page-footer"><span><span className="status-dot"/>{storageAvailable ? 'Session saved on this browser' : 'Browser storage unavailable · export results to save them'}</span><span>1 ppm = 1 mg/L in this aqueous simulation</span><div><button className="text-button" disabled={isBusy} onClick={resetSession}><RotateCcw size={13}/>Reset session</button><button className="text-button" disabled={isBusy || !measured} onClick={download}><ArrowDownToLine size={14}/>Export CSV</button></div></footer>
    {helpOpen && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false); }}><section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title"><button className="modal-close icon-button" aria-label="Close lab guide" autoFocus onClick={() => setHelpOpen(false)}><X size={20}/></button><span className="eyebrow">YOUR FIRST EXPERIMENT</span><h2 id="guide-title">One element. Different stories.</h2><p>This teaching model uses the uploaded 28–29 Oct calibration from a Thermo iCAP PRO Duo, at 5 s exposure. Every channel retains its Axial/Radial view and iFR/eUV mode. Recorded means and sample SDs define a reference curve; new replicate readings are simulated, not the original instrument replicates.</p><ol><li><strong>Start with a measured channel.</strong> Choose an element and line; its source standard levels load automatically. Run the calibration. Inspect replicate variation and back-calculated concentrations.</li><li><strong>Compare weightings.</strong> Switch between None, 1/x, 1/x², 1/SD² and 1/RSD². The same measurements are refitted. For 1/x and 1/x², the legacy Qtegra workflow automatically sets Forcing = Blank: the intercept equals the measured blank mean, and only nonzero standards receive weights. Keep the blank included and measured; its Weight cell reads ANCHOR. There is no substituted concentration and no numeric blank weight. For 1/SD², w = 1/s², with s the sample SD of replicate intensities. For 1/RSD², w = 1/(s/|mean|)² = (100/RSD%)²; the relative SD is fractional in the weighting formula while the table displays percent. Precision weights require at least two readings and a positive SD for every included measured standard; 1/RSD² also requires a nonzero mean. Blank RSD is unstable near zero. The Weight column shows the actual coefficients. These squared coefficients follow Qtegra Absolute SD and Relative SD. Red bars on measured points show mean ± one replicate SD, not standard error or a confidence interval.</li><li><strong>Explore natural response compression.</strong> Compare Mg 280.270 Axial with Mg 279.079 Radial over 25–100 ppm. Their recorded responses have different curvature without selecting a saturation outcome. Numeric compression is not proof of detector pixel saturation.</li><li><strong>Find a usable range.</strong> Exclude high standards or try a less sensitive line. Changing the channel loads its measured concentration levels and clears incompatible readings. Added levels are labelled interpolated or extrapolated. No response above the measured maximum is experimentally verified.</li><li><strong>Estimate detection limits.</strong> Acquire 10 blank readings. LOD = 3s / slope and LOQ = 10s / slope, where s is the sample SD of included blank readings. A biased fit also biases these estimates.</li></ol><div className="guide-note"><Info size={17}/><span>The ±10% error guides are illustrative teaching thresholds. Residual SE is √[Σ(signal residual²) / (n − fitted parameter count)] in cps. Relative concentration SE retains the older documented linear-polynomial term convention p = 2, excluding zero concentrations. Residual SE uses the number of freely fitted parameters: one with a fixed blank intercept and two for a free intercept. R², blank precision, and visual peak quality alone cannot validate a method. Verification standards and sample matrices will follow in a later version.</span></div><button className="button primary" onClick={() => setHelpOpen(false)}>Back to the laboratory<ArrowRight size={15}/></button></section></div>}
  </div>;
}
