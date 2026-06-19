import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SignalNode, SignalSample, SignalStats, ViewMode } from '../domain/signals'
import { evaluateSignal, extractImpulseMarkers, sampleSignal } from '../domain/signals'

type PlotSignal = {
  id: string
  label: string
  node: SignalNode
  color: string
  preview?: boolean
  stats?: SignalStats
}

export type DFTWindowMarker = {
  signalId: string
  N: number
  startN: number
  node: SignalNode
  color: string
}

type TooltipState = {
  svgX: number
  dataX: number
}

type SignalPlotProps = {
  mode: ViewMode
  signals: PlotSignal[]
  gibbsOverlay?: SignalSample[]
  showGrid?: boolean
  showTooltip?: boolean
  showLegend?: boolean
  yRange?: { min: number; max: number }
  dftWindows?: DFTWindowMarker[]
}

const W = 1000
const H = 420
const PAD = 48
const DEFAULT_RANGE: [number, number] = [-6, 6]

export function SignalPlot({
  mode,
  signals,
  gibbsOverlay,
  showGrid = true,
  showTooltip = true,
  showLegend = true,
  yRange,
  dftWindows,
}: SignalPlotProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [xRange, setXRange] = useState<[number, number]>(DEFAULT_RANGE)
  const [isDragging, setIsDragging] = useState(false)

  const xRangeRef = useRef(xRange)
  xRangeRef.current = xRange
  const isDraggingRef = useRef(isDragging)
  isDraggingRef.current = isDragging
  const dragRef = useRef<{ startX: number; startRange: [number, number] } | null>(null)

  // ── Non-passive wheel on wrapper div ──────────────────────────────────────
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = wrap!.getBoundingClientRect()
      const svgX = (e.clientX - rect.left) * (W / rect.width)
      const svgY = (e.clientY - rect.top) * (H / rect.height)
      if (svgX < PAD || svgX > W - PAD || svgY < PAD || svgY > H - PAD) return
      const [s, en] = xRangeRef.current
      const pivot = s + ((svgX - PAD) / (W - PAD * 2)) * (en - s)
      const factor = e.deltaY > 0 ? 1.22 : 1 / 1.22
      const ns = pivot + (s - pivot) * factor
      const ne = pivot + (en - pivot) * factor
      const span = ne - ns
      if (span < 0.4 || span > 200) return
      setXRange([ns, ne])
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // ── Global pan via window listeners ───────────────────────────────────────
  useEffect(() => {
    function onWindowMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current || !dragRef.current) return
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const plotWidthPx = rect.width * (W - PAD * 2) / W
      const span = dragRef.current.startRange[1] - dragRef.current.startRange[0]
      const dxData = (dragRef.current.startX - e.clientX) / plotWidthPx * span
      setXRange([
        dragRef.current.startRange[0] + dxData,
        dragRef.current.startRange[1] + dxData,
      ])
    }
    function onWindowMouseUp() {
      if (isDraggingRef.current) {
        setIsDragging(false)
        dragRef.current = null
      }
    }
    window.addEventListener('mousemove', onWindowMouseMove)
    window.addEventListener('mouseup', onWindowMouseUp)
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove)
      window.removeEventListener('mouseup', onWindowMouseUp)
    }
  }, [])

  const [rangeStart, rangeEnd] = xRange
  const numPoints = isDragging ? 150 : 600

  const samples = signals.map(signal => ({
    ...signal,
    samples: mode === 'discrete'
      ? sampleDiscrete(signal.node, rangeStart, rangeEnd)
      : sampleSignal(signal.node, rangeStart, rangeEnd, numPoints),
  }))

  const gibbsSamples = gibbsOverlay ?? []

  const allValues = [
    ...samples.flatMap(s => s.samples.map(p => p.y)),
    ...gibbsSamples.map(p => p.y),
  ]
  const rawMin = Math.min(...allValues, -0.5)
  const rawMax = Math.max(...allValues, 0.5)
  const padY = (rawMax - rawMin) * 0.08

  // Use provided yRange (from all signals) or computed from visible ones
  const minValue = yRange ? yRange.min : rawMin - padY
  const maxValue = yRange ? yRange.max : rawMax + padY

  const xScale = (x: number) => PAD + ((x - rangeStart) / (rangeEnd - rangeStart)) * (W - PAD * 2)
  const yScale = (y: number) => H - PAD - ((y - minValue) / Math.max(maxValue - minValue, 1e-6)) * (H - PAD * 2)

  const xTicks = niceTicksInRange(rangeStart, rangeEnd, 8)
  const yTicks = niceTicksInRange(minValue, maxValue, 5)

  const visibleSignals = signals.filter(s => !s.preview)
  const allImpulseMarkers = signals.map(sig => ({
    sig,
    markers: extractImpulseMarkers(sig.node),
  })).filter(({ markers }) => markers.length > 0)

  function getSvgPos(e: React.MouseEvent) {
    const wrap = wrapRef.current
    if (!wrap) return null
    const rect = wrap.getBoundingClientRect()
    const svgX = (e.clientX - rect.left) * (W / rect.width)
    const svgY = (e.clientY - rect.top) * (H / rect.height)
    return { svgX, svgY }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const pos = getSvgPos(e)
    if (!pos) return
    const { svgX, svgY } = pos
    if (svgX < PAD || svgX > W - PAD || svgY < PAD || svgY > H - PAD) return
    e.preventDefault()
    setIsDragging(true)
    setTooltip(null)
    dragRef.current = { startX: e.clientX, startRange: xRange }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (isDragging) return
    if (!showTooltip) return
    const pos = getSvgPos(e)
    if (!pos) return
    const { svgX, svgY } = pos
    if (svgX < PAD || svgX > W - PAD || svgY < PAD || svgY > H - PAD) {
      setTooltip(null)
      return
    }
    const dataX = rangeStart + ((svgX - PAD) / (W - PAD * 2)) * (rangeEnd - rangeStart)
    if (mode === 'discrete') {
      const nearestN = Math.round(dataX)
      const nearestSvgX = xScale(nearestN)
      if (Math.abs(svgX - nearestSvgX) > 14) { setTooltip(null); return }
      setTooltip({ svgX: nearestSvgX, dataX: nearestN })
    } else {
      setTooltip({ svgX, dataX })
    }
  }

  function handleMouseLeave() {
    setTooltip(null)
  }

  function handleDoubleClick() {
    setXRange(DEFAULT_RANGE)
  }

  const maxLabelLen = visibleSignals.reduce((m, s) => Math.max(m, s.label.length), 3)
  const ttipW = Math.min(108, 36 + maxLabelLen * 5)
  const ttipRight = tooltip ? tooltip.svgX > W - ttipW - 30 : false
  const ttipX = tooltip ? (ttipRight ? tooltip.svgX - ttipW - 4 : tooltip.svgX + 6) : 0

  // Compute legend box height dynamically (period label uses extra row)
  const legendItems = visibleSignals.map(sig => ({
    sig,
    hasPeriod: !!sig.stats?.estimatedPeriod,
  }))
  const legendRowH = 16
  const legendPeriodH = 10
  const legendH = legendItems.reduce((h, item) => h + legendRowH + (item.hasPeriod ? legendPeriodH : 0), 8)
  const legendLabelMax = visibleSignals.reduce((m, s) => Math.max(m, s.label.length), 2)
  const legendW = Math.min(130, 22 + legendLabelMax * 6.5)

  const isZoomed = xRange[0] !== DEFAULT_RANGE[0] || xRange[1] !== DEFAULT_RANGE[1]

  return (
    <div
      ref={wrapRef}
      className="signal-plot-wrap"
      style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="signal-plot"
        role="img"
        aria-label="Signal visualization"
      >
        <defs>
          <linearGradient id="plotBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.97)" />
            <stop offset="100%" stopColor="rgba(243,244,246,0.93)" />
          </linearGradient>
          <clipPath id="plotClip">
            <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} />
          </clipPath>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#plotBg)" />

        {/* Grid */}
        {showGrid && xTicks.map(x => (
          <line key={`xg-${x}`}
            x1={xScale(x)} y1={PAD} x2={xScale(x)} y2={H - PAD}
            stroke="rgba(15,23,42,0.055)" strokeWidth="1" />
        ))}
        {showGrid && yTicks.map(y => (
          <line key={`yg-${y}`}
            x1={PAD} y1={yScale(y)} x2={W - PAD} y2={yScale(y)}
            stroke="rgba(15,23,42,0.055)" strokeWidth="1" />
        ))}

        {/* Assi */}
        <line x1={PAD} y1={yScale(0)} x2={W - PAD} y2={yScale(0)}
          stroke="rgba(15,23,42,0.22)" strokeWidth="1.5" />
        <line x1={xScale(0)} y1={PAD} x2={xScale(0)} y2={H - PAD}
          stroke="rgba(15,23,42,0.22)" strokeWidth="1.5" />

        {/* Tick x */}
        {xTicks.map(x => (
          <text key={`xt-${x}`} x={xScale(x)} y={H - PAD + 14}
            textAnchor="middle" fill="#64748b" fontSize="10">
            {formatTick(x)}
          </text>
        ))}

        {/* Tick y */}
        {yTicks.map(y => y !== 0 && (
          <text key={`yt-${y}`} x={PAD - 6} y={yScale(y) + 4}
            textAnchor="end" fill="#64748b" fontSize="10">
            {formatTick(y)}
          </text>
        ))}

        {/* Segnali */}
        {signals.map(signal => {
          const series = samples.find(s => s.id === signal.id)?.samples ?? []
          const strokeColor = signal.preview ? '#9ca3af' : signal.color
          const opacity = signal.preview ? 0.45 : 1
          const dashArray = signal.preview ? '6 4' : undefined

          if (mode === 'discrete') {
            return (
              <g key={signal.id}>
                {series.map(sample => {
                  const isZero = Math.abs(sample.y) < 1e-9
                  return (
                    <g key={`${signal.id}-${sample.x}`}>
                      {!isZero && (
                        <line x1={xScale(sample.x)} y1={yScale(0)} x2={xScale(sample.x)} y2={yScale(sample.y)}
                          stroke={strokeColor} strokeWidth="2.5" opacity={opacity}
                          strokeDasharray={dashArray} clipPath="url(#plotClip)" />
                      )}
                      {isZero ? (
                        <circle cx={xScale(sample.x)} cy={yScale(0)} r="4"
                          fill="none" stroke={strokeColor} strokeWidth="1.5" opacity={opacity * 0.55} />
                      ) : (
                        <circle cx={xScale(sample.x)} cy={yScale(sample.y)} r="5"
                          fill={strokeColor} opacity={opacity} />
                      )}
                    </g>
                  )
                })}
              </g>
            )
          }

          const path = buildPath(series, xScale, yScale)
          const fillPath = buildFillPath(series, xScale, yScale)
          return (
            <g key={signal.id}>
              {fillPath && (
                <path d={fillPath} fill={strokeColor} fillOpacity={signal.preview ? 0.06 : 0.10}
                  stroke="none" clipPath="url(#plotClip)" />
              )}
              <path d={path} fill="none"
                stroke={strokeColor} strokeWidth="2.5"
                strokeLinejoin="round" strokeLinecap="round"
                opacity={opacity} strokeDasharray={dashArray}
                clipPath="url(#plotClip)" />
            </g>
          )
        })}

        {/* Frecce impulso */}
        {allImpulseMarkers.flatMap(({ sig, markers }) =>
          markers.map(marker => {
            const px = xScale(marker.position)
            const py = yScale(marker.amplitude)
            const py0 = yScale(0)
            const up = marker.amplitude >= 0
            const arrowBase = up ? py + 12 : py - 12
            const color = sig.preview ? '#9ca3af' : sig.color
            const opacity = sig.preview ? 0.45 : 1
            return (
              <g key={`${sig.id}-imp-${marker.position}`} clipPath="url(#plotClip)" opacity={opacity}>
                <line x1={px} y1={py0} x2={px} y2={arrowBase} stroke={color} strokeWidth="2.5" />
                <polygon points={`${px},${py} ${px - 6},${arrowBase} ${px + 6},${arrowBase}`} fill={color} />
                {Math.abs(marker.amplitude) !== 1 && (
                  <text x={px + 8} y={py + (up ? 0 : 12)} fill={color} fontSize="9">
                    {marker.amplitude}
                  </text>
                )}
              </g>
            )
          })
        )}

        {/* DFT time-window: ghost replicas + boundary lines */}
        {mode === 'discrete' && dftWindows?.map(dw => {
          const x0 = xScale(dw.startN)
          const xN = xScale(dw.startN + dw.N)
          const ghostSamples = sampleDiscreteGhost(dw.node, rangeStart, rangeEnd, dw.startN, dw.N)
          return (
            <g key={`dfw-${dw.signalId}`}>
              {/* Repliche temporali con opacità ridotta */}
              <g opacity={0.28}>
                {ghostSamples.map(sample => {
                  const isZero = Math.abs(sample.y) < 1e-9
                  return (
                    <g key={`ghost-${sample.x}`}>
                      {!isZero && (
                        <line x1={xScale(sample.x)} y1={yScale(0)} x2={xScale(sample.x)} y2={yScale(sample.y)}
                          stroke={dw.color} strokeWidth="2" clipPath="url(#plotClip)" />
                      )}
                      {isZero ? (
                        <circle cx={xScale(sample.x)} cy={yScale(0)} r="3.5"
                          fill="none" stroke={dw.color} strokeWidth="1.2" />
                      ) : (
                        <circle cx={xScale(sample.x)} cy={yScale(sample.y)} r="4"
                          fill={dw.color} />
                      )}
                    </g>
                  )
                })}
              </g>
              {/* Linee verticali tratteggiate ai bordi del periodo DFT */}
              {x0 >= PAD && x0 <= W - PAD && (
                <g>
                  <line x1={x0} y1={PAD} x2={x0} y2={H - PAD}
                    stroke={dw.color} strokeWidth="1.5" strokeDasharray="6 3" strokeOpacity={0.65} />
                  <text x={x0 + 3} y={PAD + 12} fill={dw.color} fontSize="8.5" fillOpacity={0.8}>
                    n=0
                  </text>
                </g>
              )}
              {xN >= PAD && xN <= W - PAD && (
                <g>
                  <line x1={xN} y1={PAD} x2={xN} y2={H - PAD}
                    stroke={dw.color} strokeWidth="1.5" strokeDasharray="6 3" strokeOpacity={0.65} />
                  <text x={xN + 3} y={PAD + 12} fill={dw.color} fontSize="8.5" fillOpacity={0.8}>
                    n=N={dw.N}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Overlay Gibbs */}
        {gibbsSamples.length > 1 && (
          <path d={buildPath(gibbsSamples, xScale, yScale)}
            fill="none" stroke="rgba(251,146,60,0.85)" strokeWidth="2"
            strokeDasharray="8 4" strokeLinejoin="round" clipPath="url(#plotClip)" />
        )}

        {/* Tooltip */}
        {tooltip && showTooltip && (
          <g>
            <line x1={tooltip.svgX} y1={PAD} x2={tooltip.svgX} y2={H - PAD}
              stroke="rgba(100,116,139,0.40)" strokeWidth="1" strokeDasharray="4 3" />
            <rect x={ttipX} y={PAD + 2}
              width={ttipW} height={visibleSignals.length * 13 + 18}
              fill="rgba(2,6,23,0.82)" rx="3" />
            <text x={ttipX + 5} y={PAD + 12} fill="#94a3b8" fontSize="8.5">
              {mode === 'discrete' ? 'n' : 't'}={tooltip.dataX.toFixed(2)}
            </text>
            {visibleSignals.map((sig, i) => (
              <text key={sig.id} x={ttipX + 5} y={PAD + 23 + i * 13} fill={sig.color} fontSize="8.5">
                {sig.label.slice(0, 10)}: {evaluateSignal(sig.node, tooltip.dataX).toFixed(3)}
              </text>
            ))}
          </g>
        )}

        {/* Mini legenda — period on second line per signal */}
        {showLegend && visibleSignals.length > 0 && (() => {
          let yOff = 7
          return (
            <g>
              <rect x={W - PAD - legendW - 4} y={PAD + 2}
                width={legendW} height={legendH}
                fill="rgba(255,255,255,0.88)" rx="4"
                stroke="rgba(15,23,42,0.10)" strokeWidth="1" />
              {legendItems.map(({ sig, hasPeriod }) => {
                const thisY = yOff
                yOff += legendRowH + (hasPeriod ? legendPeriodH : 0)
                return (
                  <g key={sig.id} transform={`translate(${W - PAD - legendW}, ${PAD + thisY})`}>
                    <rect x={0} y={0} width={7} height={7} fill={sig.color} rx="1" />
                    <text x={11} y={8} fill="#1e293b" fontSize="9.5">{sig.label.slice(0, 16)}</text>
                    {hasPeriod && (
                      <text x={11} y={17} fill="#64748b" fontSize="8">T={sig.stats!.estimatedPeriod!.toFixed(2)}</text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* Reset zoom — pointerEvents: all so it works with pointer-events:none SVG */}
        {isZoomed && (
          <g style={{ cursor: 'pointer', pointerEvents: 'all' }}
            onMouseDown={e => { e.stopPropagation(); setXRange(DEFAULT_RANGE) }}>
            <rect x={PAD + 2} y={PAD + 2} width={38} height={14} fill="rgba(100,116,139,0.18)" rx="2" />
            <text x={PAD + 21} y={PAD + 12} textAnchor="middle" fill="#64748b" fontSize="9">reset</text>
          </g>
        )}

        {/* Label asse x */}
        <text x={W - PAD + 4} y={yScale(0) + 4} fill="#64748b" fontSize="11">
          {mode === 'discrete' ? 'n' : 't'}
        </text>
      </svg>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sampleDiscrete(node: SignalNode, start: number, end: number): SignalSample[] {
  const values: SignalSample[] = []
  for (let x = Math.floor(start); x <= Math.ceil(end); x++) {
    values.push({ x, y: evaluateSignal(node, x) })
  }
  return values
}

function sampleDiscreteGhost(
  node: SignalNode,
  start: number,
  end: number,
  windowStart: number,
  windowN: number,
): SignalSample[] {
  const values: SignalSample[] = []
  for (let x = Math.floor(start); x <= Math.ceil(end); x++) {
    if (x >= windowStart && x < windowStart + windowN) continue
    const nWrap = ((x - windowStart) % windowN + windowN) % windowN + windowStart
    values.push({ x, y: evaluateSignal(node, nWrap) })
  }
  return values
}

function buildFillPath(
  samples: SignalSample[],
  xScale: (v: number) => number,
  yScale: (v: number) => number,
): string {
  if (samples.length < 2) return ''
  const y0 = yScale(0).toFixed(1)
  const pts = samples.map(s => `${xScale(s.x).toFixed(1)},${yScale(s.y).toFixed(1)}`)
  return `M ${xScale(samples[0].x).toFixed(1)},${y0} L ${pts.join(' L ')} L ${xScale(samples[samples.length - 1].x).toFixed(1)},${y0} Z`
}

function buildPath(
  samples: SignalSample[],
  xScale: (v: number) => number,
  yScale: (v: number) => number,
): string {
  if (samples.length === 0) return ''
  return `M ${samples.map(s => `${xScale(s.x).toFixed(1)},${yScale(s.y).toFixed(1)}`).join(' L ')}`
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

function formatTick(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 100) return v.toFixed(0)
  if (abs >= 10) return v.toFixed(1)
  return parseFloat(v.toPrecision(3)).toString()
}
