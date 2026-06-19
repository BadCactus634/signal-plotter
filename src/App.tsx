import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ExpressionTextarea, type ExpressionTextareaHandle } from './components/ExpressionTextarea'
import { SignalInfoCard } from './components/SignalInfoCard'
import { SignalPlot, type DFTWindowMarker } from './components/SignalPlot'
import { SpectrumPlot } from './components/SpectrumPlot'
import {
  detectPeriod,
  estimateSignalStats,
  evaluateSignal,
  makeExampleSignals,
  normalizeSignalInput,
  parseSignalExpression,
  sampleSignal,
  type SignalNode,
  type SignalSample,
  type SignalStats,
  type ViewMode,
} from './domain/signals'
import type { AnalysisMode, AnalysisParams, SpectralResult } from './domain/fourier/types'
import { computeCTFourier, adaptiveFRange } from './domain/fourier/ctAperiodic'
import { computeFourierSeries } from './domain/fourier/ctPeriodic'
import { computeDTFT } from './domain/fourier/dtAperiodic'
import { computeDTPeriodic } from './domain/fourier/dtPeriodic'
import { computeDFT } from './domain/fourier/dtDFT'
import { computeGibbsReconstruction } from './domain/gibbs'
import { computeAliasingOverlay, estimateBandwidth, type AliasingOverlay } from './domain/sampling'
import { useStoredState } from './lib/persistence'
import { SamplingModal, type SourceSignalInfo } from './components/SamplingModal'
import './App.css'

// ─── Tipi ────────────────────────────────────────────────────────────────────

type StudySignal = {
  id: string
  label: string
  expression: string
  mode: ViewMode
  visible: boolean
  showInfo: boolean
  node: SignalNode
  analysisMode: AnalysisMode
  analysisParams: AnalysisParams
}

type StudySettings = {
  showGrid: boolean
  showLegend: boolean
  showTooltip: boolean
  showPhase: boolean
  showSpectrumEnvelope: boolean
  samplingRate: number  // kept for localStorage compat, not shown in UI
}

type StudyState = {
  activeTab: ViewMode | 'settings'
  settings: StudySettings
  signals: StudySignal[]
}

type SignalDraft = {
  label: string
  expression: string
  mode: ViewMode
  analysisMode: AnalysisMode
  analysisParams: AnalysisParams
}

type RenderedSignal = StudySignal & {
  stats: SignalStats
  color: string
}

type PlotSignal = {
  id: string
  label: string
  node: SignalNode
  color: string
  preview?: boolean
  stats?: SignalStats
}

const PALETTE = ['#22d3ee', '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb7185']

const CT_ANALYSIS_MODES: AnalysisMode[] = ['CT_aperiodic', 'CT_periodic']
const DT_ANALYSIS_MODES: AnalysisMode[] = ['DT_aperiodic', 'DT_periodic', 'DT_DFT']

const ANALYSIS_MODE_LABELS: Record<AnalysisMode, string> = {
  CT_aperiodic: 'TF (aperiodico)',
  CT_periodic: 'Serie FS (periodico)',
  DT_aperiodic: 'DTFT (aperiodico)',
  DT_periodic: 'DTFT (periodico)',
  DT_DFT: 'DFT N-point',
}

// Static sinc for settings tab preview
const SETTINGS_PREVIEW_RESULT = parseSignalExpression('sinc(t)')
const SETTINGS_PREVIEW_SIGNALS: PlotSignal[] = SETTINGS_PREVIEW_RESULT.ok
  ? [{ id: 'settings-sinc', label: 'sinc(t)', node: SETTINGS_PREVIEW_RESULT.signal, color: '#22d3ee' }]
  : []

// ─── Variable substitution ────────────────────────────────────────────────────

function swapVariable(expr: string, from: 't' | 'n', to: 't' | 'n'): string {
  return expr.replace(new RegExp(`(?<![a-zA-Z_0-9])${from}(?![a-zA-Z_0-9])`, 'g'), to)
}

// ─── Dynamic quick examples ───────────────────────────────────────────────────

type QuickExDef = { label: string; expression: string; mode: ViewMode; analysisMode: AnalysisMode; params?: AnalysisParams }

