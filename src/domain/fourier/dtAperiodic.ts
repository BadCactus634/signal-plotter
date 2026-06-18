// Motore C — Tempo Discreto, Segnali Aperiodici (DTFT)
// X(f) = Σ_{n=-∞}^{∞} x[n] e^{-j2πfn}
// Proprietà fondamentale: X(f) è periodica di periodo 1
// Visualizzazione sull'intervallo f ∈ [-1/2, 1/2)

import { evaluateSignal, type SignalNode } from '../signals'
import type { ContinuousSpectrum } from './types'

export type DTAperiodicParams = {
  nRange?: number   // somma su n ∈ [-nRange, nRange] (default 64)
  fPoints?: number  // risoluzione in [-0.5, 0.5] (default 512)
}

export function computeDTFT(
  signal: SignalNode,
  params: DTAperiodicParams = {},
): ContinuousSpectrum {
  const nRange = params.nRange ?? 64
  const fPoints = params.fPoints ?? 512

  // Pre-campiona x[n] su tutti gli n necessari
  const nList = new Int32Array(2 * nRange + 1)
  const xList = new Float64Array(2 * nRange + 1)
  for (let i = 0; i <= 2 * nRange; i++) {
    const n = i - nRange
    nList[i] = n
    xList[i] = evaluateSignal(signal, n)
  }

  const frequencies = new Float64Array(fPoints)
  const magnitude = new Float64Array(fPoints)
  const phase = new Float64Array(fPoints)

  for (let fi = 0; fi < fPoints; fi++) {
    // f ∈ [-0.5, 0.5): include -0.5 esclude +0.5
    const f = -0.5 + fi / fPoints

    let re = 0
    let im = 0
    for (let i = 0; i < xList.length; i++) {
      const phi = -2 * Math.PI * f * nList[i]
      re += xList[i] * Math.cos(phi)
      im += xList[i] * Math.sin(phi)
    }

    frequencies[fi] = f
    magnitude[fi] = Math.sqrt(re * re + im * im)
    phase[fi] = Math.atan2(im, re)
  }

  return { kind: 'continuous', frequencies, magnitude, phase }
}
