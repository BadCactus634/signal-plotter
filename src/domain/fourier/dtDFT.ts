// Motore E — Tempo Discreto, Segnali a durata finita (DFT N-point)
// X[k] = Σ_{n=0}^{N-1} x[n] e^{-j2πkn/N},  k = 0, ..., N-1
// Implementato via FFT Cooley-Tukey per efficienza O(N log N)
// Lega esplicitamente i campioni della DFT alla DTFT: X[k] = X_DTFT(k/N)

import { evaluateSignal, type SignalNode } from '../signals'
import { fft, nextPow2 } from './fft'
import type { DFTSpectrum } from './types'

export type DTDFTParams = {
  N?: number       // numero di punti DFT (default 64, arrotondato a potenza di 2)
  nStart?: number  // indice di partenza per il campionamento (default 0)
}

export function computeDFT(
  signal: SignalNode,
  params: DTDFTParams = {},
): DFTSpectrum {
  const Nreq = params.N ?? 64
  const nStart = params.nStart ?? 0
  // Lavoriamo con esattamente Nreq campioni; la FFT zero-padda internamente alla potenza di 2
  const N = Nreq

  // Campiona il segnale su [nStart, nStart + N - 1]
  const x: number[] = []
  for (let n = 0; n < N; n++) {
    x.push(evaluateSignal(signal, nStart + n))
  }

  const X = fft(x)
  const M = nextPow2(N)  // dimensione effettiva dopo zero-padding

  // Estrai solo i primi N bin (corrispondenti a k/N, k = 0..N-1)
  // La FFT ha M punti, prendiamo i primi N
  const kList: number[] = []
  const freqList: number[] = []
  const magList: number[] = []
  const phaseList: number[] = []

  for (let k = 0; k < Math.min(N, M); k++) {
    kList.push(k)
    freqList.push(k / N)  // frequenza normalizzata k/N ∈ [0, 1)
    magList.push(Math.sqrt(X[k].re * X[k].re + X[k].im * X[k].im))
    phaseList.push(Math.atan2(X[k].im, X[k].re))
  }

  return {
    kind: 'dft',
    N,
    k: kList,
    frequencies: freqList,
    magnitude: magList,
    phase: phaseList,
  }
}
