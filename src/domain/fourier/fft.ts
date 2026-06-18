import type { Complex } from './types'

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// Cooley-Tukey radix-2 DIT FFT (iterativo, in-place)
export function fft(x: number[]): Complex[] {
  const N = x.length
  const M = nextPow2(N)

  const re = new Float64Array(M)
  const im = new Float64Array(M)
  for (let i = 0; i < N; i++) re[i] = x[i]

  // Bit-reversal permutation
  let j = 0
  for (let i = 1; i < M; i++) {
    let bit = M >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp
      tmp = im[i]; im[i] = im[j]; im[j] = tmp
    }
  }

  // Butterfly passes
  for (let len = 2; len <= M; len <<= 1) {
    const half = len >> 1
    const ang = -2 * Math.PI / len
    const wBaseRe = Math.cos(ang)
    const wBaseIm = Math.sin(ang)

    for (let i = 0; i < M; i += len) {
      let wRe = 1
      let wIm = 0
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const tRe = wRe * re[i + k + half] - wIm * im[i + k + half]
        const tIm = wRe * im[i + k + half] + wIm * re[i + k + half]
        re[i + k] = uRe + tRe
        im[i + k] = uIm + tIm
        re[i + k + half] = uRe - tRe
        im[i + k + half] = uIm - tIm
        const nextWRe = wRe * wBaseRe - wIm * wBaseIm
        wIm = wRe * wBaseIm + wIm * wBaseRe
        wRe = nextWRe
      }
    }
  }

  return Array.from({ length: M }, (_, i) => ({ re: re[i], im: im[i] }))
}

// IFFT tramite: IFFT(X) = conj(FFT(conj(X))) / N
export function ifft(X: Complex[]): Complex[] {
  const N = X.length
  // Coniugato dell'ingresso
  const xConj = X.map(c => c.im)
  const xConjRe = X.map(c => c.re)
  // Usiamo FFT su parte reale=Re(X), immaginaria=-Im(X)
  const M = nextPow2(N)
  const re = new Float64Array(M)
  const im = new Float64Array(M)
  for (let i = 0; i < N; i++) { re[i] = xConjRe[i]; im[i] = -xConj[i] }

  // Stessa FFT ma su array di numeri: ricostuiamo via fft()
  const realPart = Array.from(re)
  const Y = fftComplex(realPart, Array.from(im))

  return Y.map(c => ({ re: c.re / M, im: -c.im / M }))
}

// Versione FFT che accetta parte reale + immaginaria separati
function fftComplex(xRe: number[], xIm: number[]): Complex[] {
  const N = Math.max(xRe.length, xIm.length)
  const M = nextPow2(N)
  const re = new Float64Array(M)
  const im = new Float64Array(M)
  for (let i = 0; i < xRe.length; i++) re[i] = xRe[i]
  for (let i = 0; i < xIm.length; i++) im[i] = xIm[i]

  let j = 0
  for (let i = 1; i < M; i++) {
    let bit = M >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp
      tmp = im[i]; im[i] = im[j]; im[j] = tmp
    }
  }

  for (let len = 2; len <= M; len <<= 1) {
    const half = len >> 1
    const ang = -2 * Math.PI / len
    const wBaseRe = Math.cos(ang)
    const wBaseIm = Math.sin(ang)
    for (let i = 0; i < M; i += len) {
      let wRe = 1, wIm = 0
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k], uIm = im[i + k]
        const tRe = wRe * re[i + k + half] - wIm * im[i + k + half]
        const tIm = wRe * im[i + k + half] + wIm * re[i + k + half]
        re[i + k] = uRe + tRe; im[i + k] = uIm + tIm
        re[i + k + half] = uRe - tRe; im[i + k + half] = uIm - tIm
        const nextWRe = wRe * wBaseRe - wIm * wBaseIm
        wIm = wRe * wBaseIm + wIm * wBaseRe
        wRe = nextWRe
      }
    }
  }

  return Array.from({ length: M }, (_, i) => ({ re: re[i], im: im[i] }))
}
