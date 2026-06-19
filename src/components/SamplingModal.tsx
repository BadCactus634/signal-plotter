import { useMemo, useState } from 'react'
import type { SignalNode } from '../domain/signals'
import { detectPeriod } from '../domain/signals'
import { computeCTFourier, adaptiveFRange } from '../domain/fourier/ctAperiodic'
import { estimateBandwidth } from '../domain/sampling'

export type SourceSignalInfo = {
  id: string
  label: string
  node: SignalNode
}

type Props = {
  ctSignals: SourceSignalInfo[]
  onSample: (source: SourceSignalInfo, fc: number, addDFT: boolean, dftN: number) => void
  onClose: () => void
}

export function SamplingModal({ ctSignals, onSample, onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string>(ctSignals[0]?.id ?? '')
  const [fc, setFc] = useState<number>(10)
  const [addDFT, setAddDFT] = useState(false)
  const [dftN, setDftN] = useState<number>(64)

  const selectedSignal = ctSignals.find(s => s.id === selectedId) ?? ctSignals[0] ?? null

  const { bandwidth, isAliased, suggestedFc, sampledPeriodN } = useMemo(() => {
    if (!selectedSignal) return { bandwidth: 0, isAliased: false, suggestedFc: 2, sampledPeriodN: null }
    try {
      const range = adaptiveFRange(selectedSignal.node)
      const spectrum = computeCTFourier(selectedSignal.node, { fMin: range.fMin, fMax: range.fMax })
      const bw = estimateBandwidth(spectrum)
      const suggested = Math.ceil(bw * 2 * 10) / 10 || 2
      const aliased = fc > 0 && fc < 2 * bw

      const T = detectPeriod(selectedSignal.node)
      let N: number | null = null
      if (T !== null) {
        const rawN = T * fc
        const rounded = Math.round(rawN)
        if (Math.abs(rawN - rounded) < 1e-6 && rounded >= 1) N = rounded
      }

      return { bandwidth: bw, isAliased: aliased, suggestedFc: suggested, sampledPeriodN: N }
    } catch {
      return { bandwidth: 0, isAliased: false, suggestedFc: 2, sampledPeriodN: null }
    }
  }, [selectedSignal, fc])

  const autoAnalysis = sampledPeriodN !== null ? 'DT_periodic' : 'DT_aperiodic'
  const analysisLabel = sampledPeriodN !== null
    ? `DTFT periodica (N=${sampledPeriodN})`
    : 'DTFT (aperiodica)'

  function handleSample() {
    if (!selectedSignal) return
    onSample(selectedSignal, fc, addDFT, dftN)
    onClose()
  }

  return (
    <div className="sampling-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sampling-modal">
        <div className="sampling-modal__title">campionamento</div>

        {ctSignals.length === 0 ? (
          <div className="expr-warning expr-warning--warn">
            Nessun segnale CT disponibile. Aggiungi prima un segnale in dominio temporale.
          </div>
        ) : (
          <>
            {/* Source selector */}
            <label className="compact-field">
              <span>sorgente CT</span>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                {ctSignals.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>

            {/* fc input */}
            <label className="compact-field">
              <span>frequenza di campionamento fc [Hz]</span>
              <input
                type="number"
                min={0.01}
                step={0.5}
                value={fc}
                onChange={e => setFc(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
              />
            </label>

            {/* Bandwidth info */}
            <div className="sampling-modal__info">
              {bandwidth > 0 ? (
                <>
                  <span>Banda stimata B ≈ <strong>{bandwidth.toFixed(3)} Hz</strong></span>
                  <span>Nyquist: 2B ≈ <strong>{(2 * bandwidth).toFixed(3)} Hz</strong></span>
                  {fc < suggestedFc && (
                    <button
                      type="button"
                      className="sampling-modal__suggest"
                      onClick={() => setFc(Math.ceil(suggestedFc * 10) / 10)}
                    >
                      suggerisci fc = {Math.ceil(suggestedFc * 10) / 10} Hz
                    </button>
                  )}
                </>
              ) : (
                <span className="sampling-modal__info--muted">Banda non stimabile</span>
              )}
            </div>

            {/* Aliasing warning */}
            {isAliased && (
              <div className="expr-warning expr-warning--warn">
                Aliasing: fc = {fc} Hz &lt; 2B ≈ {(2 * bandwidth).toFixed(3)} Hz — violazione di Nyquist,
                lo spettro DTFT sarà distorto
              </div>
            )}

            {/* Period detection */}
            <div className="sampling-modal__info">
              <span>Analisi automatica: <strong>{analysisLabel}</strong></span>
              {sampledPeriodN !== null && (
                <span className="sampling-modal__info--muted">
                  Il segnale sorgente è periodico, campionato con periodo N = {sampledPeriodN}
                </span>
              )}
            </div>

            {/* DFT toggle */}
            <label className="compact-toggle">
              <span>aggiungi anche analisi DFT separata</span>
              <input type="checkbox" checked={addDFT} onChange={e => setAddDFT(e.target.checked)} />
            </label>

            {addDFT && (
              <div className="sampling-modal__info">
                <label className="compact-field">
                  <span>punti DFT (N)</span>
                  <input
                    type="number"
                    min={4}
                    step={4}
                    value={dftN}
                    onChange={e => setDftN(Math.max(4, Math.round(parseFloat(e.target.value) || 64)))}
                  />
                </label>
                <span className="sampling-modal__info--muted">
                  La DFT è calcolata su un periodo di N campioni del segnale discreto x[0..N−1].
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="drawer__actions">
              <button
                type="button"
                className="topbar__button topbar__button--active"
                onClick={handleSample}
                disabled={!selectedSignal}
              >
                campiona
              </button>
              <button type="button" className="topbar__button" onClick={onClose}>
                annulla
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
