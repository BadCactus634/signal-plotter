// Motore D — Tempo Discreto, Segnali Periodici (DTFT con delta periodiche)
// Per x[n] periodico di periodo N, la DTFT è:
// X(f) = Σ_k X_k δ(f - k/N)
// dove X_k = Σ_{n=0}^{N-1} x[n] e^{-j2πkn/N}  (DFT normalizzata: diviso N)

import { evaluateSignal, type SignalNode } from '../signals'
import type { DiracSpectrum } from './types'

export function computeDTPeriodic(
  signal: SignalNode,
  N: number,
): DiracSpectrum {
  // Campiona un periodo completo x[0..N-1]
  const x = new Float64Array(N)
  for (let n = 0; n < N; n++) {
    x[n] = evaluateSignal(signal, n)
  }

  const kList: number[] = []
  const freqList: number[] = []
  const magList: number[] = []
  const phaseList: number[] = []

  // Calcolo diretto DFT — coefficienti normalizzati per 1/N
  for (let k = 0; k < N; k++) {
    let re = 0
    let im = 0
    for (let n = 0; n < N; n++) {
      const phi = -2 * Math.PI * k * n / N
      re += x[n] * Math.cos(phi)
      im += x[n] * Math.sin(phi)
    }
    re /= N
    im /= N

    kList.push(k)
    // Centra in [-0.5, 0.5): k ≥ N/2 → k - N
    const kCentered = k < N / 2 ? k : k - N
    freqList.push(kCentered / N)
    magList.push(Math.sqrt(re * re + im * im))
    phaseList.push(Math.atan2(im, re))
  }

  // Riordina per frequenza crescente
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => freqList[a] - freqList[b])
  return {
    kind: 'dirac',
    T: N,
    k: order.map(i => kList[i]),
    frequencies: order.map(i => freqList[i]),
    magnitude: order.map(i => magList[i]),
    phase: order.map(i => phaseList[i]),
  }
}
