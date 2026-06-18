// Fenomeno di Gibbs — ricostruzione parziale della Serie di Fourier
// x̂_N(t) = Σ_{k=-N}^{N} X_k e^{j2π(k/T)t}
// Dimostra che l'overshoot ~9% persiste e si restringe all'aumentare di N

import type { SignalNode, SignalSample } from './signals'
import { computeFourierSeries } from './fourier/ctPeriodic'

export type GibbsResult = {
  samples: SignalSample[]
  overshot: number    // ampiezza massima sovraelongazione normalizzata (0–1)
  nHarmonics: number
}

export function computeGibbsReconstruction(
  prototype: SignalNode,
  T: number,
  nHarmonics: number,
  tRange?: number,
  tPoints?: number,
): GibbsResult {
  const range = tRange ?? T * 2
  const points = tPoints ?? 600

  const series = computeFourierSeries(prototype, T, { kMax: nHarmonics })

  const samples: SignalSample[] = []
  const dt = (2 * range) / (points - 1)

  for (let i = 0; i < points; i++) {
    const ti = -range + i * dt
    let y = 0

    for (let ki = 0; ki < series.k.length; ki++) {
      const k = series.k[ki]
      if (Math.abs(k) > nHarmonics) continue
      const phi = 2 * Math.PI * k * ti / T
      // X_k * e^{j2π(k/T)t} → parte reale = |X_k| cos(∠X_k + 2π(k/T)t)
      y += series.magnitude[ki] * Math.cos(series.phase[ki] + phi)
    }

    samples.push({ x: ti, y })
  }

  // Stima overshoot: confronta il picco ricostruito con il valore atteso (1 per onda quadra)
  const peak = Math.max(...samples.map(s => s.y))
  const idealMax = series.magnitude.reduce((sum, m, i) => {
    return Math.abs(series.k[i]) === 0 ? sum + m : sum
  }, series.magnitude[series.k.indexOf(0)] ?? 1)

  const overshot = Math.max(0, peak - (idealMax > 0 ? idealMax : 1))

  return { samples, overshot, nHarmonics }
}