function getQuickExamples(mode: ViewMode): QuickExDef[] {
  const v = mode === 'discrete' ? 'n' : 't'
  const isDisc = mode === 'discrete'
  const base: QuickExDef[] = [
    { label: `sin(2π${v})`, expression: `sin(2π${v})`, mode, analysisMode: isDisc ? 'DT_aperiodic' : 'CT_periodic', params: isDisc ? undefined : { period: 1 } },
    { label: `cos(2π${v})`, expression: `cos(2π${v})`, mode, analysisMode: isDisc ? 'DT_aperiodic' : 'CT_periodic', params: isDisc ? undefined : { period: 1 } },
    { label: `rect(${v})`,  expression: `rect(${v})`,  mode, analysisMode: isDisc ? 'DT_aperiodic' : 'CT_aperiodic' },
    { label: `ε(${v})`,     expression: `step(${v})`,  mode, analysisMode: isDisc ? 'DT_aperiodic' : 'CT_aperiodic' },
    { label: `δ(${v})`,     expression: `delta(${v})`, mode, analysisMode: isDisc ? 'DT_aperiodic' : 'CT_aperiodic' },
  ]
  const ctOnly: QuickExDef[] = !isDisc ? [
    { label: 'tri(t)',    expression: 'tri(t)',            mode: 'time', analysisMode: 'CT_aperiodic' },
    { label: 'sinc(t)',   expression: 'sinc(t)',           mode: 'time', analysisMode: 'CT_aperiodic' },
    { label: 'sgn(t)',    expression: 'sgn(t)',            mode: 'time', analysisMode: 'CT_aperiodic' },
    { label: 'onda sq.',  expression: 'sgn(sin(2πt))',    mode: 'time', analysisMode: 'CT_periodic', params: { period: 1, kMax: 15 } },
  ] : []
  const dtOnly: QuickExDef[] = isDisc ? [
    { label: '0.8ⁿε[n]', expression: '0.8^n step(n)', mode: 'discrete', analysisMode: 'DT_aperiodic' },
    { label: 'rect₈[n]',  expression: 'rect_N(8)',     mode: 'discrete', analysisMode: 'DT_aperiodic' },
  ] : []
  return [...base, ...ctOnly, ...dtOnly]
}

// ─── Componente principale ───────────────────────────────────────────────────

