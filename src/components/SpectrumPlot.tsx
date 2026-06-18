// Renderer spettrale — pannello ampiezza |X(f)| + pannello fase ∠X(f)
// Supporta ContinuousSpectrum, DiracSpectrum (con inviluppo), DFTSpectrum
// e overlay aliasing (repliche semitrasparenti)

import type { SpectralResult, ContinuousSpectrum, DiracSpectrum, DFTSpectrum } from '../domain/fourier/types'
import type { AliasingOverlay } from '../domain/sampling'

type SpectrumEntry = {
  id: string
  label: string
  color: string
  spectrum: SpectralResult
  aliasing?: AliasingOverlay
}

type SpectrumPlotProps = {
  entries: SpectrumEntry[]
  frequencyLabel?: string  // es. 'f [Hz]' oppure 'f (norm.)'
}

const W = 1000
const PAD_L = 56
const PAD_R = 24
const PAD_TOP = 18
const PAD_INNER = 28  // separazione tra pannelli
const PANEL_H = 200   // altezza di ciascun pannello
const TOTAL_H = PAD_TOP + PANEL_H + PAD_INNER + PANEL_H + 30  // +30 per asse x

const PLOT_W = W - PAD_L - PAD_R
const AMPLITUDE_Y0 = PAD_TOP              // top del pannello ampiezza
const PHASE_Y0 = PAD_TOP + PANEL_H + PAD_INNER  // top del pannello fase

