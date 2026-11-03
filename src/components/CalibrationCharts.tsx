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

const BLACK = '#000000';
const GREEN = '#39ff14';
const WHITE = '#ffffff';
const GRID = '#14532d';
const YELLOW = '#ffd43b';
const ORANGE = '#ffb000';
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
  const H = W < 480 ? 290 : 340;
  const LEFT = 96;
  const RIGHT = 30;
  const TOP = 25;
  const BOTTOM = H - 70;
  const PLOT_W = W - LEFT - RIGHT;
  const errorW = errorChart.width;
  const errorLeft = 90;
  const errorRight = 30;
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
    : niceTicks(0, xMax, PLOT_W < 410 ? 3 : 5);
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
  const tooltipWidth = Math.min(310, W - 20);
  const residualPoints = useMemo(() => fit?.points.filter((point) => point.concentration > 0 && point.relativeError !== null && Number.isFinite(point.relativeError)) ?? [], [fit]);
  const residualMax = Math.max(15, ...residualPoints.map((point) => Math.abs(point.relativeError!))) * 1.16;
  const residualY = (value: number) => 103 - (value / residualMax) * 70;
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
        .calibration-charts .chart-card { min-width: 0; background: ${BLACK}; color: ${WHITE}; border: 2px solid ${BLACK}; border-radius: 4px; overflow: hidden; container-type: inline-size; font-family: 'Courier New', Courier, monospace; }
        .calibration-charts .chart-card .card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 21px 24px 15px; background: ${BLACK}; border-bottom: 1px solid ${GRID}; }
        .calibration-charts .chart-card .card-heading h2 { margin: 0; font-family: inherit; font-size: 18px; font-weight: 800; color: ${GREEN}; letter-spacing: .025em; text-transform: uppercase; }
        .calibration-charts .chart-card .chart-subtitle { color: ${WHITE}; font-size: 14px; font-weight: 600; line-height: 1.5; margin: 7px 0 0; }
        .calibration-charts .chart-controls { display: flex; align-items: center; gap: 13px; flex-wrap: wrap; justify-content: flex-end; }
        .calibration-charts .axis-toggle { display: flex; gap: 3px; background: ${BLACK}; padding: 3px; border: 1px solid ${WHITE}; border-radius: 2px; }
        .calibration-charts .axis-toggle button { border: 1px solid ${BLACK}; border-radius: 0; min-height: 36px; padding: 5px 10px; background: ${BLACK}; font: inherit; font-size: 14px; font-weight: 700; color: ${WHITE}; cursor: pointer; }
        .calibration-charts .axis-toggle button:hover { border-color: ${GREEN}; }
        .calibration-charts .axis-toggle button[aria-pressed="true"] { color: ${BLACK}; background: ${GREEN}; border-color: ${GREEN}; box-shadow: none; }
        .calibration-charts .chart-card .model-toggle { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 700; color: ${WHITE}; white-space: nowrap; cursor: pointer; }
        .calibration-charts .model-toggle input { appearance: none; width: 19px; height: 19px; margin: 0; border: 2px solid ${WHITE}; border-radius: 0; background: ${BLACK}; accent-color: ${GREEN}; cursor: pointer; display: inline-grid; place-content: center; }
        .calibration-charts .model-toggle input:checked { background: ${GREEN}; border-color: ${GREEN}; }
        .calibration-charts .model-toggle input:checked::after { content: '✓'; color: ${BLACK}; font: 900 17px/1 monospace; }
        .calibration-charts .axis-toggle button:focus-visible, .calibration-charts .model-toggle input:focus-visible { outline: 3px solid ${YELLOW}; outline-offset: 3px; }
        .calibration-charts .chart-canvas { width: 100%; min-width: 0; overflow: hidden; background: ${BLACK}; }
        .calibration-charts .chart-svg { width: 100%; display: block; overflow: hidden; font-family: inherit; background: ${BLACK}; }
        .calibration-charts .chart-svg text { font-weight: 600; }
        .calibration-charts .chart-card .chart-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 17px; border-top: 1px solid ${GRID}; padding: 13px 24px; font-size: 14px; font-weight: 600; color: ${WHITE}; background: ${BLACK}; }
        .calibration-charts .chart-legend span { display: inline-flex; align-items: center; gap: 7px; }
        .calibration-charts .legend-dot { width: 8px; height: 8px; background: ${GREEN}; border-radius: 50%; display: inline-block; }
        .calibration-charts .legend-line { width: 20px; height: 0; border-top: 2px solid ${GREEN}; display: inline-block; }
        .calibration-charts .chart-card .chart-footnote { margin: 0; padding: 12px 24px 16px; color: ${WHITE}; font-size: 14px; font-weight: 600; line-height: 1.6; background: ${BLACK}; }
        .calibration-charts .chart-point { cursor: pointer; outline: none; }
        .calibration-charts .chart-point:focus-visible circle:last-child { stroke: ${YELLOW}; stroke-width: 3px; }
        .calibration-charts .chart-card .residual-caption { font-size: 14px; font-weight: 700; color: ${GREEN}; white-space: nowrap; }
        @container (max-width: 620px) {
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
            <text x={LEFT - 13} y={yScale(tick) + 4} textAnchor="end" fontSize="14" fill={WHITE}>{compact(tick)}</text>
          </g>)}
          {xTicks.map((tick) => <g key={`x-${tick}`}>
            <line x1={xScale(tick)} x2={xScale(tick)} y1={TOP} y2={BOTTOM} stroke={GRID} strokeDasharray="3 4" />
            <text x={xScale(tick)} y={BOTTOM + 27} textAnchor="middle" fontSize="14" fill={WHITE}>{compact(tick)}</text>
          </g>)}
          <line x1={LEFT} x2={W - RIGHT} y1={BOTTOM} y2={BOTTOM} stroke={WHITE} />
          <line x1={LEFT} x2={LEFT} y1={TOP} y2={BOTTOM} stroke={WHITE} />
          <text x={(LEFT + W - RIGHT) / 2} y={H - 14} textAnchor="middle" fill={WHITE} fontSize="14">Concentration (ppm){logX && W > 450 ? ' · logarithmic axis' : ''}</text>
          <text transform={`translate(20 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" fill={WHITE} fontSize="14">Net intensity (cps)</text>
          <g clipPath={`url(#${id}-clip)`}>
            {showModel && <path d={path((value) => expectedSignal(value, line, mode))} fill="none" stroke={YELLOW} strokeWidth="1.8" strokeDasharray="5 5" />}
            {fit && <path d={path((value) => fit.intercept + fit.slope * value)} fill="none" stroke={GREEN} strokeWidth="2.5" />}
            {visible.map((standard) => <g key={standard.id} role="button" tabIndex={0} className="chart-point" aria-label={`Select ${standard.name}, ${standard.concentration} ppm, ${compact(mean(standard.readings))} cps${standard.included ? '' : ', excluded from fit'}`} onClick={() => onSelect(standard.id)} onKeyDown={(event) => selectByKey(event, standard.id)} onMouseEnter={() => setHoveredId(standard.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(standard.id)} onBlur={() => setHoveredId(null)}>
              <title>{standard.name}: {standard.concentration} ppm; mean {mean(standard.readings).toFixed(2)} cps{standard.included ? '' : ' (excluded)'}</title>
              <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r="13" fill="transparent" />
              {selectedId === standard.id && <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r="10" fill="none" stroke={WHITE} strokeWidth="1.8" />}
              <circle cx={xScale(standard.concentration)} cy={yScale(mean(standard.readings))} r={selectedId === standard.id ? 5 : 4.5} fill={standard.included ? GREEN : BLACK} stroke={standard.included ? BLACK : WHITE} strokeWidth="1.8" />
            </g>)}
          </g>
          {visible.length === 0 && !showModel && <g>
            <rect x={LEFT + 9} y={(TOP + BOTTOM) / 2 - 50} width={PLOT_W - 18} height="100" rx="10" fill={BLACK} stroke={GREEN} strokeDasharray="4 4" />
            <text x={(LEFT + W - RIGHT) / 2} y={(TOP + BOTTOM) / 2 - 12} textAnchor="middle" fill={GREEN} fontSize="14" fontWeight="500" aria-label="Measure standards to build your calibration">
              {PLOT_W < 410 ? <><tspan x={(LEFT + W - RIGHT) / 2}>Measure standards to build</tspan><tspan x={(LEFT + W - RIGHT) / 2} dy="20">your calibration</tspan></> : 'Measure standards to build your calibration'}
            </text>
            <text x={(LEFT + W - RIGHT) / 2} y={(TOP + BOTTOM) / 2 + (PLOT_W < 410 ? 27 : 13)} textAnchor="middle" fill={WHITE} fontSize="14">{PLOT_W < 410 ? 'Your curve will appear here' : 'Acquired signals and the fitted line will appear here'}</text>
          </g>}
          {hovered && <g pointerEvents="none" transform={`translate(${Math.max(10, Math.min(hoverX - 75, W - tooltipWidth - 10))},${Math.max(TOP + 2, hoverY - 74)})`}>
            <rect width={tooltipWidth} height="62" rx="2" fill={BLACK} stroke={GREEN} strokeWidth="2" />
            <text x="11" y="23" fill={WHITE} fontSize="14" fontWeight="600">{hovered.name} <tspan fill={GREEN} fontWeight="600">· {hovered.concentration} ppm</tspan></text>
            <text x="11" y="45" fill={WHITE} fontSize="14">{mean(hovered.readings).toFixed(2)} cps{hovered.included ? '' : ' · excluded'}</text>
          </g>}
        </svg>
        </div>
        <div className="chart-legend">
          <span><i className="legend-dot" />Measured standard</span>
          <span><i className="legend-line" />Linear fit</span>
          {measured.some((standard) => !standard.included) && <span><i className="legend-dot" style={{ background: BLACK, border: `2px solid ${WHITE}` }} />Excluded from fit</span>}
          {showModel && <span><i className="legend-line" style={{ borderColor: YELLOW, borderTopStyle: 'dashed' }} />Synthetic response model</span>}
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
        <svg className="chart-svg" style={{ height: 210, flex: '0 0 auto' }} viewBox={`0 0 ${errorW} 210`} role="img" aria-label="Percentage concentration error for each nonzero standard, with a plus or minus 10 percent reference band">
          <rect x={errorLeft} width={errorPlotW} y={residualY(10)} height={residualY(-10) - residualY(10)} fill="#052e16" />
          {niceTicks(-residualMax, residualMax, 4).map((tick) => <g key={`r-${tick}`}>
            <line x1={errorLeft} x2={errorW - errorRight} y1={residualY(tick)} y2={residualY(tick)} stroke={tick === 0 ? WHITE : GRID} strokeDasharray={tick === 0 ? undefined : '3 4'} />
            <text x={errorLeft - 10} y={residualY(tick) + 3} textAnchor="end" fontSize="14" fill={WHITE}>{compact(tick)}%</text>
          </g>)}
          {[10, -10].map((value) => <line key={`band-${value}`} x1={errorLeft} x2={errorW - errorRight} y1={residualY(value)} y2={residualY(value)} stroke={GREEN} strokeDasharray="4 4" />)}
          {errorXTicks.map((tick) => <text key={`rx-${tick}`} x={errorXScale(tick)} y="193" textAnchor="middle" fontSize="14" fill={WHITE}>{compact(tick)}</text>)}
          {residualPoints.map((point) => <g key={point.id} role="button" tabIndex={0} className="chart-point" aria-label={`Select standard at ${point.concentration} ppm, error ${point.relativeError!.toFixed(1)} percent`} onClick={() => onSelect(point.id)} onKeyDown={(event) => selectByKey(event, point.id)}>
            <title>{point.concentration} ppm: {point.relativeError!.toFixed(2)}% concentration error</title>
            <line x1={errorXScale(point.concentration)} x2={errorXScale(point.concentration)} y1={residualY(0)} y2={residualY(point.relativeError!)} stroke={Math.abs(point.relativeError!) > 10 ? ORANGE : GREEN} strokeWidth="2" />
            <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="11" fill="transparent" />
            {selectedId === point.id && <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="9" fill="none" stroke={WHITE} strokeWidth="1.8" />}
            <circle cx={errorXScale(point.concentration)} cy={residualY(point.relativeError!)} r="4" fill={Math.abs(point.relativeError!) > 10 ? ORANGE : GREEN} stroke={BLACK} strokeWidth="1.5" />
          </g>)}
          {residualPoints.length === 0 && <text x={(errorLeft + errorW - errorRight) / 2} y="91" textAnchor="middle" fill={WHITE} fontSize="14"><tspan x={(errorLeft + errorW - errorRight) / 2}>Errors appear after</tspan><tspan x={(errorLeft + errorW - errorRight) / 2} dy="20">a calibration has been fitted</tspan></text>}
        </svg>
        </div>
        <p className="chart-footnote">Error = (back-calculated − prepared) / prepared × 100. Blank excluded from percentage errors. The ±10% band is a teaching reference, not an acceptance specification.</p>
      </section>
    </div>
  );
}