function App() {
  const [studyState, setStudyState] = useStoredState<StudyState>('signal-plotter-study-state-v4', createInitialState())
  const [menuOpen, setMenuOpen] = useState(true)
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null)
  const [signalDraft, setSignalDraft] = useState<SignalDraft>(createEmptyDraft())
  const [samplingOpen, setSamplingOpen] = useState(false)
  const exprRef = useRef<ExpressionTextareaHandle>(null)

  const renderedSignals = useMemo<RenderedSignal[]>(
    () => studyState.signals.map((signal, index) => ({
      ...signal,
      stats: computeStats(signal.node, signal.mode),
      color: PALETTE[index % PALETTE.length],
    })),
    [studyState.signals],
  )

  const isFrequencyTab = studyState.activeTab === 'frequency'
  const isSettingsTab = studyState.activeTab === 'settings'
  const chartMode: ViewMode = studyState.activeTab === 'discrete' ? 'discrete' : 'time'

  const chartSignals = renderedSignals.filter(s => s.visible && s.mode === chartMode)
  const allVisibleSignals = renderedSignals.filter(s => s.visible)

  const chartYRange = useMemo(() => {
    if (isFrequencyTab || isSettingsTab) return null
    const allModeSignals = renderedSignals.filter(s => s.mode === chartMode && s.visible)
    if (allModeSignals.length === 0) return null
    let yMin = -0.5, yMax = 0.5
    for (const sig of allModeSignals) {
      yMin = Math.min(yMin, sig.stats.min)
      yMax = Math.max(yMax, sig.stats.max)
    }
    const pad = (yMax - yMin) * 0.08
    return { min: yMin - pad, max: yMax + pad }
  }, [renderedSignals, chartMode, isFrequencyTab, isSettingsTab])

  const gibbsOverlay = useMemo<SignalSample[]>(() => {
    if (isFrequencyTab || isSettingsTab) return []
    const editSig = editingSignalId ? renderedSignals.find(s => s.id === editingSignalId) : null
    const gibbsSig = editSig ?? renderedSignals.find(s =>
      s.analysisMode === 'CT_periodic' && s.analysisParams.gibbsEnabled && s.visible
    )
    if (!gibbsSig || gibbsSig.analysisMode !== 'CT_periodic') return []
    const { gibbsEnabled, gibbsHarmonics, period } = gibbsSig.analysisParams
    if (!gibbsEnabled || !period) return []
    try {
      return computeGibbsReconstruction(gibbsSig.node, period, gibbsHarmonics ?? 5).samples
    } catch { return [] }
  }, [isFrequencyTab, isSettingsTab, editingSignalId, renderedSignals])

  const spectrumZoomKey = studyState.signals.map(s => s.id).join(',')

  const dftWindows = useMemo<DFTWindowMarker[]>(() => {
    if (isFrequencyTab || isSettingsTab || chartMode !== 'discrete') return []
    return chartSignals
      .filter(s => s.analysisMode === 'DT_DFT')
      .map(s => ({
        signalId: s.id,
        N: s.analysisParams.dftN ?? 64,
        startN: 0,
        node: s.node,
        color: s.color,
      }))
  }, [isFrequencyTab, isSettingsTab, chartMode, chartSignals])

  const allSpectralEntries = useMemo(() => {
    if (!isFrequencyTab) return []
    return renderedSignals.flatMap(sig => {
      try {
        const spectrum = computeSpectrum(sig.node, sig.analysisMode, sig.analysisParams)
        if (!spectrum) return []
        return [{ id: sig.id, label: sig.label, color: sig.color, spectrum, aliasing: undefined as AliasingOverlay | undefined, dtAliasingWarning: undefined as string | undefined, nodeKind: sig.node.kind, analysisMode: sig.analysisMode }]
      } catch { return [] }
    })
  }, [isFrequencyTab, renderedSignals])

  const spectralEntries = useMemo(() => {
    return allSpectralEntries
      .filter(e => allVisibleSignals.some(s => s.id === e.id))
      .map(e => {
        const sig = allVisibleSignals.find(s => s.id === e.id)!
        let aliasing: AliasingOverlay | undefined
        let dtAliasingWarning: string | undefined
        if (sig.analysisMode === 'CT_aperiodic' && sig.analysisParams.samplingFc && e.spectrum.kind === 'continuous') {
          aliasing = computeAliasingOverlay(e.spectrum, sig.analysisParams.samplingFc)
        }
        const isDT = sig.analysisMode === 'DT_aperiodic' || sig.analysisMode === 'DT_periodic' || sig.analysisMode === 'DT_DFT'
        if (isDT && sig.node.kind === 'sampled') {
          try {
            const { fMin, fMax } = adaptiveFRange(sig.node.source)
            const srcSpectrum = computeCTFourier(sig.node.source, { fMin, fMax })
            const bw = estimateBandwidth(srcSpectrum)
            if (bw > 0 && sig.node.fc < 2 * bw) {
              dtAliasingWarning = `Aliasing: fc = ${sig.node.fc} Hz < 2B ≈ ${(2 * bw).toFixed(3)} Hz — lo spettro DTFT è distorto`
            }
          } catch { /* ignore */ }
        }
        return { ...e, aliasing, dtAliasingWarning }
      })
  }, [allSpectralEntries, allVisibleSignals])

  const freqLabel = spectralEntries.some(e =>
    e.analysisMode === 'DT_aperiodic' || e.analysisMode === 'DT_periodic' || e.analysisMode === 'DT_DFT'
  ) ? 'f (normalizzata)' : 'f [Hz]'

  const hasExpression = signalDraft.expression.trim() !== ''
  const editorPreview = hasExpression
    ? parseSignalExpression(normalizeSignalInput(signalDraft.expression))
    : null
  const previewSignal: PlotSignal | null = editorPreview?.ok
    ? { id: 'preview', label: 'anteprima', node: editorPreview.signal, color: '#9ca3af', preview: true }
    : null

  const editingSignal = editingSignalId
    ? studyState.signals.find(s => s.id === editingSignalId) ?? null
    : null

  const draftIsModified = editingSignal !== null && (
    signalDraft.expression !== editingSignal.expression ||
    signalDraft.label !== editingSignal.label ||
    signalDraft.mode !== editingSignal.mode ||
    signalDraft.analysisMode !== editingSignal.analysisMode ||
    JSON.stringify(signalDraft.analysisParams) !== JSON.stringify(editingSignal.analysisParams)
  )

  // Expression warnings: variable mismatch + DT aliasing
  const expressionWarning = useMemo<{ kind: 'error' | 'warning'; msg: string } | null>(() => {
    if (!hasExpression) return null
    const norm = normalizeSignalInput(signalDraft.expression)
    if (signalDraft.mode === 'time' && /(?<![a-zA-Z_0-9])n(?![a-zA-Z_0-9])/.test(norm)) {
      return { kind: 'error', msg: "Variabile 'n' non valida in segnale CT — usa 't'" }
    }
    if (signalDraft.mode === 'discrete' && /(?<![a-zA-Z_0-9])t(?![a-zA-Z_0-9])/.test(norm)) {
      return { kind: 'error', msg: "Variabile 't' non valida in segnale DT — usa 'n'" }
    }
    if (signalDraft.mode === 'discrete' && editorPreview?.ok) {
      let zeros = 0
      const total = 13
      for (let n = -6; n <= 6; n++) {
        if (Math.abs(evaluateSignal(editorPreview.signal, n)) < 0.01) zeros++
      }
      if (zeros === total) {
        return { kind: 'warning', msg: 'Tutti i campioni interi sono 0 — possibile aliasing (es. sin(2πn)=0 per n∈ℤ)' }
      }
    }
    return null
  }, [hasExpression, signalDraft.mode, signalDraft.expression, editorPreview])

  const showPreview = previewSignal && !isFrequencyTab && !isSettingsTab && signalDraft.mode === chartMode
  const plotSignals: PlotSignal[] = [
    ...chartSignals.map(s => ({ id: s.id, label: s.label, node: s.node, color: s.color, stats: s.stats })),
    ...(showPreview ? [previewSignal] : []),
  ]

  const availableAnalysisModes = signalDraft.mode === 'time' ? CT_ANALYSIS_MODES : DT_ANALYSIS_MODES
  const quickExamples = getQuickExamples(signalDraft.mode)

  return (
    <main className="app-shell">
      {samplingOpen && (
        <SamplingModal
          ctSignals={renderedSignals
            .filter(s => s.mode === 'time')
            .map(s => ({ id: s.id, label: s.label, node: s.node }))}
          onSample={handleSample}
          onClose={() => setSamplingOpen(false)}
        />
      )}

      <header className="topbar">
        <div className="topbar__group">
          <button type="button" className="topbar__button" onClick={() => setMenuOpen(v => !v)}>
            {menuOpen ? 'nascondi' : 'menu'}
          </button>
          <button type="button" className="topbar__button" onClick={() => setSamplingOpen(true)}>
            campiona
          </button>
          {(['time', 'discrete', 'frequency', 'settings'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              className={studyState.activeTab === tab ? 'topbar__button topbar__button--active' : 'topbar__button'}
              onClick={() => setStudyState({ ...studyState, activeTab: tab })}
            >
              {tab === 'time' ? 'Tempo Cont.' : tab === 'discrete' ? 'Tempo Disc.' : tab === 'frequency' ? 'Spettro' : 'Settings'}
            </button>
          ))}
        </div>
      </header>

      <section className={menuOpen ? 'workspace workspace--open' : 'workspace workspace--closed'}>
        <section className="chart-pane">
          <div className="chart-stage">
            {isSettingsTab ? (
              <SignalPlot
                mode="time"
                signals={SETTINGS_PREVIEW_SIGNALS}
                showGrid={studyState.settings.showGrid}
                showTooltip={studyState.settings.showTooltip}
                showLegend={studyState.settings.showLegend}
              />
            ) : isFrequencyTab ? (
              <SpectrumPlot
                entries={spectralEntries}
                frequencyLabel={freqLabel}
                showPhase={studyState.settings.showPhase}
                showTooltip={studyState.settings.showTooltip}
                showEnvelope={studyState.settings.showSpectrumEnvelope}
                zoomKey={spectrumZoomKey}
              />
            ) : (
              <SignalPlot
                mode={studyState.activeTab === 'discrete' ? 'discrete' : 'time'}
                signals={plotSignals}
                gibbsOverlay={gibbsOverlay.length > 0 ? gibbsOverlay : undefined}
                showGrid={studyState.settings.showGrid}
                showTooltip={studyState.settings.showTooltip}
                showLegend={studyState.settings.showLegend}
                yRange={chartYRange ?? undefined}
                dftWindows={dftWindows.length > 0 ? dftWindows : undefined}
              />
            )}
          </div>

          <div className="legend-strip">
            {(isFrequencyTab ? allVisibleSignals : isSettingsTab ? [] : chartSignals).length > 0 ? (
              (isFrequencyTab ? allVisibleSignals : chartSignals).map(signal => (
                <div key={signal.id} className="legend-item">
                  <button type="button" className="legend-item__edit" onClick={() => startEditing(signal)}>
                    <span className="legend-item__swatch" style={{ backgroundColor: signal.color }} />
                    <span className="legend-item__label">{signal.label}</span>
                    {isFrequencyTab && (
                      <span className="legend-item__tag">{ANALYSIS_MODE_LABELS[signal.analysisMode]}</span>
                    )}
                  </button>
                  <button type="button" className="legend-item__action" onClick={() => startEditing(signal)}>edit</button>
                  <button type="button" className="legend-item__action legend-item__action--danger" onClick={() => deleteSignal(signal.id)}>del</button>
                </div>
              ))
            ) : (
              <span className="legend-empty">{isSettingsTab ? 'settings' : 'nessun segnale visibile'}</span>
            )}
          </div>
        </section>

        <aside className="drawer">
          {studyState.activeTab === 'settings' ? (
            <div className="drawer__stack">
              <CompactFieldGroup label="visualizzazione" content={
                <div className="drawer__grid">
                  <CompactToggle label="grid"
                    checked={studyState.settings.showGrid}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showGrid: c } })} />
                  <CompactToggle label="legenda"
                    checked={studyState.settings.showLegend}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showLegend: c } })} />
                  <CompactToggle label="tooltip"
                    checked={studyState.settings.showTooltip}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showTooltip: c } })} />
                  <CompactToggle label="fase"
                    checked={studyState.settings.showPhase}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showPhase: c } })} />
                  <CompactToggle label="inviluppo spettro"
                    checked={studyState.settings.showSpectrumEnvelope}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showSpectrumEnvelope: c } })} />
                </div>
              } />
            </div>
          ) : (
            <div className="drawer__stack">
              {/* ── Editor segnale ── */}
              <CompactFieldGroup label={editingSignal ? `modifica: ${editingSignal.label}` : 'nuovo segnale'} content={
                editingSignal?.node.kind === 'sampled' ? (
                  <div className="drawer__stack drawer__stack--tight">
                    <div className="expr-warning" style={{ borderColor: '#64748b', background: 'rgba(100,116,139,0.08)', color: '#94a3b8' }}>
                      Segnale campionato a fc = <strong style={{ color: '#e2e8f0' }}>{(editingSignal.node as Extract<SignalNode, { kind: 'sampled' }>).fc} Hz</strong>.
                      Per modificare, elimina e ricrea dalla finestra "campiona".
                    </div>
                    <CompactText label="label" value={signalDraft.label}
                      onChange={v => setSignalDraft({ ...signalDraft, label: v.slice(0, 30) })} />
                    <div className="drawer__actions">
                      <button type="button" className="topbar__button topbar__button--active"
                        onClick={() => {
                          setStudyState({
                            ...studyState,
                            signals: studyState.signals.map(s =>
                              s.id === editingSignalId ? { ...s, label: signalDraft.label.trim() || s.label } : s
                            ),
                          })
                          cancelEditing()
                        }}>
                        aggiorna
                      </button>
                      <button type="button" className="topbar__button" onClick={cancelEditing}>annulla</button>
                    </div>
                  </div>
                ) : (
                <div className="drawer__stack drawer__stack--tight">
                  <CompactText label="label" value={signalDraft.label}
                    onChange={v => setSignalDraft({ ...signalDraft, label: v.slice(0, 30) })} />

                  <label className="compact-field">
                    <span>espressione</span>
                    <ExpressionTextarea
                      ref={exprRef}
                      value={signalDraft.expression}
                      placeholder="es: sin(2πt)"
                      rows={2}
                      onChange={v => {
                        const trimmed = v.slice(0, 50)
                        const parsed = parseSignalExpression(normalizeSignalInput(trimmed))
                        let nextDraft: SignalDraft = { ...signalDraft, expression: trimmed }
                        if (parsed.ok && signalDraft.mode === 'time') {
                          const period = detectPeriod(parsed.signal)
                          if (period) {
                            nextDraft = {
                              ...nextDraft,
                              analysisMode: 'CT_periodic',
                              analysisParams: { ...nextDraft.analysisParams, period },
                            }
                          } else if (nextDraft.analysisMode === 'CT_periodic' && !signalDraft.analysisParams.period) {
                            nextDraft = { ...nextDraft, analysisMode: 'CT_aperiodic' }
                          }
                        }
                        setSignalDraft(nextDraft)
                      }}
                    />
                  </label>

                  {/* Parse error */}
                  {editorPreview !== null && !editorPreview.ok && (
                    <div className="expr-warning expr-warning--error">{editorPreview.error}</div>
                  )}
                  {/* Semantic warning/error */}
                  {expressionWarning && (
                    <div className={expressionWarning.kind === 'error' ? 'expr-warning expr-warning--error' : 'expr-warning expr-warning--warn'}>
                      {expressionWarning.msg}
                    </div>
                  )}

                  <div className="drawer__grid">
                    <CompactSelect label="dominio" value={signalDraft.mode} options={['time', 'discrete']}
                      onChange={v => {
                        const m = v as ViewMode
                        const defaultMode: AnalysisMode = m === 'time' ? 'CT_aperiodic' : 'DT_aperiodic'
                        const newExpr = m === 'discrete'
                          ? swapVariable(signalDraft.expression, 't', 'n')
                          : swapVariable(signalDraft.expression, 'n', 't')
                        setSignalDraft({ ...signalDraft, expression: newExpr, mode: m, analysisMode: defaultMode })
                        if (m === 'discrete' && studyState.activeTab === 'time') {
                          setStudyState({ ...studyState, activeTab: 'discrete' })
                        } else if (m === 'time' && studyState.activeTab === 'discrete') {
                          setStudyState({ ...studyState, activeTab: 'time' })
                        }
                      }} />
                    {editorPreview !== null && (() => {
                      const isOk = editorPreview.ok && expressionWarning?.kind !== 'error'
                      return (
                        <div className={isOk ? 'inline-status inline-status--ok' : 'inline-status inline-status--bad'}>
                          {isOk ? 'ok' : 'err'}
                        </div>
                      )
                    })()}
                  </div>

                  {/* Analisi spettrale */}
                  <CompactSelect
                    label="analisi"
                    value={signalDraft.analysisMode}
                    options={availableAnalysisModes}
                    labels={availableAnalysisModes.map(m => ({ value: m, label: ANALYSIS_MODE_LABELS[m] }))}
                    onChange={v => setSignalDraft({ ...signalDraft, analysisMode: v as AnalysisMode })}
                  />

                  {/* Parametri contestuali */}
                  {signalDraft.analysisMode === 'CT_periodic' && (
                    <div className="drawer__grid">
                      <CompactNumber label="periodo T" value={signalDraft.analysisParams.period ?? 1}
                        min={0.01} step={0.1}
                        onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, period: v } })} />
                      <CompactNumber label="armoniche k" value={signalDraft.analysisParams.kMax ?? 15}
                        min={1} step={1}
                        onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, kMax: Math.round(v) } })} />
                    </div>
                  )}

                  {signalDraft.analysisMode === 'CT_periodic' && (
                    <div className="drawer__grid">
                      <CompactToggle label="Gibbs" checked={signalDraft.analysisParams.gibbsEnabled ?? false}
                        onChange={c => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, gibbsEnabled: c } })} />
                      {signalDraft.analysisParams.gibbsEnabled && (
                        <CompactNumber label="harm. N" value={signalDraft.analysisParams.gibbsHarmonics ?? 5}
                          min={1} step={1}
                          onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, gibbsHarmonics: Math.round(v) } })} />
                      )}
                    </div>
                  )}

                  {signalDraft.analysisMode === 'DT_periodic' && (
                    <CompactNumber label="periodo N" value={signalDraft.analysisParams.period ?? 8}
                      min={2} step={1}
                      onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, period: Math.round(v) } })} />
                  )}

                  {signalDraft.analysisMode === 'DT_DFT' && (
                    <CompactNumber label="punti N" value={signalDraft.analysisParams.dftN ?? 64}
                      min={4} step={4}
                      onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, dftN: Math.round(v) } })} />
                  )}

                  <div className="drawer__actions">
                    {!editingSignal && hasExpression && (
                      <button type="button" className="topbar__button topbar__button--active" onClick={saveSignal}
                        disabled={!editorPreview?.ok || expressionWarning?.kind === 'error'}>
                        aggiungi
                      </button>
                    )}
                    {editingSignal && draftIsModified && (
                      <button type="button" className="topbar__button topbar__button--active" onClick={saveSignal}
                        disabled={!editorPreview?.ok || expressionWarning?.kind === 'error'}>
                        aggiorna
                      </button>
                    )}
                    {editingSignal && (
                      <button type="button" className="topbar__button" onClick={cancelEditing}>annulla</button>
                    )}
                  </div>

                  <div className="quick-legend">
                    {quickExamples.map(ex => (
                      <button key={ex.label} type="button" className="quick-legend__button"
                        onClick={() => {
                          if (editingSignal && editingSignal.node.kind !== 'sampled') {
                            // When editing an existing signal, insert expression at cursor position
                            exprRef.current?.insertAtCursor(ex.expression)
                          } else {
                            // New signal: replace the whole draft
                            setSignalDraft({
                              label: ex.label,
                              expression: ex.expression,
                              mode: ex.mode,
                              analysisMode: ex.analysisMode,
                              analysisParams: ex.params ?? {},
                            })
                            if (ex.mode === 'discrete' && studyState.activeTab === 'time') {
                              setStudyState({ ...studyState, activeTab: 'discrete' })
                            } else if (ex.mode === 'time' && studyState.activeTab === 'discrete') {
                              setStudyState({ ...studyState, activeTab: 'time' })
                            }
                          }
                        }}>
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
                )
              } />

              {/* ── Lista segnali ── */}
              <div className="signals-list">
                {renderedSignals.map(signal => (
                  <SignalInfoCard
                    key={signal.id}
                    signal={signal}
                    onEdit={() => startEditing(signal)}
                    onDelete={() => deleteSignal(signal.id)}
                    onToggleVisibility={() => toggleSignalField(signal.id, 'visible')}
                    onToggleInfo={() => toggleSignalField(signal.id, 'showInfo')}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  )

  function handleSample(source: SourceSignalInfo, fc: number, addDFT: boolean, dftN: number) {
    const sampledNode: SignalNode = { kind: 'sampled', source: source.node, fc }
    const T = detectPeriod(sampledNode)
    const N = T !== null ? T : null
    const isPeriodic = N !== null && Number.isInteger(N)
    const analysisMode: AnalysisMode = isPeriodic ? 'DT_periodic' : 'DT_aperiodic'
    const analysisParams: AnalysisParams = isPeriodic ? { period: N as number, samplingFc: fc } : { samplingFc: fc }
    const baseLabel = `${source.label}[n]`

    const dtftSignal: StudySignal = {
      id: `sig-${Date.now()}`,
      label: baseLabel,
      expression: `[campionato: ${source.label}, fc=${fc}]`,
      mode: 'discrete',
      visible: true,
      showInfo: true,
      node: sampledNode,
      analysisMode,
      analysisParams,
    }

    const newSignals: StudySignal[] = [dtftSignal]

    if (addDFT) {
      newSignals.push({
        id: `sig-${Date.now() + 1}`,
        label: `${baseLabel} DFT`,
        expression: `[campionato: ${source.label}, fc=${fc}, DFT]`,
        mode: 'discrete',
        visible: true,
        showInfo: true,
        node: sampledNode,
        analysisMode: 'DT_DFT',
        analysisParams: { samplingFc: fc, dftN },
      })
    }

    setStudyState({
      ...studyState,
      activeTab: 'discrete',
      signals: [...studyState.signals, ...newSignals],
    })
  }

  function startEditing(signal: RenderedSignal) {
    setMenuOpen(true)
    setEditingSignalId(signal.id)
    setSignalDraft({
      label: signal.label,
      expression: signal.expression,
      mode: signal.mode,
      analysisMode: signal.analysisMode,
      analysisParams: signal.analysisParams,
    })
  }

  function cancelEditing() {
    setEditingSignalId(null)
    setSignalDraft(createEmptyDraft())
  }

  function saveSignal() {
    const parsed = parseSignalExpression(normalizeSignalInput(signalDraft.expression))
    if (!parsed.ok) return
    if (expressionWarning?.kind === 'error') return

    if (editingSignalId) {
      setStudyState({
        ...studyState,
        signals: studyState.signals.map(s =>
          s.id === editingSignalId
            ? {
                ...s,
                label: signalDraft.label.trim() || s.label,
                expression: signalDraft.expression,
                mode: signalDraft.mode,
                node: parsed.signal,
                analysisMode: signalDraft.analysisMode,
                analysisParams: signalDraft.analysisParams,
              }
            : s,
        ),
      })
      cancelEditing()
      return
    }

    const nextSignal: StudySignal = {
      id: `sig-${Date.now()}`,
      label: signalDraft.label.trim() || `x${studyState.signals.length + 1}`,
      expression: signalDraft.expression,
      mode: signalDraft.mode,
      visible: true,
      showInfo: true,
      node: parsed.signal,
      analysisMode: signalDraft.analysisMode,
      analysisParams: signalDraft.analysisParams,
    }

    setStudyState({ ...studyState, signals: [...studyState.signals, nextSignal] })
    cancelEditing()
  }

  function deleteSignal(signalId: string) {
    const nextSignals = studyState.signals.filter(s => s.id !== signalId)
    setStudyState({ ...studyState, signals: nextSignals })
    if (editingSignalId === signalId) cancelEditing()
  }

  function toggleSignalField(signalId: string, field: 'visible' | 'showInfo') {
    setStudyState({
      ...studyState,
      signals: studyState.signals.map(s =>
        s.id === signalId ? { ...s, [field]: !s[field] } : s,
      ),
    })
  }
}

// ─── Calcolo spettrale ────────────────────────────────────────────────────────

function computeSpectrum(
  node: SignalNode,
  analysisMode: AnalysisMode,
  params: AnalysisParams,
): SpectralResult | null {
  try {
    switch (analysisMode) {
      case 'CT_aperiodic': {
        const { fMin, fMax } = adaptiveFRange(node)
        return computeCTFourier(node, { fMin: params.fMin ?? fMin, fMax: params.fMax ?? fMax })
      }
      case 'CT_periodic':
        return computeFourierSeries(node, params.period ?? 1, { kMax: params.kMax ?? 15 })
      case 'DT_aperiodic':
        return computeDTFT(node)
      case 'DT_periodic':
        return computeDTPeriodic(node, Math.max(2, Math.round(params.period ?? 8)))
      case 'DT_DFT':
        return computeDFT(node, { N: params.dftN ?? 64 })
    }
  } catch { return null }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyDraft(): SignalDraft {
  return {
    label: '',
    expression: '',
    mode: 'time',
    analysisMode: 'CT_aperiodic',
    analysisParams: {},
  }
}

function createInitialState(): StudyState {
  const fallbackSignals = makeExampleSignals().map((ex, i) => {
    const parsed = parseSignalExpression(ex.expression)
    const isDiscrete = ex.label === 'δ[n]'
    return {
      id: `seed-${i}`,
      label: ex.label,
      expression: ex.expression,
      mode: (isDiscrete ? 'discrete' : 'time') as ViewMode,
      visible: true,
      showInfo: true,
      node: parsed.ok ? parsed.signal : ({ kind: 'step', height: 1, shift: 0 } as SignalNode),
      analysisMode: 'CT_aperiodic' as AnalysisMode,
      analysisParams: {} as AnalysisParams,
    } satisfies StudySignal
  })

  return {
    activeTab: 'time',
    settings: {
      showGrid: true,
      showLegend: true,
      showTooltip: true,
      showPhase: true,
      showSpectrumEnvelope: true,
      samplingRate: 24,
    },
    signals: fallbackSignals,
  }
}

function computeStats(node: SignalNode, mode: ViewMode): SignalStats {
  const samples = mode === 'discrete'
    ? sampleDiscreteSignal(node)
    : sampleSignal(node, -8, 8, 400)
  return estimateSignalStats(node, samples)
}

function sampleDiscreteSignal(node: SignalNode): SignalSample[] {
  const samples: SignalSample[] = []
  for (let v = -24; v <= 24; v++) {
    samples.push({ x: v, y: sampleSignal(node, v, v, 1)[0]?.y ?? 0 })
  }
  return samples
}

// ─── Componenti UI compatti ───────────────────────────────────────────────────

function CompactFieldGroup({ label, content }: { label: string; content: ReactNode }) {
  return (
    <section className="drawer__section">
      <div className="drawer__section-label">{label}</div>
      {content}
    </section>
  )
}

function CompactText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

function CompactSelect({
  label, value, options, onChange, labels,
}: {
  label: string; value: string; options: string[]
  onChange: (v: string) => void; labels?: Array<{ value: string; label: string }>
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(opt => {
          const text = labels?.find(l => l.value === opt)?.label ?? opt
          return <option key={opt} value={opt}>{text}</option>
        })}
      </select>
    </label>
  )
}

function CompactToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="compact-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

function CompactNumber({
  label, value, onChange, min, step,
}: {
  label: string; value: number; onChange: (v: number) => void; min?: number; step?: number
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <input type="number" min={min ?? 4} step={step ?? 1} value={value}
        onChange={e => onChange(Number(e.target.value) || (min ?? 4))} />
    </label>
  )
}

export default App
