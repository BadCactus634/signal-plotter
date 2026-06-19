// Campionamento ideale e Aliasing
// x_c(t) = x(t) · δ_{T_c}(t)  ↔  X_c(f) = f_c Σ_k X(f - k·f_c)
// Visualizzazione: repliche X(f - k·f_c) con colori semitrasparenti sovrapposti

import type { ContinuousSpectrum } from './fourier/types'

export type AliasingReplica = {
  k: number
  freqOffset: number        // k · fc
  frequencies: Float64Array // frequenze shiftate
  magnitude: Float64Array   // stessa ampiezza dello spettro base
  color: string             // colore RGBA semitrasparente
}

export type AliasingOverlay = {
  replicas: AliasingReplica[]
  fc: number
  isAliased: boolean        // true se fc < 2 * B_x (violazione Nyquist)
  bandwidth: number         // stima B_x [Hz]
}

const REPLICA_COLORS = [
  'rgba(248,113,113,0.40)',   // rosso   k=±1
  'rgba(74,222,128,0.40)',    // verde   k=±2
  'rgba(96,165,250,0.40)',    // blu     k=±3
  'rgba(251,191,36,0.40)',    // giallo  k=±4
]

export function computeAliasingOverlay(
  base: ContinuousSpectrum,
  fc: number,
  kMax = 4,
): AliasingOverlay {
  const replicas: AliasingReplica[] = []

  for (let k = -kMax; k <= kMax; k++) {
    const shiftedFreqs = new Float64Array(base.frequencies.length)
    for (let i = 0; i < base.frequencies.length; i++) {
      shiftedFreqs[i] = base.frequencies[i] + k * fc
    }

    const colorIndex = (Math.abs(k) - 1) % REPLICA_COLORS.length
    const color = k === 0 ? 'rgba(34,211,238,0.90)' : REPLICA_COLORS[Math.max(0, colorIndex)]

    replicas.push({
      k,
      freqOffset: k * fc,
      frequencies: shiftedFreqs,
      magnitude: base.magnitude,
      color,
    })
  }

  const bandwidth = estimateBandwidth(base)

  return {
    replicas,
    fc,
    isAliased: fc > 0 && fc < 2 * bandwidth,
    bandwidth,
  }
}

export function estimateBandwidth(spectrum: ContinuousSpectrum): number {
  const maxMag = Math.max(...spectrum.magnitude)
  if (maxMag === 0) return 0

  const threshold = maxMag * 0.01   // −40 dB
  let fBand = 0
  for (let i = 0; i < spectrum.frequencies.length; i++) {
    if (spectrum.magnitude[i] > threshold) {
      fBand = Math.max(fBand, Math.abs(spectrum.frequencies[i]))
    }
  }

  return fBand
}
