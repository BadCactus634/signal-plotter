// Motore A — Tempo Continuo, Segnali Aperiodici
// X(f) = ∫_{-∞}^{∞} x(t) e^{-j2πft} dt
// Approssimazione numerica con regola dei trapezi su intervallo finito [-tRange, tRange]

import { evaluateSignal, type SignalNode } from '../signals'
import type { ContinuousSpectrum } from './types'

export type CTAperiodicParams = {
  tRange?: number   // default 8
  tPoints?: number  // default 2048
  fMin?: number     // default -8
  fMax?: number     // default 8
  fPoints?: number  // default 512
}

export function computeCTFourier(
  signal: SignalNode,
  params: CTAperiodicParams = {},
): ContinuousSpectrum {
  const tRange = params.tRange ?? 8
  const tPoints = params.tPoints ?? 2048
  const fMin = params.fMin ?? -8
  const fMax = params.fMax ?? 8
  const fPoints = params.fPoints ?? 512

  const dt = (2 * tRange) / (tPoints - 1)

  // Pre-campiona x(t) una sola volta
  const t = new Float64Array(tPoints)
  const x = new Float64Array(tPoints)
  for (let i = 0; i < tPoints; i++) {
    t[i] = -tRange + i * dt
    x[i] = evaluateSignal(signal, t[i])
  }

  const df = (fMax - fMin) / (fPoints - 1)
  const magnitude = new Float64Array(fPoints)
  const phase = new Float64Array(fPoints)
  const frequencies = new Float64Array(fPoints)

  for (let fi = 0; fi < fPoints; fi++) {
    const f = fMin + fi * df
    frequencies[fi] = f

    let re = 0
    let im = 0
    for (let n = 0; n < tPoints; n++) {
      const phi = -2 * Math.PI * f * t[n]
      // Peso trapezoidale: 0.5 agli estremi
      const w = n === 0 || n === tPoints - 1 ? 0.5 : 1.0
      re += x[n] * Math.cos(phi) * w * dt
      im += x[n] * Math.sin(phi) * w * dt
    }

    magnitude[fi] = Math.sqrt(re * re + im * im)
    phase[fi] = Math.atan2(im, re)
  }

  return { kind: 'continuous', frequencies, magnitude, phase }
}

// Stima adattiva dei limiti di frequenza osservando dove lo spettro decade
export function adaptiveFRange(signal: SignalNode, tRange = 8): { fMin: number; fMax: number } {
  // Prima passata grossolana con pochi punti per trovare la banda significativa
  const coarse = computeCTFourier(signal, { tRange, tPoints: 512, fMin: -20, fMax: 20, fPoints: 200 })
  const maxMag = Math.max(...coarse.magnitude)
  const threshold = maxMag * 0.005

  let fBand = 2.0
  for (let i = 0; i < coarse.frequencies.length; i++) {
    if (coarse.magnitude[i] > threshold) {
      fBand = Math.max(fBand, Math.abs(coarse.frequencies[i]))
    }
  }

  const margin = Math.max(fBand * 1.4, 1.5)
  return { fMin: -margin, fMax: margin }
}
