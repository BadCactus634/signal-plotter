// Motore B — Tempo Continuo, Segnali Periodici
// Serie di Fourier: X_k = (1/T) ∫₀ᵀ p(t) e^{-j2π(k/T)t} dt
// Spettro di Fourier (Poisson): X(f) = Σ_k X_k δ(f - k/T)
// Inviluppo: (1/T) P(f) dove P(f) = TF dell'impulso generatore p(t)

import { evaluateSignal, type SignalNode } from '../signals'
import { computeCTFourier } from './ctAperiodic'
import type { DiracSpectrum } from './types'

export type CTPeriodicParams = {
  kMax?: number     // massimo indice armonico (default 15)
  nInteg?: number   // punti di integrazione per periodo (default 2048)
}

export function computeFourierSeries(
  prototype: SignalNode,
  T: number,
  params: CTPeriodicParams = {},
): DiracSpectrum {
  const kMax = params.kMax ?? 15
  const nInteg = params.nInteg ?? 2048
  const dt = T / nInteg

  // Pre-campiona p(t) su [0, T)
  const pt = new Float64Array(nInteg)
  for (let n = 0; n < nInteg; n++) {
    pt[n] = evaluateSignal(prototype, n * dt)
  }

  const kList: number[] = []
  const freqList: number[] = []
  const magList: number[] = []
  const phaseList: number[] = []

  for (let ki = -kMax; ki <= kMax; ki++) {
    kList.push(ki)
    freqList.push(ki / T)

    let re = 0
    let im = 0
    for (let n = 0; n < nInteg; n++) {
      const phi = -2 * Math.PI * ki * n * dt / T
      // Peso trapezoidale
      const w = n === 0 || n === nInteg - 1 ? 0.5 : 1.0
      re += pt[n] * Math.cos(phi) * w * dt / T
      im += pt[n] * Math.sin(phi) * w * dt / T
    }

    magList.push(Math.sqrt(re * re + im * im))
    phaseList.push(Math.atan2(im, re))
  }

  // Inviluppo continuo: (1/T) · P(f) dalla relazione di Poisson
  // Calcoliamo P(f) con il Motore A sull'impulso generatore p(t)
  const fEnvMax = (kMax + 3) / T
  const envSpectrum = computeCTFourier(prototype, {
    tRange: T * 3,
    tPoints: 2048,
    fMin: -fEnvMax,
    fMax: fEnvMax,
    fPoints: 600,
  })

  // Scala per 1/T (relazione di Poisson)
  const envelopeMag = new Float64Array(envSpectrum.magnitude.length)
  for (let i = 0; i < envSpectrum.magnitude.length; i++) {
    envelopeMag[i] = envSpectrum.magnitude[i] / T
  }

  return {
    kind: 'dirac',
    T,
    k: kList,
    frequencies: freqList,
    magnitude: magList,
    phase: phaseList,
    envelope: {
      frequencies: envSpectrum.frequencies,
      magnitude: envelopeMag,
    },
  }
}