export function SpectrumPlot({ entries, frequencyLabel = 'f [Hz]' }: SpectrumPlotProps) {
  if (entries.length === 0) {
    return (
      <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="signal-plot" role="img" aria-label="Spectrum visualization">
        <rect x={0} y={0} width={W} height={TOTAL_H} fill="url(#specBg)" />
        <defs><linearGradient id="specBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.97)" />
          <stop offset="100%" stopColor="rgba(243,244,246,0.93)" />
        </linearGradient></defs>
        <text x={W / 2} y={TOTAL_H / 2} textAnchor="middle" fill="#94a3b8" fontSize="13">
          Nessun segnale con analisi spettrale
        </text>
      </svg>
    )
  }

  // Determina il range di frequenza globale
  const { fMin, fMax } = globalFreqRange(entries)
  const fSpan = fMax - fMin || 1

  const xF = (f: number) => PAD_L + ((f - fMin) / fSpan) * PLOT_W

  // Calcola il massimo di ampiezza per normalizzare l'asse y
  const allMags = entries.flatMap(e => extractMagnitudes(e.spectrum))
  const maxMag = Math.max(...allMags, 1e-9)

  const yAmp = (mag: number) => AMPLITUDE_Y0 + PANEL_H - (mag / maxMag) * (PANEL_H - 4)
  const yPhase = (phi: number) => PHASE_Y0 + PANEL_H / 2 - (phi / Math.PI) * (PANEL_H / 2 - 4)

  // Grid tick positions
  const fTicks = computeTicks(fMin, fMax, 8)
  const magTicks = computeTicks(0, maxMag, 4)

  return (
    <svg viewBox={`0 0 ${W} ${TOTAL_H}`} className="signal-plot" role="img" aria-label="Spectrum visualization">
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
      <rect x={PAD_L} y={AMPLITUDE_Y0} width={PLOT_W} height={PANEL_H} fill="rgba(248,250,252,0.6)" stroke="rgba(203,213,225,0.5)" strokeWidth="1" />
      <rect x={PAD_L} y={PHASE_Y0} width={PLOT_W} height={PANEL_H} fill="rgba(248,250,252,0.6)" stroke="rgba(203,213,225,0.5)" strokeWidth="1" />

      {/* Grid lines verticali (frequenze) */}
      {fTicks.map(f => (
        <line key={`vg-${f}`}
          x1={xF(f)} y1={AMPLITUDE_Y0}
          x2={xF(f)} y2={PHASE_Y0 + PANEL_H}
          stroke="rgba(15,23,42,0.06)" strokeWidth="1" />
      ))}

      {/* Grid lines orizzontali — pannello ampiezza */}
      {magTicks.map(m => (
        <line key={`hg-amp-${m}`}
          x1={PAD_L} y1={yAmp(m)}
          x2={PAD_L + PLOT_W} y2={yAmp(m)}
          stroke="rgba(15,23,42,0.07)" strokeWidth="1" />
      ))}

      {/* Grid lines orizzontali — pannello fase (ogni π/2) */}
      {[-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI].map(phi => (
        <line key={`hg-ph-${phi}`}
          x1={PAD_L} y1={yPhase(phi)}
          x2={PAD_L + PLOT_W} y2={yPhase(phi)}
          stroke={phi === 0 ? 'rgba(15,23,42,0.18)' : 'rgba(15,23,42,0.06)'} strokeWidth={phi === 0 ? 1.5 : 1} />
      ))}

      {/* Asse baseline ampiezza */}
      <line x1={PAD_L} y1={AMPLITUDE_Y0 + PANEL_H} x2={PAD_L + PLOT_W} y2={AMPLITUDE_Y0 + PANEL_H}
        stroke="rgba(15,23,42,0.25)" strokeWidth="1.5" />

      {/* Segnali */}
      {entries.map(entry => (
        <g key={entry.id}>
          {/* Overlay aliasing prima del segnale principale */}
          {entry.aliasing && renderAliasingOverlay(entry.aliasing, xF, yAmp)}
          {renderSpectrum(entry.spectrum, entry.color, xF, yAmp, yPhase)}
        </g>
      ))}

      {/* Tick labels frequenze */}
      {fTicks.map(f => (
        <text key={`ft-${f}`} x={xF(f)} y={PHASE_Y0 + PANEL_H + 14}
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
      {[-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI].map(phi => (
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
      <text x={10} y={PHASE_Y0 + PANEL_H / 2} textAnchor="middle" fill="#94a3b8" fontSize="11"
        transform={`rotate(-90, 10, ${PHASE_Y0 + PANEL_H / 2})`}>
        ∠X(f)
      </text>
    </svg>
  )
}

// --- Rendering per tipo di spettro ---

function renderSpectrum(
  spectrum: SpectralResult,
  color: string,
  xF: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
) {
  switch (spectrum.kind) {
    case 'continuous':
      return renderContinuous(spectrum, color, xF, yAmp, yPhase)
    case 'dirac':
      return renderDirac(spectrum, color, xF, yAmp, yPhase)
    case 'dft':
      return renderDFT(spectrum, color, xF, yAmp, yPhase)
  }
}

function renderContinuous(
  s: ContinuousSpectrum,
  color: string,
  xF: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
) {
  const n = s.frequencies.length
  if (n < 2) return null

  const ampPts: string[] = []
  const phasePts: string[] = []

  for (let i = 0; i < n; i++) {
    const fx = xF(s.frequencies[i])
    ampPts.push(`${fx},${yAmp(s.magnitude[i])}`)
    phasePts.push(`${fx},${yPhase(s.phase[i])}`)
  }

  return (
    <g clipPath="url(#ampClip)">
      {/* Area riempita semitrasparente sotto la curva ampiezza */}
      <path
        d={`M ${xF(s.frequencies[0])},${yAmp(0)} L ${ampPts.join(' L ')} L ${xF(s.frequencies[n - 1])},${yAmp(0)} Z`}
        fill={color} fillOpacity={0.12} stroke="none"
      />
      <path d={`M ${ampPts.join(' L ')}`} fill="none" stroke={color} strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" clipPath="url(#ampClip)" />
      <path d={`M ${phasePts.join(' L ')}`} fill="none" stroke={color} strokeWidth="1.5"
        strokeOpacity={0.65} strokeLinejoin="round" strokeLinecap="round" clipPath="url(#phaseClip)" />
    </g>
  )
}

function renderDirac(
  s: DiracSpectrum,
  color: string,
  xF: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
) {
  const baseline = AMPLITUDE_Y0 + PANEL_H
  const phaseBaseline = PHASE_Y0 + PANEL_H / 2

  return (
    <g>
      {/* Inviluppo continuo tratteggiato (relazione di Poisson) */}
      {s.envelope && (() => {
        const pts: string[] = []
        for (let i = 0; i < s.envelope.frequencies.length; i++) {
          pts.push(`${xF(s.envelope.frequencies[i])},${yAmp(s.envelope.magnitude[i])}`)
        }
        return (
          <path d={`M ${pts.join(' L ')}`} fill="none"
            stroke={color} strokeWidth="1.5" strokeOpacity={0.50}
            strokeDasharray="6 4" clipPath="url(#ampClip)" />
        )
      })()}

      {/* Impulsi di Dirac — frecce verticali */}
      {s.frequencies.map((f, i) => {
        const fx = xF(f)
        const fy = yAmp(s.magnitude[i])
        const phFy = yPhase(s.phase[i])
        const tipH = 6

        return (
          <g key={`dirac-${i}`}>
            {/* Stelo ampiezza */}
            <line x1={fx} y1={baseline} x2={fx} y2={fy + tipH}
              stroke={color} strokeWidth="2" />
            {/* Punta freccia */}
            <polygon
              points={`${fx},${fy} ${fx - 4},${fy + tipH} ${fx + 4},${fy + tipH}`}
              fill={color} />
            {/* Stelo fase */}
            <line x1={fx} y1={phaseBaseline} x2={fx} y2={phFy}
              stroke={color} strokeWidth="1.5" strokeOpacity={0.6} />
            <circle cx={fx} cy={phFy} r="2.5" fill={color} fillOpacity={0.7} />
          </g>
        )
      })}
    </g>
  )
}

function renderDFT(
  s: DFTSpectrum,
  color: string,
  xF: (f: number) => number,
  yAmp: (m: number) => number,
  yPhase: (p: number) => number,
) {
  const baseline = AMPLITUDE_Y0 + PANEL_H
  const phaseBaseline = PHASE_Y0 + PANEL_H / 2

  return (
    <g>
      {s.frequencies.map((f, i) => {
        const fx = xF(f)
        const fy = yAmp(s.magnitude[i])
        const phFy = yPhase(s.phase[i])
        const barW = Math.max(2, PLOT_W / s.N - 1)

        return (
          <g key={`dft-${i}`}>
            <rect x={fx - barW / 2} y={fy} width={barW} height={baseline - fy}
              fill={color} fillOpacity={0.75} />
            <line x1={fx} y1={phaseBaseline} x2={fx} y2={phFy}
              stroke={color} strokeWidth="1.5" strokeOpacity={0.6} />
            <circle cx={fx} cy={phFy} r="2" fill={color} fillOpacity={0.8} />
          </g>
        )
      })}
    </g>
  )
}

function renderAliasingOverlay(
  overlay: AliasingOverlay,
  xF: (f: number) => number,
  yAmp: (m: number) => number,
) {
  return (
    <g>
      {overlay.replicas.filter(r => r.k !== 0).map(replica => {
        const n = replica.frequencies.length
        if (n < 2) return null
        const pts = Array.from({ length: n }, (_, i) =>
          `${xF(replica.frequencies[i])},${yAmp(replica.magnitude[i])}`
        )
        const baseline = AMPLITUDE_Y0 + PANEL_H
        return (
          <g key={`alias-${replica.k}`} clipPath="url(#ampClip)">
            <path
              d={`M ${xF(replica.frequencies[0])},${baseline} L ${pts.join(' L ')} L ${xF(replica.frequencies[n - 1])},${baseline} Z`}
              fill={replica.color} stroke="none" />
            <path d={`M ${pts.join(' L ')}`} fill="none"
              stroke={replica.color.replace('0.40', '0.70')} strokeWidth="1.5" />
          </g>
        )
      })}
    </g>
  )
}

// --- Utilità ---

function globalFreqRange(entries: SpectrumEntry[]): { fMin: number; fMax: number } {
  let fMin = Infinity
  let fMax = -Infinity

  for (const e of entries) {
    const s = e.spectrum
    if (s.kind === 'continuous') {
      fMin = Math.min(fMin, s.frequencies[0] ?? 0)
      fMax = Math.max(fMax, s.frequencies[s.frequencies.length - 1] ?? 0)
    } else if (s.kind === 'dirac' || s.kind === 'dft') {
      for (const f of s.frequencies) {
        fMin = Math.min(fMin, f)
        fMax = Math.max(fMax, f)
      }
      if (s.kind === 'dirac' && s.envelope) {
        fMin = Math.min(fMin, s.envelope.frequencies[0] ?? fMin)
        fMax = Math.max(fMax, s.envelope.frequencies[s.envelope.frequencies.length - 1] ?? fMax)
      }
    }
    // Tieni conto anche del range aliasing
    if (e.aliasing) {
      for (const r of e.aliasing.replicas) {
        fMin = Math.min(fMin, r.frequencies[0] ?? fMin)
        fMax = Math.max(fMax, r.frequencies[r.frequencies.length - 1] ?? fMax)
      }
    }
  }

  if (!isFinite(fMin)) fMin = -4
  if (!isFinite(fMax)) fMax = 4

  // Aggiungi margine del 5%
  const span = fMax - fMin || 1
  return { fMin: fMin - span * 0.05, fMax: fMax + span * 0.05 }
}

function extractMagnitudes(s: SpectralResult): number[] {
  if (s.kind === 'continuous') return Array.from(s.magnitude)
  return s.magnitude
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

function phaseLabel(phi: number): string {
  if (Math.abs(phi) < 0.01) return '0'
  if (Math.abs(phi - Math.PI) < 0.01) return 'π'
  if (Math.abs(phi + Math.PI) < 0.01) return '-π'
  if (Math.abs(phi - Math.PI / 2) < 0.01) return 'π/2'
  if (Math.abs(phi + Math.PI / 2) < 0.01) return '-π/2'
  return phi.toFixed(1)
}
