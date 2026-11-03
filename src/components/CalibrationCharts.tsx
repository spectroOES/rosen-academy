import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { expectedSignal, mean } from '../lib/model';
import type { FitResult, ResponseMode, SpectralLine, Standard } from '../lib/model';

type Props = {
  standards: Standard[];
  fit: FitResult | null;
  line: SpectralLine;
  mode: ResponseMode;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const INK = '#17323d';
const TEAL = '#087f8c';
const MUTED = '#82919a';
const GRID = '#edf1f2';
const AMBER = '#ba7835';
function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(200, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${Number((value / 1e6).toPrecision(3))}M`;
  if (abs >= 1e3) return `${Number((value / 1e3).toPrecision(3))}k`;
  if (abs > 0 && abs < 0.001) return value.toExponential(1);
  return String(Number(value.toPrecision(3)));
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const raw = Math.max((max - min) / count, 1e-12);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-8 && ticks.length < 20; value += step) {
    ticks.push(Math.abs(value) < step * 1e-8 ? 0 : value);
  }
  return ticks;
}

export function CalibrationCharts({ standards, fit, line, mode, selectedId, onSelect }: Props) {
  const [logX, setLogX] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const mainChart = useChartWidth();
  const errorChart = useChartWidth();
  const W = mainChart.width;
  const H = W < 480 ? 260 : 310;
  const LEFT = W < 480 ? 65 : 77;
  const RIGHT = 26;
  const TOP = 25;
  const BOTTOM = H - 60;
  const PLOT_W = W - LEFT - RIGHT;
  const errorW = errorChart.width;
  const errorLeft = errorW < 480 ? 66 : 77;
  const errorRight = 26;
  const errorPlotW = errorW - errorLeft - errorRight;
  const id = useId().replace(/:/g, '');
  const measured = standards.filter((standard) => standard.readings.length > 0);
  const visible = measured.filter((standard) => !logX || standard.concentration > 0);
  const positive = standards.map((standard) => standard.concentration).filter((value) => value > 0);
  const xMax = Math.max(...positive, 0.01);
  const xMin = logX ? Math.min(...positive, xMax / 10) : 0;
  const xRange = logX ? Math.log10(xMax) - Math.log10(xMin) : xMax;
  const xScale = (value: number) => LEFT + (logX ? (Math.log10(value) - Math.log10(xMin)) / xRange : value / xRange) * PLOT_W;
  const errorXScale = (value: number) => errorLeft + (logX ? (Math.log10(value) - Math.log10(xMin)) / xRange : value / xRange) * errorPlotW;
  const xTicks = logX
    ? Array.from({ length: Math.ceil(Math.log10(xMax)) - Math.floor(Math.log10(xMin)) + 1 }, (_, i) => 10 ** (Math.floor(Math.log10(xMin)) + i)).filter((value) => value >= xMin && value <= xMax)
    : niceTicks(0, xMax, PLOT_W < 360 ? 3 : 5);
  const errorXTicks = logX ? xTicks : niceTicks(0, xMax, errorPlotW < 360 ? 3 : 5);
  const sampleXs = Array.from({ length: 181 }, (_, i) => logX ? 10 ** (Math.log10(xMin) + (i / 180) * xRange) : (i / 180) * xMax);
  const ys = visible.map((standard) => mean(standard.readings));
  if (fit) ys.push(...sampleXs.map((value) => fit.intercept + fit.slope * value));
  if (showModel) ys.push(...sampleXs.map((value) => expectedSignal(value, line, mode)));
  const minSignal = Math.min(0, ...ys);
  const maxSignal = Math.max(1, ...ys);
  const padding = (maxSignal - minSignal) * 0.1;
  const yMin = minSignal < 0 ? minSignal - padding : 0;
  const yMax = maxSignal + padding;
  const yScale = (value: number) => BOTTOM - ((value - yMin) / (yMax - yMin)) * (BOTTOM - TOP);
  const path = (fn: (value: number) => number) => sampleXs.map((value, i) => `${i ? 'L' : 'M'}${xScale(value).toFixed(2)},${yScale(fn(value)).toFixed(2)}`).join(' ');
  const hovered = visible.find((standard) => standard.id === hoveredId);
  const hoverX = hovered ? xScale(hovered.concentration) : 0;
  const hoverY = hovered ? yScale(mean(hovered.readings)) : 0;
  const residualPoints = useMemo(() => fit?.points.filter((point) => point.concentration > 0 && point.relativeError !== null && Number.isFinite(point.relativeError)) ?? [], [fit]);
  const residualMax = Math.max(15, ...residualPoints.map((point) => Math.abs(point.relativeError!))) * 1.16;
  const residualY = (value: number) => 91 - (value / residualMax) * 62;
  const selectByKey = (event: KeyboardEvent<SVGGElement>, standardId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(standardId);
    }
  };

  return (
    <div className="calibration-charts">
      <style>{`
        .calibration-charts { display: grid; gap: 16px; min-width: 0; }
        .calibration-charts .chart-card { min-width: 0; background: #fff; border: 1px solid var(--border, #e4e9eb); border-radius: 14px; overflow: hidden; container-type: inline-size; }
        .calibration-charts .card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 21px 24px 12px; }
        .calibration-charts h2 { margin: 0; font-size: 15px; font-weight: 650; color: ${INK}; }
        .calibration-charts .chart-subtitle { color: #82919a; font-size: 11px; line-height: 1.5; margin: 5px 0 0; }
        .calibration-charts .chart-controls { display: flex; align-items: center; gap: 13px; flex-wrap: wrap; justify-content: flex-end; }
        .calibration-charts .axis-toggle { display: flex; background: #f3f6f6; padding: 3px; border-radius: 7px; }
        .calibration-charts .axis-toggle button { border: 0; border-radius: 5px; padding: 5px 10px; background: transparent; font: inherit; font-size: 11px; color: #7a8b92; cursor: pointer; }
        .calibration-charts .axis-toggle button[aria-pressed="true"] { color: ${INK}; background: #fff; box-shadow: 0 1px 4px #17323d12; }
        .calibration-charts .model-toggle { display: flex; align-items: center; gap: 5px; font-size: 11px; color: #657a83; white-space: nowrap; cursor: pointer; }
        .calibration-charts .model-toggle input { accent-color: ${TEAL}; }
        .calibration-charts .chart-canvas { width: 100%; min-width: 0; overflow: hidden; }
        .calibration-charts .chart-svg { width: 100%; display: block; overflow: hidden; font-family: inherit; }
        .calibration-charts .chart-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 17px; border-top: 1px solid #f0f3f4; padding: 12px 24px; font-size: 10px; color: #7b8b93; }
        .calibration-charts .chart-legend span { display: inline-flex; align-items: center; gap: 7px; }
        .calibration-charts .legend-dot { width: 7px; height: 7px; background: ${TEAL}; border-radius: 50%; display: inline-block; }
        .calibration-charts .legend-line { width: 19px; height: 0; border-top: 2px solid ${TEAL}; display: inline-block; }
        .calibration-charts .chart-footnote { margin: 0; padding: 0 24px 13px; color: #8a969c; font-size: 10px; line-height: 1.55; }
        .calibration-charts .chart-point { cursor: pointer; outline: none; }
        .calibration-charts .chart-point:focus-visible circle:last-child { stroke: ${INK}; stroke-width: 3px; }
        .calibration-charts .residual-caption { font-size: 10px; color: #87969d; white-space: nowrap; }
        @container (max-width: 510px) {
          .calibration-charts .card-heading { flex-wrap: wrap; gap: 10px; }
          .calibration-charts .chart-controls { justify-content: flex-start; }
        }
        @media(max-width: 680px) {
          .calibration-charts .card-heading { padding: 17px 16px 8px; flex-wrap: wrap; }
          .calibration-charts .chart-controls { justify-content: flex-start; }
          .calibration-charts .chart-legend { gap: 11px; padding: 11px 16px; }
          .calibration-charts .chart-footnote { padding-left: 16px; padding-right: 16px; }
        }
      `}</style>
      <section className="chart-card" aria-label="Calibration curve">
        <div className="card-heading">
          <div>
            <h2>Calibration curve</h2>
            <p className="chart-subtitle">{line.element} {line.wavelength.toFixed(3)} nm <span aria-hidden="true">·</span> Net intensity vs. concentration</p>
          </div>
          <div className="chart-controls">
            <label className="model-toggle"><input type="checkbox" checked={showModel} onChange={(event) => setShowModel(event.target.checked)} />Show model</label>
            <div className="axis-toggle" aria-label="Concentration axis scale">
              <button type="button" aria-pressed={!logX} onClick={() => setLogX(false)}>Linear</button>
              <button type="button" aria-pressed={logX} onClick={() => setLogX(true)}>Log x</button>
            </div>
          </div>
        </div>
        <div className="chart-canvas" ref={mainChart.ref}>
        <svg className="chart-svg" style={{ height: H, flex: '0 0 auto' }} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Calibration graph showing ${visible.length} measured standards with a ${logX ? 'logarithmic' : 'linear'} concentration axis`}>
          <defs><clipPath id={`${id}-clip`}><rect x={LEFT - 7} y={TOP - 7} width={PLOT_W + 14} height={BOTTOM - TOP + 14} /></clipPath></defs>
          {niceTicks(yMin, yMax).map((tick) => <g key={`y-${tick}`}>
            <line x1={LEFT} x2={W - RIGHT} y1={yScale(tick)} y2={yScale(tick)} stroke={GRID} strokeDasharray="3 4" />
            <text x={LEFT - 13} y={yScale(tick) + 4} textAnchor="end" fontSize="11" fill={MUTED}>{compact(tick)}</text>
          </g>)}
          {xTicks.map((tick) => <g key={`x-${tick}`}>
            <line x1={xScale(tick)} x2={xScale(tick)} y1={TOP} y2={BOTTOM} stroke={GRID} strokeDasharray="3 4" />
            <text x={xScale(tick)} y={BOTTOM + 23} textAnchor="middle" fontSize="11" fill={MUTED}>{compact(tick)}</text>
          </g>)}
          <line x1={LEFT} x2={W - RIGHT} y1={BOTTOM} y2={BOTTOM} stroke="#d9e2e5" />
          <line x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} stroke="#d9e2e5" />
          <text x={(LEFT + W - RIGHT) / 2} y={H - 12} textAnchor="middle" fill={MUTED} fontSize="11">Concentration (ppm){logX && W > 450 ? ' · logarithmic axis' : ''}</text>
          <text transform={`translate(20 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" fill={MUTED} fontSize="11">Net intensity (cps)</text>
          <g clipPath={`url(#${id}-clip)`}>
            {showModel && <path d={path((value) => expectedSignal(value, line, mode))} fill="none" stroke={AMBER} strokeWidth="1.8" strokeDasharray="5 5" />}
            {fit && <path d={path((value) => fit.intercept + fit.slope * value)} fill="none" stroke={TEAL} strokeWidth="2" opacity="0.7" />}
            {visible.map((standard) => <g key={standard.id} role="button" tabIndex={0} className="chart-point" aria-label={`Select ${standard.name}, ${standard.concentration} ppm, ${compact(mean(standard.readings))} cps${standard.included ? '' : ', excluded from fit'}`} onClick={() => onSelect(standard.id)} onKeyDown={(event) => selectByKey(event, standard.id)} onMouseEnter={() => setHoveredId(standard.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(standard.id)} onBlur={() => setHoveredId(null)}>
              <title>{standard.name}: {standard.concentration} ppm; mean {mean(standard.readings).toFixed(2)} cps{standard.included ? '' : ' (excluded)'}</title>
              <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r="13" fill="transparent" />
              {selectedId === standard.id && <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r="10" fill={TEAL} opacity="0.13" />}
              <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r={selectedId === standard.id ? 5 : 4.5} fill={standard.included ? TEAL : '#fff'} stroke={standard.included ? '#fff' : MUTED} strokeWidth="1.8" />
            </g>)}
          </g>
          {visible.length === 0 && !showModel && <g>
            <rect x={LEFT + 9} y={(TOP + BOTTOM) / 2 - 43} width={PLOT_W - 18} height="86" rx="10" fill="#fbfcfc" stroke="#e4e9eb" strokeDasharray="4 4" />
            <text x={(LEFT + W - RIGHT) / 2} y={(TOP + BOTTOM) / 2 - 12} textAnchor="middle" fill="#70858d" fontSize="12" fontWeight="500" aria-label="Measure standards to build your calibration">
              {PLOT_W < 360 ? <><tspan x={(LEFT + W - RIGHT) / 2}>Measure standards to build</tspan><tspan x={(LEFT + W - RIGHT) / 2} dy="17">your calibration</tspan></> : 'Measure standards to build your calibration'}
            </text>
            <text x={(LEFT + W - RIGHT) / 2} y={(TOP + BOTTOM) / 2 + (PLOT_W < 360 ? 27 : 13)} textAnchor="middle" fill="#9aa7ad" fontSize="10">{PLOT_W < 360 ? 'Your curve will appear here' : 'Acquired signals and the fitted line will appear here'}</text>
          </g>}
          {hovered && <g pointerEvents="none" transform={`translate(${Math.max(LEFT + 5, Math.min(hoverX - 75, W - RIGHT - 185))},${Math.max(TOP + 2, hoverY - 66)})`}>
            <rect width="183" height="51" rx="7" fill={INK} opacity="0.96" />
            <text x="11" y="19" fill="#fff" fontSize="11" fontWeight="600">{hovered.name} <tspan fill="#a9c5cd" fontWeight="400">· {hovered.concentration} ppm</tspan></text>
            <text x="11" y="37" fill="#c5dadd" fontSize="10">{mean(hovered.readings).toFixed(2)} cps{hovered.included ? '' : ' · excluded'}</text>
          </g>}
        </svg>
        </div>
        <div className="chart-legend">
          <span><i className="legend-dot" />Measured standard</span>
          <span><i className="legend-line" />Linear fit</span>
          {measured.some((standard) => !standard.included) && <span><i className="legend-dot" style={{ background: '#fff', border: `1px solid ${MUTED}` }} />Excluded from fit</span>}
          {showModel && <span><i className="legend-line" style={{ borderColor: AMBER, borderTopStyle: 'dashed' }} />Synthetic response model</span>}
        </div>
        {logX && <p className="chart-footnote">The zero-concentration blank is hidden on the log axis. Its inclusion in the regression is unchanged.</p>}
      </section>

      <section className="chart-card" aria-label="Back-calculated concentration errors">
        <div className="card-heading">
          <div>
            <h2>Calibration errors</h2>
            <p className="chart-subtitle">Back-calculated concentration error for included standards</p>
          </div>
          <span className="residual-caption">Reference band ±10%</span>
        </div>
        <div className="chart-canvas" ref={errorChart.ref}>
        <svg className="chart-svg" style={{ height: 184, flex: '0 0 auto' }} viewBox={`0 0 ${errorW} 184`} role="img" aria-label="Percentage concentration error for each nonzero standard, with a plus or minus 10 percent reference band">
          <rect x={errorLeft} width={errorPlotW} y={residualY(10)} height={residualY(-10) - residualY(10)} fill="#eef8f5" />
          {niceTicks(-residualMax, residualMax, 4).map((tick) => <g key={`r-${tick}`}>
            <line x1={errorLeft} x2={errorW - errorRight} y1={residualY(tick)} y2={residualY(tick)} stroke={tick === 0 ? '#b8c9cf' : GRID} strokeDasharray={tick === 0 ? undefined : '3 4'} />
            <text x={errorLeft - 10} y={residualY(tick) + 3} textAnchor="end" fontSize="10" fill={MUTED}>{compact(tick)}%</text>
          </g>)}
          {[10, -10].map((value) => <line key={`band-${value}`} x1={errorLeft} x2={errorW - errorRight} y1={residualY(value)} y2={residualY(value)} stroke="#a8ccbf" strokeDasharray="4 4" />)}
          {errorXTicks.map((tick) => <text key={`rx-${tick}`} x={errorXScale(tick)} y="170" textAnchor="middle" fontSize="10" fill={MUTED}>{compact(tick)}</text>)}
          {residualPoints.map((point) => <g key={point.id} role="button" tabIndex={0} className="chart-point" aria-label={`Select standard at ${point.concentration} ppm, error ${point.relativeError!.toFixed(1)} percent`} onClick={() => onSelect(point.id)} onKeyDown={(event) => selectByKey(event, point.id)}>
            <title>{point.concentration} ppm: {point.relativeError!.toFixed(2)}% concentration error</title>
            <line x1={errorXScale(point.concentration)} x2={errorXScale(point.concentration)} y1={residualY(0)} y2={residualY(point.relativeError!)} stroke={Math.abs(point.relativeError!) > 10 ? '#d9b996' : '#b3d6d8'} strokeWidth="2" />
            <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="11" fill="transparent" />
            {selectedId === point.id && <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="9" fill={TEAL} opacity="0.12" />}
            <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="4" fill={Math.abs(point.relativeError!) > 10 ? AMBER : TEAL} stroke="#fff" strokeWidth="1.5" />
          </g>)}
          {residualPoints.length === 0 && <text x={(errorLeft + errorW - errorRight) / 2} y="80" textAnchor="middle" fill="#8c9ba2" fontSize="11"><tspan x={(errorLeft + errorW - errorRight) / 2}>Errors appear after</tspan><tspan x={(errorLeft + errorW - errorRight) / 2} dy="17">a calibration has been fitted</tspan></text>}
        </svg>
        </div>
        <p className="chart-footnote">Error = (back-calculated − prepared) / prepared × 100. Blank excluded from percentage errors. The ±10% band is a teaching reference, not an acceptance specification.</p>
      </section>
    </div>
  );
}
