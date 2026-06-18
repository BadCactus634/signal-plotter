// Compatibilità backward: delega al Motore A (CT aperiodico)
// Il vecchio computeSpectrum(node) restituisce magnitude per i primi 49 bin

import { type SignalNode } from './signals'
import { computeCTFourier, adaptiveFRange } from './fourier/ctAperiodic'

export function computeSpectrum(node: SignalNode): Array<{ frequency: number; magnitude: number }> {
  const { fMin, fMax } = adaptiveFRange(node)
  const result = computeCTFourier(node, { fMin: 0, fMax: Math.max(Math.abs(fMin), Math.abs(fMax)), fPoints: 49 })

  return Array.from(result.frequencies).map((f, i) => ({
    frequency: f,
    magnitude: result.magnitude[i],
  }))
}

export function summarizeAliasing(node: SignalNode): string {
  const { fMin, fMax } = adaptiveFRange(node)
  const bandWidth = Math.max(Math.abs(fMin), Math.abs(fMax))
  if (bandWidth > 8) {
    return 'Segnale ad alta banda: valuta la frequenza di campionamento per evitare aliasing.'
  }
  return 'Campionamento apparentemente sufficiente per una visualizzazione qualitativa.'
}
