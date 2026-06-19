import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SpectralResult, ContinuousSpectrum, DiracSpectrum, DFTSpectrum, AnalysisMode } from '../domain/fourier/types'
import type { AliasingOverlay } from '../domain/sampling'

type SpectrumEntry = {
  id: string
  label: string
  color: string
  spectrum: SpectralResult
  aliasing?: AliasingOverlay
  dtAliasingWarning?: string
  nodeKind?: string
  analysisMode?: AnalysisMode
}

type SpectrumPlotProps = {
  entries: SpectrumEntry[]
  frequencyLabel?: string
  showPhase?: boolean
  showTooltip?: boolean
  showEnvelope?: boolean
  zoomKey?: string
}

const W = 1000
const PAD_L = 56
const PAD_R = 24
const PAD_TOP = 18
const PAD_INNER = 28
const PANEL_H = 200

function totalH(showPhase: boolean) {
  return showPhase
    ? PAD_TOP + PANEL_H + PAD_INNER + PANEL_H + 30
    : PAD_TOP + PANEL_H + 30
}

const PLOT_W = W - PAD_L - PAD_R
const AMPLITUDE_Y0 = PAD_TOP
const PHASE_Y0 = PAD_TOP + PANEL_H + PAD_INNER

export const SpectrumPlot = memo(function SpectrumPlot({
  entries,
  frequencyLabel = 'f [Hz]',
  showPhase = true,
  showTooltip = true,
  showEnvelope = true,
  zoomKey,
}: SpectrumPlotProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [tooltipX, setTooltipX] = useState<number | null>(null)
  const [tooltipPhX, setTooltipPhX] = useState<number | null>(null)
  const [xRangeAmp, setXRangeAmp] = useState<[number, number] | null>(null)
  const [xRangePh, setXRangePh] = useState<[number, number] | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const xRangeAmpRef = useRef<[number, number] | null>(null)
  const xRangePhRef = useRef<[number, number] | null>(null)
  const isDraggingRef = useRef(isDragging)
  isDraggingRef.current = isDragging
  const showPhaseRef = useRef(showPhase)
  showPhaseRef.current = showPhase
  const dragRef = useRef<{ startX: number; startRange: [number, number]; panel: 'amp' | 'phase' } | null>(null)
  const totalHRef = useRef(totalH(showPhase))
  totalHRef.current = totalH(showPhase)

  const TOTAL_H = totalH(showPhase)

  const { fMin: baseFMin, fMax: baseFMax } = useMemo(
    () => globalFreqRange(entries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries.map(e => e.id).join(',')],
  )

  // Reset zoom only when the signal set changes (add/remove), not on hide/show
  useEffect(() => { setXRangeAmp(null); setXRangePh(null) }, [zoomKey])

  const [fMinAmp, fMaxAmp] = xRangeAmp ?? [baseFMin, baseFMax]
  const [fMinPh, fMaxPh] = xRangePh ?? [baseFMin, baseFMax]
  xRangeAmpRef.current = xRangeAmp ?? [baseFMin, baseFMax]
  xRangePhRef.current = xRangePh ?? [baseFMin, baseFMax]
  const fSpanAmp = fMaxAmp - fMinAmp || 1
  const fSpanPh = fMaxPh - fMinPh || 1

  // ── Non-passive wheel zoom ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = wrap!.getBoundingClientRect()
      const svgX = (e.clientX - rect.left) * (W / rect.width)
      const svgY = (e.clientY - rect.top) * (totalHRef.current / rect.height)
      const inAmp = svgX >= PAD_L && svgX <= W - PAD_R && svgY >= AMPLITUDE_Y0 && svgY <= AMPLITUDE_Y0 + PANEL_H
      const inPh = showPhaseRef.current && svgX >= PAD_L && svgX <= W - PAD_R && svgY >= PHASE_Y0 && svgY <= PHASE_Y0 + PANEL_H
      if (!inAmp && !inPh) return
      const curRange = inAmp ? xRangeAmpRef.current! : xRangePhRef.current!
      const pivot = curRange[0] + ((svgX - PAD_L) / PLOT_W) * (curRange[1] - curRange[0])
      const factor = e.deltaY > 0 ? 1.22 : 1 / 1.22
      const ns = pivot + (curRange[0] - pivot) * factor
      const ne = pivot + (curRange[1] - pivot) * factor
      if (ne - ns < 0.001 || ne - ns > 2000) return
      if (inAmp) setXRangeAmp([ns, ne])
      else setXRangePh([ns, ne])
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // ── Global pan ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onWindowMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current || !dragRef.current) return
      const wrap = wrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const plotWidthPx = rect.width * PLOT_W / W
      const span = dragRef.current.startRange[1] - dragRef.current.startRange[0]
      const dxData = (dragRef.current.startX - e.clientX) / plotWidthPx * span
      const newRange: [number, number] = [
        dragRef.current.startRange[0] + dxData,
        dragRef.current.startRange[1] + dxData,
      ]
      if (dragRef.current.panel === 'amp') setXRangeAmp(newRange)
      else setXRangePh(newRange)
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

  const xFAmp = (f: number) => PAD_L + ((f - fMinAmp) / fSpanAmp) * PLOT_W
  const xFPh = (f: number) => PAD_L + ((f - fMinPh) / fSpanPh) * PLOT_W

  const allMags = entries.flatMap(e => extractMagnitudes(e.spectrum))
  const maxMag = Math.max(...allMags, 1e-9)
  const yAmp = (mag: number) => AMPLITUDE_Y0 + PANEL_H - (mag / maxMag) * (PANEL_H - 4)

  const allPhases = showPhase ? entries.flatMap(e => extractPhases(e.spectrum)) : []
  const phaseRawMin = allPhases.length > 0 ? Math.min(...allPhases) : -Math.PI
  const phaseRawMax = allPhases.length > 0 ? Math.max(...allPhases) : Math.PI
  const phasePad = (phaseRawMax - phaseRawMin) * 0.12 + 0.15
  const phaseMin = Math.max(-Math.PI, phaseRawMin - phasePad)
  const phaseMax = Math.min(Math.PI, phaseRawMax + phasePad)
  const phaseSpan = Math.max(phaseMax - phaseMin, 0.01)
  const yPhase = (phi: number) => PHASE_Y0 + PANEL_H - ((phi - phaseMin) / phaseSpan) * (PANEL_H - 4)

  const fTicksAmp = computeTicks(fMinAmp, fMaxAmp, 8)
  const fTicksPh = showPhase ? computeTicks(fMinPh, fMaxPh, 8) : []
  const magTicks = computeTicks(0, maxMag, 4)
  const phaseTicks = showPhase ? computePhaseTicks(phaseMin, phaseMax) : []

  type TooltipValue = { label: string; color: string; mag: number | null; indexStr?: string }
  type TooltipPhValue = { label: string; color: string; phase: number; indexStr?: string }

  function discreteIndexStr(e: SpectrumEntry, k: number): string {
    if (e.analysisMode === 'DT_periodic' && e.spectrum.kind === 'dirac') {
      const N = (e.spectrum as DiracSpectrum).T
      return `k/N=${k}/${N}`
    }
    return `k=${k}`
  }

  const tooltipFreq = tooltipX !== null
    ? fMinAmp + ((tooltipX - PAD_L) / PLOT_W) * fSpanAmp
    : null
  const tooltipValues: TooltipValue[] = tooltipFreq !== null
    ? entries.flatMap(e => {
        if (e.spectrum.kind === 'continuous') {
          return [{ label: e.label, color: e.color, mag: interpMag(e.spectrum, tooltipFreq) }]
        }
        const thresh = e.spectrum.kind === 'dft' ? Math.max(8, PLOT_W / e.spectrum.N / 2) : 12
        let bestDist = Infinity, bestMag = 0, bestK = 0
        const s = e.spectrum as DiracSpectrum | DFTSpectrum
        for (let i = 0; i < s.frequencies.length; i++) {
          const d = Math.abs(xFAmp(s.frequencies[i]) - tooltipX!)
          if (d < bestDist) { bestDist = d; bestMag = s.magnitude[i]; bestK = s.k[i] }
        }
        return bestDist <= thresh ? [{ label: e.label, color: e.color, mag: bestMag, indexStr: discreteIndexStr(e, bestK) }] : []
      })
    : []

  const tooltipPhFreq = tooltipPhX !== null
    ? fMinPh + ((tooltipPhX - PAD_L) / PLOT_W) * fSpanPh
    : null
  const tooltipPhValues: TooltipPhValue[] = tooltipPhFreq !== null
    ? entries.flatMap(e => {
        if (e.spectrum.kind === 'continuous') {
          const ph = interpPhase(e.spectrum, tooltipPhFreq)
          return ph !== null ? [{ label: e.label, color: e.color, phase: ph }] : []
        }
        const thresh = e.spectrum.kind === 'dft' ? Math.max(8, PLOT_W / e.spectrum.N / 2) : 12
        let bestDist = Infinity, bestPhase = 0, bestK = 0
        const s = e.spectrum as DiracSpectrum | DFTSpectrum
        for (let i = 0; i < s.frequencies.length; i++) {
          const d = Math.abs(xFPh(s.frequencies[i]) - tooltipPhX!)
          if (d < bestDist) { bestDist = d; bestPhase = s.phase[i]; bestK = s.k[i] }
        }
        return bestDist <= thresh ? [{ label: e.label, color: e.color, phase: bestPhase, indexStr: discreteIndexStr(e, bestK) }] : []
      })
    : []

  const hasDiscreteEntries = entries.some(e => e.spectrum.kind !== 'continuous')
  const maxLabelLen = Math.max(...entries.map(e => e.label.length), 4)
  const ttipW = Math.min(hasDiscreteEntries ? 150 : 120, 36 + maxLabelLen * 6 + (hasDiscreteEntries ? 30 : 0))
  const ttipLeft = tooltipX !== null && tooltipX > W - ttipW - 30
  const ttipPhLeft = tooltipPhX !== null && tooltipPhX > W - ttipW - 30

  const legendLabelMax = Math.max(...entries.map(e => e.label.length), 2)
  const legendW = Math.min(150, 24 + legendLabelMax * 6.5)
  const legendH = entries.reduce((h, e) => {
    const rec = recognizeSpectrum(e.nodeKind ?? '', e.analysisMode ?? 'CT_aperiodic')
    return h + (rec ? 26 : 16)
  }, 8)

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const svgX = (e.clientX - rect.left) * (W / rect.width)
    const svgY = (e.clientY - rect.top) * (TOTAL_H / rect.height)
    const inAmp = svgX >= PAD_L && svgX <= W - PAD_R && svgY >= AMPLITUDE_Y0 && svgY <= AMPLITUDE_Y0 + PANEL_H
    const inPh = showPhase && svgX >= PAD_L && svgX <= W - PAD_R && svgY >= PHASE_Y0 && svgY <= PHASE_Y0 + PANEL_H
    if (!inAmp && !inPh) return
    e.preventDefault()
    setIsDragging(true)
    setTooltipX(null)
    const panel: 'amp' | 'phase' = inAmp ? 'amp' : 'phase'
    const startRange = panel === 'amp' ? xRangeAmpRef.current! : xRangePhRef.current!
    dragRef.current = { startX: e.clientX, startRange, panel }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (isDragging) return
    if (!showTooltip) return
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const svgX = (e.clientX - rect.left) * (W / rect.width)
    const svgY = (e.clientY - rect.top) * (TOTAL_H / rect.height)
    const inX = svgX >= PAD_L && svgX <= W - PAD_R
    setTooltipX(inX && svgY >= AMPLITUDE_Y0 && svgY <= AMPLITUDE_Y0 + PANEL_H ? svgX : null)
    setTooltipPhX(showPhase && inX && svgY >= PHASE_Y0 && svgY <= PHASE_Y0 + PANEL_H ? svgX : null)
  }

  const isAmpZoomed = xRangeAmp !== null
  const isPhZoomed = xRangePh !== null

  if (entries.length === 0) {
    return (
      <div ref={wrapRef} className="signal-plot-wrap">
        <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="signal-plot" role="img">
          <defs><linearGradient id="specBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.97)" />
            <stop offset="100%" stopColor="rgba(243,244,246,0.93)" />
          </linearGradient></defs>
          <rect x={0} y={0} width={W} height={TOTAL_H} fill="url(#specBg)" />
          <text x={W / 2} y={TOTAL_H / 2} textAnchor="middle" fill="#94a3b8" fontSize="13">
            Nessun segnale con analisi spettrale
          </text>
        </svg>
      </div>
    )
  }

  const dtAliasingWarnings = entries
    .filter(e => e.dtAliasingWarning)
    .map(e => ({ id: e.id, label: e.label, warning: e.dtAliasingWarning! }))

  return (
    <div className="spectrum-plot-outer">
      {dtAliasingWarnings.map(w => (
        <div key={w.id} className="expr-warning expr-warning--warn spectrum-aliasing-banner">
          ⚠ {w.label}: {w.warning}
        </div>
      ))}
    <div
      ref={wrapRef}
      className="signal-plot-wrap"
      style={{ cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setTooltipX(null); setTooltipPhX(null) }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${TOTAL_H}`}
        className="signal-plot"
        role="img"
        aria-label="Spectrum visualization"
      >
        <defs>
          <linearGradient id="specBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.97)" />
            <stop offset="100%" stopColor="rgba(243,244,246,0.93)" />
          </linearGradient>
          <clipPath id="ampClip">
            <rect x={PAD_L} y={AMPLITUDE_Y0} width={PLOT_W} height={PANEL_H} />
          </clipPath>
          <clipPath id="phaseClip">
            <rect x={PAD_L} y={PHASE_Y0} width={PLOT_W} height={PANEL_H} />
          </clipPath>
        </defs>

        <rect x={0} y={0} width={W} height={TOTAL_H} fill="url(#specBg)" />

        {/* Panel backgrounds */}
        <rect x={PAD_L} y={AMPLITUDE_Y0} width={PLOT_W} height={PANEL_H}
          fill="rgba(248,250,252,0.6)" stroke="rgba(203,213,225,0.5)" strokeWidth="1" />
        {showPhase && (
          <rect x={PAD_L} y={PHASE_Y0} width={PLOT_W} height={PANEL_H}
            fill="rgba(248,250,252,0.6)" stroke="rgba(203,213,225,0.5)" strokeWidth="1" />
        )}

        {/* Grid verticale ampiezza */}
        {fTicksAmp.map(f => (
          <line key={`vga-${f}`}
            x1={xFAmp(f)} y1={AMPLITUDE_Y0} x2={xFAmp(f)} y2={AMPLITUDE_Y0 + PANEL_H}
            stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
        ))}

        {/* Grid verticale fase */}
        {showPhase && fTicksPh.map(f => (
          <line key={`vgp-${f}`}
            x1={xFPh(f)} y1={PHASE_Y0} x2={xFPh(f)} y2={PHASE_Y0 + PANEL_H}
            stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
        ))}

        {/* f=0 ampiezza */}
        {fMinAmp < 0 && fMaxAmp > 0 && (
          <line x1={xFAmp(0)} y1={AMPLITUDE_Y0} x2={xFAmp(0)} y2={AMPLITUDE_Y0 + PANEL_H}
            stroke="rgba(15,23,42,0.18)" strokeWidth="1.5" />
        )}

        {/* f=0 fase */}
        {showPhase && fMinPh < 0 && fMaxPh > 0 && (
          <line x1={xFPh(0)} y1={PHASE_Y0} x2={xFPh(0)} y2={PHASE_Y0 + PANEL_H}
            stroke="rgba(15,23,42,0.18)" strokeWidth="1.5" />
        )}

        {/* Grid orizzontale ampiezza */}
        {magTicks.map(m => (
          <line key={`hga-${m}`}
            x1={PAD_L} y1={yAmp(m)} x2={PAD_L + PLOT_W} y2={yAmp(m)}
            stroke="rgba(15,23,42,0.07)" strokeWidth="1" />
        ))}

        {/* Grid orizzontale fase */}
        {showPhase && phaseTicks.map(phi => (
          <line key={`hgp-${phi}`}
            x1={PAD_L} y1={yPhase(phi)} x2={PAD_L + PLOT_W} y2={yPhase(phi)}
            stroke={Math.abs(phi) < 0.01 ? 'rgba(15,23,42,0.18)' : 'rgba(15,23,42,0.06)'}
            strokeWidth={Math.abs(phi) < 0.01 ? 1.5 : 1} />
        ))}

        {/* Asse baseline ampiezza */}
        <line x1={PAD_L} y1={AMPLITUDE_Y0 + PANEL_H} x2={PAD_L + PLOT_W} y2={AMPLITUDE_Y0 + PANEL_H}
          stroke="rgba(15,23,42,0.25)" strokeWidth="1.5" />

        {/* Segnali */}
        {entries.map(entry => {
          const isDT = entry.analysisMode === 'DT_aperiodic' || entry.analysisMode === 'DT_periodic' || entry.analysisMode === 'DT_DFT'
          return (
            <g key={entry.id}>
              {entry.aliasing && renderAliasingOverlay(entry.aliasing, xFAmp, yAmp, AMPLITUDE_Y0, PANEL_H)}
              {/* Repliche periodiche per spettri DT (step=1) con opacità decrescente */}
              {isDT && [-3, -2, -1, 1, 2, 3].map(k => {
                const opac = Math.abs(k) === 1 ? 0.28 : Math.abs(k) === 2 ? 0.14 : 0.06
                const xOff = (f: number) => xFAmp(f + k)
                const xOffPh = (f: number) => xFPh(f + k)
                return (
                  <g key={`rep-${k}`} opacity={opac}>
                    {renderSpectrum(entry.spectrum, entry.color, xOff, xOffPh, yAmp, yPhase, AMPLITUDE_Y0, PANEL_H, PHASE_Y0, showPhase, false)}
                  </g>
                )
              })}
              {renderSpectrum(entry.spectrum, entry.color, xFAmp, xFPh, yAmp, yPhase, AMPLITUDE_Y0, PANEL_H, PHASE_Y0, showPhase, showEnvelope)}
            </g>
          )
        })}

        {/* Linee periodo DTFT a ±1/2 */}
        {entries.some(e => e.analysisMode === 'DT_aperiodic' || e.analysisMode === 'DT_periodic' || e.analysisMode === 'DT_DFT') && (() => {
          const x05Amp = xFAmp(0.5)
          const xn05Amp = xFAmp(-0.5)
          const x05Ph = xFPh(0.5)
          const xn05Ph = xFPh(-0.5)
          const inRangeAmp05 = x05Amp >= PAD_L && x05Amp <= PAD_L + PLOT_W
          const inRangeAmpN05 = xn05Amp >= PAD_L && xn05Amp <= PAD_L + PLOT_W
          const inRangePh05 = x05Ph >= PAD_L && x05Ph <= PAD_L + PLOT_W
          const inRangePhN05 = xn05Ph >= PAD_L && xn05Ph <= PAD_L + PLOT_W
          return (
            <g>
              {inRangeAmpN05 && (
                <g>
                  <line x1={xn05Amp} y1={AMPLITUDE_Y0} x2={xn05Amp} y2={AMPLITUDE_Y0 + PANEL_H}
                    stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="5 3" />
                  <text x={xn05Amp + 3} y={AMPLITUDE_Y0 + 10} fill="rgba(251,191,36,0.8)" fontSize="8">-1/2</text>
                </g>
              )}
              {inRangeAmp05 && (
                <g>
                  <line x1={x05Amp} y1={AMPLITUDE_Y0} x2={x05Amp} y2={AMPLITUDE_Y0 + PANEL_H}
                    stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="5 3" />
                  <text x={x05Amp + 3} y={AMPLITUDE_Y0 + 10} fill="rgba(251,191,36,0.8)" fontSize="8">1/2</text>
                </g>
              )}
              {showPhase && inRangePhN05 && (
                <g>
                  <line x1={xn05Ph} y1={PHASE_Y0} x2={xn05Ph} y2={PHASE_Y0 + PANEL_H}
                    stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="5 3" />
                  <text x={xn05Ph + 3} y={PHASE_Y0 + 10} fill="rgba(251,191,36,0.8)" fontSize="8">-1/2</text>
                </g>
              )}
              {showPhase && inRangePh05 && (
                <g>
                  <line x1={x05Ph} y1={PHASE_Y0} x2={x05Ph} y2={PHASE_Y0 + PANEL_H}
                    stroke="rgba(251,191,36,0.55)" strokeWidth="1.5" strokeDasharray="5 3" />
                  <text x={x05Ph + 3} y={PHASE_Y0 + 10} fill="rgba(251,191,36,0.8)" fontSize="8">1/2</text>
                </g>
              )}
            </g>
          )
        })()}

        {/* Tick labels frequenze ampiezza */}
        {fTicksAmp.map(f => (
          <text key={`fta-${f}`}
            x={xFAmp(f)}
            y={AMPLITUDE_Y0 + PANEL_H + (showPhase ? 10 : 14)}
            textAnchor="middle" fill="#64748b" fontSize={showPhase ? '8' : '10'}>
            {formatFreq(f)}
          </text>
        ))}

        {/* Tick labels frequenze fase */}
        {showPhase && fTicksPh.map(f => (
          <text key={`ftp-${f}`} x={xFPh(f)} y={PHASE_Y0 + PANEL_H + 14}
            textAnchor="middle" fill="#64748b" fontSize="10">
            {formatFreq(f)}
          </text>
        ))}

        {/* Tick labels ampiezza */}
        {magTicks.map(m => (
          <text key={`mt-${m}`} x={PAD_L - 5} y={yAmp(m) + 4}
            textAnchor="end" fill="#64748b" fontSize="9">
            {formatMag(m, maxMag)}
          </text>
        ))}

        {/* Tick labels fase */}
        {showPhase && phaseTicks.map(phi => (
          <text key={`pt-${phi}`} x={PAD_L - 5} y={yPhase(phi) + 4}
            textAnchor="end" fill="#64748b" fontSize="9">
            {phaseLabel(phi)}
          </text>
        ))}

        {/* Label assi */}
        <text x={PAD_L + PLOT_W / 2} y={TOTAL_H - 2} textAnchor="middle" fill="#94a3b8" fontSize="11">
          {frequencyLabel}
        </text>
        <text x={10} y={AMPLITUDE_Y0 + PANEL_H / 2} textAnchor="middle" fill="#94a3b8" fontSize="11"
          transform={`rotate(-90, 10, ${AMPLITUDE_Y0 + PANEL_H / 2})`}>
          |X(f)|
        </text>
        {showPhase && (
          <text x={10} y={PHASE_Y0 + PANEL_H / 2} textAnchor="middle" fill="#94a3b8" fontSize="11"
            transform={`rotate(-90, 10, ${PHASE_Y0 + PANEL_H / 2})`}>
            ∠X(f)
          </text>
        )}

        {/* Mini legenda */}
        {entries.length > 0 && (() => {
          let yOff = 7
          return (
            <g>
              <rect x={W - PAD_R - legendW - 4} y={AMPLITUDE_Y0 + 2}
                width={legendW} height={legendH}
                fill="rgba(255,255,255,0.88)" rx="4"
                stroke="rgba(15,23,42,0.10)" strokeWidth="1" />
              {entries.map(entry => {
                const thisY = yOff
                const rec = recognizeSpectrum(entry.nodeKind ?? '', entry.analysisMode ?? 'CT_aperiodic')
                yOff += 16 + (rec ? 10 : 0)
                return (
                  <g key={entry.id} transform={`translate(${W - PAD_R - legendW}, ${AMPLITUDE_Y0 + thisY})`}>
                    <rect x={0} y={0} width={7} height={7} fill={entry.color} rx="1" />
                    <text x={11} y={8} fill="#1e293b" fontSize="9.5">{entry.label.slice(0, 16)}</text>
                    {rec && (
                      <text x={11} y={17} fill="#64748b" fontSize="7.5">{rec}</text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })()}

        {/* Tooltip crosshair — amplitude panel */}
        {tooltipX !== null && showTooltip && tooltipValues.length > 0 && (
          <g>
            <line x1={tooltipX} y1={AMPLITUDE_Y0} x2={tooltipX} y2={AMPLITUDE_Y0 + PANEL_H}
              stroke="rgba(100,116,139,0.4)" strokeWidth="1" strokeDasharray="4 3" />
            <rect
              x={ttipLeft ? tooltipX - ttipW - 4 : tooltipX + 4}
              y={AMPLITUDE_Y0 + 2}
              width={ttipW}
              height={tooltipValues.length * 14 + 18}
              fill="rgba(2,6,23,0.82)" rx="3" />
            <text
              x={(ttipLeft ? tooltipX - ttipW - 4 : tooltipX + 4) + 5}
              y={AMPLITUDE_Y0 + 13}
              fill="#94a3b8" fontSize="9">
              f={formatFreq(tooltipFreq!)}
            </text>
            {tooltipValues.map((tv, i) => (
              <text key={tv.label}
                x={(ttipLeft ? tooltipX - ttipW - 4 : tooltipX + 4) + 5}
                y={AMPLITUDE_Y0 + 24 + i * 14}
                fill={tv.color} fontSize="9">
                {tv.label.slice(0, 10)}: {tv.indexStr ? `${tv.indexStr}, ` : ''}{tv.mag !== null ? tv.mag.toFixed(3) : '—'}
              </text>
            ))}
          </g>
        )}

        {/* Tooltip crosshair fase */}
        {tooltipPhX !== null && showTooltip && showPhase && tooltipPhValues.length > 0 && (
          <g>
            <line x1={tooltipPhX} y1={PHASE_Y0} x2={tooltipPhX} y2={PHASE_Y0 + PANEL_H}
              stroke="rgba(100,116,139,0.4)" strokeWidth="1" strokeDasharray="4 3" />
            <rect
              x={(ttipPhLeft ? tooltipPhX - ttipW - 4 : tooltipPhX + 4)}
              y={PHASE_Y0 + 2}
              width={ttipW}
              height={tooltipPhValues.length * 14 + 18}
              fill="rgba(2,6,23,0.82)" rx="3" />
            <text
              x={(ttipPhLeft ? tooltipPhX - ttipW - 4 : tooltipPhX + 4) + 5}
              y={PHASE_Y0 + 13}
              fill="#94a3b8" fontSize="9">
              f={formatFreq(tooltipPhFreq!)}
            </text>
            {tooltipPhValues.map((tv, i) => (
              <text key={tv.label}
                x={(ttipPhLeft ? tooltipPhX - ttipW - 4 : tooltipPhX + 4) + 5}
                y={PHASE_Y0 + 24 + i * 14}
                fill={tv.color} fontSize="9">
                {tv.label.slice(0, 10)}: {tv.indexStr ? `${tv.indexStr}, ` : ''}{phaseLabel(tv.phase)}
              </text>
            ))}
          </g>
        )}

        {/* Reset zoom ampiezza */}
        {isAmpZoomed && (
          <g style={{ cursor: 'pointer', pointerEvents: 'all' }}
            onMouseDown={e => { e.stopPropagation(); setXRangeAmp(null) }}>
            <rect x={PAD_L + 2} y={AMPLITUDE_Y0 + 2} width={38} height={14} fill="rgba(100,116,139,0.18)" rx="2" />
            <text x={PAD_L + 21} y={AMPLITUDE_Y0 + 12} textAnchor="middle" fill="#64748b" fontSize="9">reset</text>
          </g>
        )}

        {/* Reset zoom fase */}
        {showPhase && isPhZoomed && (
          <g style={{ cursor: 'pointer', pointerEvents: 'all' }}
            onMouseDown={e => { e.stopPropagation(); setXRangePh(null) }}>
            <rect x={PAD_L + 2} y={PHASE_Y0 + 2} width={38} height={14} fill="rgba(100,116,139,0.18)" rx="2" />
            <text x={PAD_L + 21} y={PHASE_Y0 + 12} textAnchor="middle" fill="#64748b" fontSize="9">reset</text>
          </g>
        )}
      </svg>
    </div>
    </div>
  )
}

)

// ── Rendering per tipo di spettro ─────────────────────────────────────────────

function renderSpectrum(
  spectrum: SpectralResult,
  color: string,
  xFAmp: (f: number) => number,
  xFPh: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
  amplitudeY0: number,
  panelH: number,
  phaseY0: number,
  showPhase: boolean,
  showEnvelope: boolean,
) {
  switch (spectrum.kind) {
    case 'continuous':
      return renderContinuous(spectrum, color, xFAmp, xFPh, yAmp, yPhase, amplitudeY0, panelH, showPhase)
    case 'dirac':
      return renderDirac(spectrum, color, xFAmp, xFPh, yAmp, yPhase, amplitudeY0, panelH, phaseY0, showPhase, showEnvelope)
    case 'dft':
      return renderDFT(spectrum, color, xFAmp, xFPh, yAmp, yPhase, amplitudeY0, panelH, phaseY0, showPhase)
  }
}

function renderContinuous(
  s: ContinuousSpectrum,
  color: string,
  xFAmp: (f: number) => number,
  xFPh: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
  amplitudeY0: number,
  panelH: number,
  showPhase: boolean,
) {
  const n = s.frequencies.length
  if (n < 2) return null
  const ampPts: string[] = []
  const phasePts: string[] = []
  for (let i = 0; i < n; i++) {
    const f = s.frequencies[i]
    ampPts.push(`${xFAmp(f)},${yAmp(s.magnitude[i])}`)
    phasePts.push(`${xFPh(f)},${yPhase(s.phase[i])}`)
  }
  const baseline = amplitudeY0 + panelH
  return (
    <>
      <path
        d={`M ${xFAmp(s.frequencies[0])},${baseline} L ${ampPts.join(' L ')} L ${xFAmp(s.frequencies[n - 1])},${baseline} Z`}
        fill={color} fillOpacity={0.12} stroke="none" />
      <path d={`M ${ampPts.join(' L ')}`} fill="none" stroke={color} strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" clipPath="url(#ampClip)" />
      {showPhase && (
        <path d={`M ${phasePts.join(' L ')}`} fill="none" stroke={color} strokeWidth="1.5"
          strokeOpacity={0.65} strokeLinejoin="round" strokeLinecap="round" clipPath="url(#phaseClip)" />
      )}
    </>
  )
}

function renderDirac(
  s: DiracSpectrum,
  color: string,
  xFAmp: (f: number) => number,
  xFPh: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
  amplitudeY0: number,
  panelH: number,
  phaseY0: number,
  showPhase: boolean,
  showEnvelope: boolean,
) {
  const baseline = amplitudeY0 + panelH
  const phaseBaseline = phaseY0 + panelH / 2
  return (
    <>
      {showEnvelope && s.envelope && (() => {
        const pts: string[] = []
        for (let i = 0; i < s.envelope.frequencies.length; i++) {
          pts.push(`${xFAmp(s.envelope.frequencies[i])},${yAmp(s.envelope.magnitude[i])}`)
        }
        return (
          <path d={`M ${pts.join(' L ')}`} fill="none"
            stroke={color} strokeWidth="1.5" strokeOpacity={0.50}
            strokeDasharray="6 4" clipPath="url(#ampClip)" />
        )
      })()}
      {s.frequencies.map((f, i) => {
        const fxA = xFAmp(f)
        const fxP = xFPh(f)
        const fy = yAmp(s.magnitude[i])
        const tipH = 6
        const phFy = showPhase ? yPhase(s.phase[i]) : 0
        return (
          <g key={`dirac-${i}`}>
            <line x1={fxA} y1={baseline} x2={fxA} y2={fy + tipH} stroke={color} strokeWidth="2" />
            <polygon points={`${fxA},${fy} ${fxA - 4},${fy + tipH} ${fxA + 4},${fy + tipH}`} fill={color} />
            {showPhase && (
              <>
                <line x1={fxP} y1={phaseBaseline} x2={fxP} y2={phFy}
                  stroke={color} strokeWidth="1.5" strokeOpacity={0.6} />
                <circle cx={fxP} cy={phFy} r="2.5" fill={color} fillOpacity={0.7} />
              </>
            )}
          </g>
        )
      })}
    </>
  )
}

function renderDFT(
  s: DFTSpectrum,
  color: string,
  xFAmp: (f: number) => number,
  xFPh: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
  amplitudeY0: number,
  panelH: number,
  phaseY0: number,
  showPhase: boolean,
) {
  const baseline = amplitudeY0 + panelH
  const phaseBaseline = phaseY0 + panelH / 2
  return (
    <>
      {s.frequencies.map((f, i) => {
        const fxA = xFAmp(f)
        const fxP = xFPh(f)
        const fy = yAmp(s.magnitude[i])
        const barW = Math.max(2, PLOT_W / s.N - 1)
        const phFy = showPhase ? yPhase(s.phase[i]) : 0
        return (
          <g key={`dft-${i}`}>
            <rect x={fxA - barW / 2} y={fy} width={barW} height={baseline - fy}
              fill={color} fillOpacity={0.75} />
            {showPhase && (
              <>
                <line x1={fxP} y1={phaseBaseline} x2={fxP} y2={phFy}
                  stroke={color} strokeWidth="1.5" strokeOpacity={0.6} />
                <circle cx={fxP} cy={phFy} r="2" fill={color} fillOpacity={0.8} />
              </>
            )}
          </g>
        )
      })}
    </>
  )
}

function renderAliasingOverlay(
  overlay: AliasingOverlay,
  xFAmp: (f: number) => number,
  yAmp: (m: number) => number,
  amplitudeY0: number,
  panelH: number,
) {
  const baseline = amplitudeY0 + panelH
  return (
    <>
      {overlay.replicas.filter(r => r.k !== 0).map(replica => {
        const n = replica.frequencies.length
        if (n < 2) return null
        const pts = Array.from({ length: n }, (_, i) =>
          `${xFAmp(replica.frequencies[i])},${yAmp(replica.magnitude[i])}`
        )
        return (
          <g key={`alias-${replica.k}`} clipPath="url(#ampClip)">
            <path
              d={`M ${xFAmp(replica.frequencies[0])},${baseline} L ${pts.join(' L ')} L ${xFAmp(replica.frequencies[n - 1])},${baseline} Z`}
              fill={replica.color} stroke="none" />
            <path d={`M ${pts.join(' L ')}`} fill="none"
              stroke={replica.color.replace('0.40', '0.70')} strokeWidth="1.5" />
          </g>
        )
      })}
    </>
  )
}

// ── Utilità ───────────────────────────────────────────────────────────────────

function interpPhase(spectrum: ContinuousSpectrum, freq: number): number | null {
  const { frequencies, phase } = spectrum
  const n = frequencies.length
  if (n < 2) return null
  for (let i = 0; i < n - 1; i++) {
    if (frequencies[i] <= freq && freq <= frequencies[i + 1]) {
      const t = (freq - frequencies[i]) / (frequencies[i + 1] - frequencies[i])
      return phase[i] + t * (phase[i + 1] - phase[i])
    }
  }
  return null
}

function interpMag(spectrum: SpectralResult, freq: number): number | null {
  if (spectrum.kind === 'continuous') {
    const { frequencies, magnitude } = spectrum
    const n = frequencies.length
    if (n < 2) return null
    for (let i = 0; i < n - 1; i++) {
      if (frequencies[i] <= freq && freq <= frequencies[i + 1]) {
        const t = (freq - frequencies[i]) / (frequencies[i + 1] - frequencies[i])
        return magnitude[i] + t * (magnitude[i + 1] - magnitude[i])
      }
    }
    return null
  }
  if (spectrum.kind === 'dirac' || spectrum.kind === 'dft') {
    let best = Infinity, bestMag = 0
    for (let i = 0; i < spectrum.frequencies.length; i++) {
      const d = Math.abs(spectrum.frequencies[i] - freq)
      if (d < best) { best = d; bestMag = spectrum.magnitude[i] }
    }
    return bestMag
  }
  return null
}

function globalFreqRange(entries: SpectrumEntry[]): { fMin: number; fMax: number } {
  let fMin = Infinity, fMax = -Infinity
  for (const e of entries) {
    const s = e.spectrum
    if (s.kind === 'continuous') {
      fMin = Math.min(fMin, s.frequencies[0] ?? 0)
      fMax = Math.max(fMax, s.frequencies[s.frequencies.length - 1] ?? 0)
    } else {
      for (const f of s.frequencies) { fMin = Math.min(fMin, f); fMax = Math.max(fMax, f) }
      if (s.kind === 'dirac' && s.envelope) {
        fMin = Math.min(fMin, s.envelope.frequencies[0] ?? fMin)
        fMax = Math.max(fMax, s.envelope.frequencies[s.envelope.frequencies.length - 1] ?? fMax)
      }
    }
    if (e.aliasing) {
      for (const r of e.aliasing.replicas) {
        fMin = Math.min(fMin, r.frequencies[0] ?? fMin)
        fMax = Math.max(fMax, r.frequencies[r.frequencies.length - 1] ?? fMax)
      }
    }
  }
  if (!isFinite(fMin)) fMin = -4
  if (!isFinite(fMax)) fMax = 4
  const absMax = Math.max(Math.abs(fMin), Math.abs(fMax))
  const padded = absMax * 1.08
  return { fMin: -padded, fMax: padded }
}

function extractMagnitudes(s: SpectralResult): number[] {
  return s.kind === 'continuous' ? Array.from(s.magnitude) : s.magnitude
}

function extractPhases(s: SpectralResult): number[] {
  return s.kind === 'continuous' ? Array.from(s.phase) : s.phase
}

function recognizeSpectrum(nodeKind: string, analysisMode: AnalysisMode): string | null {
  if (analysisMode !== 'CT_aperiodic') return null
  const map: Record<string, string> = {
    rect: 'FT → sinc(f)',
    sinc: 'FT → rect(f)',
    triangle: 'FT → sinc²(f)',
    sgn: 'FT → 1/(jπf)',
    step: 'FT → ½δ(f)+1/(j2πf)',
    impulse: 'FT → e^{−j2πft₀}',
  }
  return map[nodeKind] ?? null
}

function computeTicks(min: number, max: number, targetCount: number): number[] {
  const span = max - min
  if (span <= 0) return [min]
  const raw = span / targetCount
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  let step = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10
  step *= magnitude
  const ticks: number[] = []
  const start = Math.ceil(min / step) * step
  for (let t = start; t <= max + step * 0.001; t += step) {
    ticks.push(Math.round(t / step) * step)
  }
  return ticks
}

function formatFreq(f: number): string {
  if (Math.abs(f) < 1e-10) return '0'
  if (Math.abs(f) >= 100) return f.toFixed(0)
  if (Math.abs(f) >= 10) return f.toFixed(1)
  return f.toFixed(2).replace(/\.?0+$/, '')
}

function formatMag(m: number, maxMag: number): string {
  if (m === 0) return '0'
  if (maxMag >= 10) return m.toFixed(0)
  if (maxMag >= 1) return m.toFixed(1)
  return m.toFixed(2)
}

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { [a, b] = [b, a % b] }
  return a || 1
}

function phaseLabel(phi: number): string {
  if (Math.abs(phi) < 1e-9) return '0'
  const r = phi / Math.PI
  for (const d of [1, 2, 3, 4, 6, 8, 12]) {
    const n = Math.round(r * d)
    if (n !== 0 && Math.abs(n / d - r) < 1e-6) {
      const g = gcd(Math.abs(n), d)
      const pn = n / g, pd = d / g
      if (pd === 1) return pn === 1 ? 'π' : pn === -1 ? '-π' : `${pn}π`
      if (pn === 1) return `π/${pd}`
      if (pn === -1) return `-π/${pd}`
      return `${pn}π/${pd}`
    }
  }
  return phi.toFixed(2)
}

function computePhaseTicks(min: number, max: number): number[] {
  const span = max - min
  if (span < 0.01) return []
  const steps: Array<[number, number]> = [[2,1],[1,1],[1,2],[1,3],[1,4],[1,6],[1,8],[1,12]]
  for (const [n, d] of steps) {
    const stepSize = n * Math.PI / d
    const startK = Math.ceil(min / stepSize - 1e-9)
    const ticks: number[] = []
    for (let k = startK; k * stepSize <= max + stepSize * 1e-9; k++) {
      ticks.push(k * n * Math.PI / d)
    }
    if (ticks.length >= 3 && ticks.length <= 7) return ticks
  }
  return computeTicks(min, max, 4)
}
