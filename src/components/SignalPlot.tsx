import type { SignalNode, SignalSample, ViewMode } from '../domain/signals'
import { evaluateSignal, sampleSignal } from '../domain/signals'

type PlotSignal = {
  id: string
  label: string
  node: SignalNode
  color: string
  preview?: boolean
}

type SignalPlotProps = {
  mode: ViewMode
  signals: PlotSignal[]
  gibbsOverlay?: SignalSample[]  // curva aggiuntiva Gibbs (arancio tratteggiato)
  showGrid?: boolean
}

const W = 1000
const H = 420
const PAD = 48

export function SignalPlot({ mode, signals, gibbsOverlay, showGrid = true }: SignalPlotProps) {
  const rangeStart = mode === 'frequency' ? 0 : -6
  const rangeEnd = 6
  const samples = signals.map((signal) => ({
    ...signal,
    samples: mode === 'discrete'
      ? sampleDiscrete(signal.node, rangeStart, rangeEnd)
      : sampleSignal(signal.node, rangeStart, rangeEnd, 600),
  }))

  const gibbsSamples = gibbsOverlay ?? []

  const allValues = [
    ...samples.flatMap(s => s.samples.map(p => p.y)),
    ...gibbsSamples.map(p => p.y),
  ]
  const rawMin = Math.min(...allValues, -0.5)
  const rawMax = Math.max(...allValues, 0.5)
  const pad = (rawMax - rawMin) * 0.08
  const minValue = rawMin - pad
  const maxValue = rawMax + pad

  const xScale = (x: number) => PAD + ((x - rangeStart) / (rangeEnd - rangeStart)) * (W - PAD * 2)
  const yScale = (y: number) => H - PAD - ((y - minValue) / Math.max(maxValue - minValue, 1e-6)) * (H - PAD * 2)

  // Tick positions
  const xTicks = intTicksInRange(rangeStart, rangeEnd)
  const yTicks = niceTicksInRange(minValue, maxValue, 5)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="signal-plot" role="img" aria-label="Signal visualization">
      <defs>
        <linearGradient id="plotBackground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.96)" />
          <stop offset="100%" stopColor="rgba(243,244,246,0.92)" />
        </linearGradient>
        <clipPath id="plotClip">
          <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={W} height={H} fill="url(#plotBackground)" />

      {/* Grid lines */}
      {showGrid && xTicks.map(x => (
        <line key={`xg-${x}`}
          x1={xScale(x)} y1={PAD} x2={xScale(x)} y2={H - PAD}
          stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
      ))}
      {showGrid && yTicks.map(y => (
        <line key={`yg-${y}`}
          x1={PAD} y1={yScale(y)} x2={W - PAD} y2={yScale(y)}
          stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
      ))}

      {/* Assi */}
      <line x1={PAD} y1={yScale(0)} x2={W - PAD} y2={yScale(0)}
        stroke="rgba(15,23,42,0.22)" strokeWidth="1.5" />
      <line x1={xScale(0)} y1={PAD} x2={xScale(0)} y2={H - PAD}
        stroke="rgba(15,23,42,0.22)" strokeWidth="1.5" />

      {/* Tick labels asse x */}
      {xTicks.map(x => x !== 0 && (
        <text key={`xt-${x}`} x={xScale(x)} y={H - PAD + 14}
          textAnchor="middle" fill="#64748b" fontSize="10">
          {x}
        </text>
      ))}

      {/* Tick labels asse y */}
      {yTicks.map(y => y !== 0 && (
        <text key={`yt-${y}`} x={PAD - 6} y={yScale(y) + 4}
          textAnchor="end" fill="#64748b" fontSize="10">
          {formatYTick(y)}
        </text>
      ))}

      {/* Segnali */}
      {signals.map((signal) => {
        const series = samples.find((item) => item.id === signal.id)?.samples ?? []
        const strokeColor = signal.preview ? '#9ca3af' : signal.color
        const opacity = signal.preview ? 0.45 : 1
        const dashArray = signal.preview ? '6 4' : undefined

        if (mode === 'discrete') {
          return (
            <g key={signal.id}>
              {series.map((sample) => (
                <g key={`${signal.id}-${sample.x}`}>
                  <line
                    x1={xScale(sample.x)} y1={yScale(0)}
                    x2={xScale(sample.x)} y2={yScale(sample.y)}
                    stroke={strokeColor} strokeWidth="2.5" opacity={opacity}
                    strokeDasharray={dashArray} clipPath="url(#plotClip)" />
                  <circle
                    cx={xScale(sample.x)} cy={yScale(sample.y)}
                    r="4" fill={strokeColor} opacity={opacity} />
                </g>
              ))}
            </g>
          )
        }

        const path = buildPath(series, xScale, yScale)
        return (
          <path key={signal.id} d={path} fill="none"
            stroke={strokeColor} strokeWidth="2.5"
            strokeLinejoin="round" strokeLinecap="round"
            opacity={opacity} strokeDasharray={dashArray}
            clipPath="url(#plotClip)" />
        )
      })}

      {/* Overlay Gibbs */}
      {gibbsSamples.length > 1 && (
        <path
          d={buildPath(gibbsSamples, xScale, yScale)}
          fill="none" stroke="rgba(251,146,60,0.85)" strokeWidth="2"
          strokeDasharray="8 4" strokeLinejoin="round" clipPath="url(#plotClip)" />
      )}

      {/* Label variabile */}
      <text x={W - PAD + 4} y={yScale(0) + 4} fill="#64748b" fontSize="11">
        {mode === 'discrete' ? 'n' : 't'}
      </text>
    </svg>
  )
}

function sampleDiscrete(node: SignalNode, start: number, end: number): SignalSample[] {
  const values: SignalSample[] = []
  for (let x = Math.floor(start); x <= Math.ceil(end); x += 1) {
    values.push({ x, y: evaluateSignal(node, x) })
  }
  return values
}

function buildPath(
  samples: SignalSample[],
  xScale: (v: number) => number,
  yScale: (v: number) => number,
): string {
  if (samples.length === 0) return ''
  const points = samples.map(s => `${xScale(s.x).toFixed(1)},${yScale(s.y).toFixed(1)}`)
  return `M ${points.join(' L ')}`
}

function intTicksInRange(start: number, end: number): number[] {
  const ticks: number[] = []
  for (let v = Math.ceil(start); v <= Math.floor(end); v++) ticks.push(v)
  return ticks
}

function niceTicksInRange(min: number, max: number, count: number): number[] {
  const span = max - min
  if (span <= 0) return [0]
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag

  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let t = start; t <= max + step * 0.001; t += step) {
    ticks.push(Math.round(t / step) * step)
  }
  return ticks
}

function formatYTick(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return v.toFixed(2).replace(/\.?0+$/, '')
}
