import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SignalInfoCard } from './components/SignalInfoCard'
import { SignalPlot } from './components/SignalPlot'
import { SpectrumPlot } from './components/SpectrumPlot'
import {
  estimateSignalStats,
  makeExampleSignals,
  normalizeSignalInput,
  parseSignalExpression,
  sampleSignal,
  type NotationSettings,
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
import { computeAliasingOverlay, type AliasingOverlay } from './domain/sampling'
import { useStoredState } from './lib/persistence'
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

type StudySettings = NotationSettings & {
  showGrid: boolean
  samplingRate: number
}

type StudyState = {
  activeTab: ViewMode | 'settings'
  settings: StudySettings
  signals: StudySignal[]
}

type OperationKind = 'sum' | 'product' | 'convolution'

type SignalDraft = {
  label: string
  expression: string
  mode: ViewMode
  analysisMode: AnalysisMode
  analysisParams: AnalysisParams
}

type OperationDraft = {
  kind: OperationKind
  sourceA: string
  sourceB: string
  label: string
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

const QUICK_EXAMPLES: Array<{ label: string; expression: string; mode: ViewMode; analysisMode: AnalysisMode; params?: AnalysisParams }> = [
  { label: 'rect(t)', expression: 'rect(1,1,0)', mode: 'time', analysisMode: 'CT_aperiodic' },
  { label: 'tri(t)', expression: 'triangle(2,1,0)', mode: 'time', analysisMode: 'CT_aperiodic' },
  { label: 'sinc(t)', expression: 'sinc(t)', mode: 'time', analysisMode: 'CT_aperiodic' },
  { label: 'ε(t)', expression: 'step(1,0)', mode: 'time', analysisMode: 'CT_aperiodic' },
  { label: 'sgn(t)', expression: 'sgn()', mode: 'time', analysisMode: 'CT_aperiodic' },
  { label: 'onda sq.', expression: 'sgn(sin(2*π*t))', mode: 'time', analysisMode: 'CT_periodic', params: { period: 1, kMax: 15 } },
  { label: 'δ[n]', expression: 'impulse(1,0)', mode: 'discrete', analysisMode: 'DT_aperiodic' },
  { label: 'ε[n]', expression: 'step(1,0)', mode: 'discrete', analysisMode: 'DT_aperiodic' },
  { label: '0.8^n·ε[n]', expression: 'discreteExp(0.8)', mode: 'discrete', analysisMode: 'DT_aperiodic' },
]

// ─── Componente principale ───────────────────────────────────────────────────

function App() {
  const [studyState, setStudyState] = useStoredState<StudyState>('signal-plotter-study-state-v2', createInitialState())
  const [menuOpen, setMenuOpen] = useState(true)
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null)
  const [signalDraft, setSignalDraft] = useState<SignalDraft>(createEmptyDraft())
  const [operationDraft, setOperationDraft] = useState<OperationDraft>(() => createOperationDraft(studyState.signals))

  const renderedSignals = useMemo<RenderedSignal[]>(
    () =>
      studyState.signals.map((signal, index) => ({
        ...signal,
        stats: computeStats(signal.node, signal.mode, studyState.settings.samplingRate),
        color: PALETTE[index % PALETTE.length],
      })),
    [studyState.settings.samplingRate, studyState.signals],
  )

  const isFrequencyTab = studyState.activeTab === 'frequency'
  const chartMode: ViewMode = studyState.activeTab === 'discrete' ? 'discrete' : 'time'

  // Segnali visibili nel pannello temporale/discreto
  const chartSignals = renderedSignals.filter(s => s.visible && s.mode === chartMode)

  // Tutti i segnali visibili (indipendentemente dal mode) per il tab spettrale
  const allVisibleSignals = renderedSignals.filter(s => s.visible)

  // Calcola overlay Gibbs per il segnale selezionato in editing (se attivo)
  const gibbsOverlay = useMemo<SignalSample[]>(() => {
    if (isFrequencyTab) return []
    const editSig = editingSignalId
      ? renderedSignals.find(s => s.id === editingSignalId)
      : null
    const gibbsSig = editSig ?? renderedSignals.find(s =>
      s.analysisMode === 'CT_periodic' &&
      s.analysisParams.gibbsEnabled &&
      s.visible
    )
    if (!gibbsSig || gibbsSig.analysisMode !== 'CT_periodic') return []
    const { gibbsEnabled, gibbsHarmonics, period } = gibbsSig.analysisParams
    if (!gibbsEnabled || !period) return []
    try {
      const result = computeGibbsReconstruction(gibbsSig.node, period, gibbsHarmonics ?? 5)
      return result.samples
    } catch {
      return []
    }
  }, [isFrequencyTab, editingSignalId, renderedSignals])

  // Calcola risultati spettrali per tutti i segnali visibili
  const spectralEntries = useMemo(() => {
    if (!isFrequencyTab) return []
    return allVisibleSignals.flatMap(sig => {
      try {
        const spectrum = computeSpectrum(sig.node, sig.analysisMode, sig.analysisParams)
        if (!spectrum) return []

        let aliasing: AliasingOverlay | undefined
        if (
          sig.analysisMode === 'CT_aperiodic' &&
          sig.analysisParams.samplingFc &&
          spectrum.kind === 'continuous'
        ) {
          aliasing = computeAliasingOverlay(spectrum, sig.analysisParams.samplingFc)
        }

        return [{ id: sig.id, label: sig.label, color: sig.color, spectrum, aliasing }]
      } catch {
        return []
      }
    })
  }, [isFrequencyTab, allVisibleSignals])

  const freqLabel = spectralEntries.some(e =>
    e.spectrum.kind === 'continuous' &&
    (allVisibleSignals.find(s => s.id === e.id)?.analysisMode === 'DT_aperiodic' ||
     allVisibleSignals.find(s => s.id === e.id)?.analysisMode === 'DT_periodic' ||
     allVisibleSignals.find(s => s.id === e.id)?.analysisMode === 'DT_DFT')
  ) ? 'f (normalizzata)' : 'f [Hz]'

  const editorPreview = parseSignalExpression(signalDraft.expression)
  const previewSignal: PlotSignal | null = editorPreview.ok
    ? { id: 'preview', label: 'preview', node: editorPreview.signal, color: '#9ca3af', preview: true }
    : null

  const plotSignals: PlotSignal[] = [
    ...chartSignals.map(s => ({ id: s.id, label: s.label, node: s.node, color: s.color })),
    ...(previewSignal && !isFrequencyTab ? [previewSignal] : []),
  ]

  const editingSignal = editingSignalId
    ? studyState.signals.find(s => s.id === editingSignalId) ?? null
    : null

  const signalSourceOptions = studyState.signals.map(s => ({ value: s.id, label: s.label }))

  const availableAnalysisModes = signalDraft.mode === 'time' ? CT_ANALYSIS_MODES : DT_ANALYSIS_MODES

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar__group">
          <button type="button" className="topbar__button" onClick={() => setMenuOpen(v => !v)}>
            {menuOpen ? 'nascondi' : 'menu'}
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

        <div className="topbar__group topbar__group--meta">
          <span>{studyState.signals.length} segnali</span>
          <span>{studyState.settings.samplingRate} Hz</span>
          <span>{studyState.settings.timeVariable}/{studyState.settings.frequencyVariable}/{studyState.settings.discreteVariable}</span>
        </div>
      </header>

      <section className={menuOpen ? 'workspace workspace--open' : 'workspace workspace--closed'}>
        <section className="chart-pane">
          <div className="chart-stage">
            {isFrequencyTab ? (
              <SpectrumPlot entries={spectralEntries} frequencyLabel={freqLabel} />
            ) : (
              <SignalPlot
                mode={studyState.activeTab === 'discrete' ? 'discrete' : 'time'}
                signals={plotSignals}
                gibbsOverlay={gibbsOverlay.length > 0 ? gibbsOverlay : undefined}
                showGrid={studyState.settings.showGrid}
              />
            )}
          </div>

          <div className="legend-strip">
            {(isFrequencyTab ? allVisibleSignals : chartSignals).length > 0 ? (
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
              <span className="legend-empty">nessun segnale visibile</span>
            )}
          </div>
        </section>

        <aside className="drawer">
          {studyState.activeTab === 'settings' ? (
            <div className="drawer__stack">
              <CompactFieldGroup label="notazione" content={
                <div className="drawer__grid">
                  <CompactSelect label="t" value={studyState.settings.timeVariable} options={['t', 'tau']}
                    onChange={v => setStudyState({ ...studyState, settings: { ...studyState.settings, timeVariable: v as NotationSettings['timeVariable'] } })} />
                  <CompactSelect label="f" value={studyState.settings.frequencyVariable} options={['f', 'omega']}
                    onChange={v => setStudyState({ ...studyState, settings: { ...studyState.settings, frequencyVariable: v as NotationSettings['frequencyVariable'] } })} />
                  <CompactSelect label="n" value={studyState.settings.discreteVariable} options={['n', 'k']}
                    onChange={v => setStudyState({ ...studyState, settings: { ...studyState.settings, discreteVariable: v as NotationSettings['discreteVariable'] } })} />
                  <CompactToggle label="grid" checked={studyState.settings.showGrid}
                    onChange={c => setStudyState({ ...studyState, settings: { ...studyState.settings, showGrid: c } })} />
                  <CompactNumber label="sample Hz" value={studyState.settings.samplingRate}
                    onChange={v => setStudyState({ ...studyState, settings: { ...studyState.settings, samplingRate: v } })} />
                </div>
              } />
            </div>
          ) : (
            <div className="drawer__stack">
              {/* ── Editor segnale ── */}
              <CompactFieldGroup label={editingSignal ? 'modifica' : 'nuovo segnale'} content={
                <div className="drawer__stack drawer__stack--tight">
                  <CompactText label="label" value={signalDraft.label}
                    onChange={v => setSignalDraft({ ...signalDraft, label: v })} />
                  <CompactTextArea label="espressione" value={signalDraft.expression}
                    onChange={v => setSignalDraft({ ...signalDraft, expression: normalizeSignalInput(v) })} />
                  <div className="drawer__grid">
                    <CompactSelect label="dominio" value={signalDraft.mode} options={['time', 'discrete']}
                      onChange={v => {
                        const m = v as ViewMode
                        const defaultAnalysis: AnalysisMode = m === 'time' ? 'CT_aperiodic' : 'DT_aperiodic'
                        setSignalDraft({ ...signalDraft, mode: m, analysisMode: defaultAnalysis })
                      }} />
                    <div className={editorPreview.ok ? 'inline-status inline-status--ok' : 'inline-status inline-status--bad'}>
                      {editorPreview.ok ? 'ok' : editorPreview.error}
                    </div>
                  </div>

                  {/* Analisi spettrale */}
                  <CompactSelect
                    label="analisi"
                    value={signalDraft.analysisMode}
                    options={availableAnalysisModes}
                    labels={availableAnalysisModes.map(m => ({ value: m, label: ANALYSIS_MODE_LABELS[m] }))}
                    onChange={v => setSignalDraft({ ...signalDraft, analysisMode: v as AnalysisMode })}
                  />

                  {/* Parametri contestuali per l'analisi */}
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

                  {signalDraft.analysisMode === 'CT_aperiodic' && (
                    <CompactNumber label="fc aliasing [Hz]" value={signalDraft.analysisParams.samplingFc ?? 0}
                      min={0} step={0.1}
                      onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, samplingFc: v > 0 ? v : undefined } })} />
                  )}

                  {(signalDraft.analysisMode === 'DT_periodic') && (
                    <CompactNumber label="periodo N" value={signalDraft.analysisParams.period ?? 8}
                      min={2} step={1}
                      onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, period: Math.round(v) } })} />
                  )}

                  {signalDraft.analysisMode === 'DT_DFT' && (
                    <CompactNumber label="punti N" value={signalDraft.analysisParams.dftN ?? 64}
                      min={4} step={4}
                      onChange={v => setSignalDraft({ ...signalDraft, analysisParams: { ...signalDraft.analysisParams, dftN: Math.round(v) } })} />
                  )}

                  {editorPreview.ok ? <div className="preview-note">preview in tempo reale sul grafico</div> : null}

                  <div className="drawer__actions">
                    <button type="button" className="topbar__button topbar__button--active" onClick={saveSignal} disabled={!editorPreview.ok}>
                      {editingSignal ? 'aggiorna' : 'aggiungi'}
                    </button>
                    {editingSignal && (
                      <button type="button" className="topbar__button" onClick={cancelEditing}>annulla</button>
                    )}
                  </div>

                  <div className="quick-legend">
                    {QUICK_EXAMPLES.map(ex => (
                      <button key={ex.label} type="button" className="quick-legend__button"
                        onClick={() => setSignalDraft({
                          label: ex.label,
                          expression: ex.expression,
                          mode: ex.mode,
                          analysisMode: ex.analysisMode,
                          analysisParams: ex.params ?? {},
                        })}>
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              } />

              {/* ── Operazioni ── */}
              <CompactFieldGroup label="operazioni" content={
                <div className="drawer__stack drawer__stack--tight">
                  <div className="drawer__grid">
                    <CompactSelect label="tipo" value={operationDraft.kind} options={['sum', 'product', 'convolution']}
                      onChange={v => setOperationDraft({ ...operationDraft, kind: v as OperationKind })} />
                    <CompactText label="nome" value={operationDraft.label}
                      onChange={v => setOperationDraft({ ...operationDraft, label: v })} />
                  </div>
                  <div className="drawer__grid">
                    <CompactSelect label="A" value={operationDraft.sourceA}
                      options={signalSourceOptions.map(o => o.value)} labels={signalSourceOptions}
                      onChange={v => setOperationDraft({ ...operationDraft, sourceA: v })} />
                    <CompactSelect label="B" value={operationDraft.sourceB}
                      options={signalSourceOptions.map(o => o.value)} labels={signalSourceOptions}
                      onChange={v => setOperationDraft({ ...operationDraft, sourceB: v })} />
                  </div>
                  <button type="button" className="topbar__button topbar__button--active" onClick={createOperation}>
                    crea operazione
                  </button>
                </div>
              } />

              <div className="signals-list">
                {renderedSignals.map(signal => (
                  <SignalInfoCard
                    key={signal.id}
                    signal={signal}
                    notation={studyState.settings}
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
    const parsed = parseSignalExpression(signalDraft.expression)
    if (!parsed.ok) return

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
    setOperationDraft(createOperationDraft([...studyState.signals, nextSignal]))
    cancelEditing()
  }

  function createOperation() {
    const sourceA = studyState.signals.find(s => s.id === operationDraft.sourceA)
    const sourceB = studyState.signals.find(s => s.id === operationDraft.sourceB)
    if (!sourceA || !sourceB) return

    const derivedNode: SignalNode =
      operationDraft.kind === 'sum'
        ? { kind: 'sum', children: [sourceA.node, sourceB.node] }
        : operationDraft.kind === 'product'
          ? { kind: 'product', children: [sourceA.node, sourceB.node] }
          : { kind: 'conv', left: sourceA.node, right: sourceB.node }

    const nextSignal: StudySignal = {
      id: `op-${Date.now()}`,
      label: operationDraft.label.trim() || 'op',
      expression: describeOperation(operationDraft.kind, sourceA.label, sourceB.label),
      mode: sourceA.mode,
      visible: true,
      showInfo: true,
      node: derivedNode,
      analysisMode: sourceA.analysisMode,
      analysisParams: sourceA.analysisParams,
    }

    setStudyState({ ...studyState, signals: [...studyState.signals, nextSignal] })
    setOperationDraft(createOperationDraft([...studyState.signals, nextSignal]))
  }

  function deleteSignal(signalId: string) {
    const nextSignals = studyState.signals.filter(s => s.id !== signalId)
    setStudyState({ ...studyState, signals: nextSignals })
    if (editingSignalId === signalId) cancelEditing()
    setOperationDraft(cur => ({
      ...cur,
      sourceA: cur.sourceA === signalId ? nextSignals[0]?.id ?? '' : cur.sourceA,
      sourceB: cur.sourceB === signalId ? nextSignals[1]?.id ?? nextSignals[0]?.id ?? '' : cur.sourceB,
    }))
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
        return computeCTFourier(node, {
          fMin: params.fMin ?? fMin,
          fMax: params.fMax ?? fMax,
        })
      }
      case 'CT_periodic': {
        const T = params.period ?? 1
        return computeFourierSeries(node, T, { kMax: params.kMax ?? 15 })
      }
      case 'DT_aperiodic':
        return computeDTFT(node)
      case 'DT_periodic': {
        const N = Math.round(params.period ?? 8)
        return computeDTPeriodic(node, Math.max(2, N))
      }
      case 'DT_DFT':
        return computeDFT(node, { N: params.dftN ?? 64 })
    }
  } catch {
    return null
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyDraft(): SignalDraft {
  return {
    label: '',
    expression: 'sin(2*π*t)',
    mode: 'time',
    analysisMode: 'CT_aperiodic',
    analysisParams: {},
  }
}

function createOperationDraft(signals: StudySignal[]): OperationDraft {
  return {
    kind: 'sum',
    sourceA: signals[0]?.id ?? '',
    sourceB: signals[1]?.id ?? signals[0]?.id ?? '',
    label: 'combinazione',
  }
}

function createInitialState(): StudyState {
  const fallbackSignals = makeExampleSignals().map((ex, i) => {
    const parsed = parseSignalExpression(ex.expression)
    return {
      id: `seed-${i}`,
      label: ex.label,
      expression: ex.expression,
      mode: (i === 2 ? 'discrete' : 'time') as ViewMode,
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
      timeVariable: 't',
      discreteVariable: 'n',
      frequencyVariable: 'f',
      showGrid: true,
      samplingRate: 24,
    },
    signals: fallbackSignals,
  }
}

function computeStats(node: SignalNode, mode: ViewMode, samplingRate: number): SignalStats {
  const samples = mode === 'discrete'
    ? sampleDiscreteSignal(node)
    : sampleSignal(node, -8, 8, Math.max(80, samplingRate * 8))
  return estimateSignalStats(node, samples)
}

function sampleDiscreteSignal(node: SignalNode): SignalSample[] {
  const samples: SignalSample[] = []
  for (let v = -24; v <= 24; v++) {
    samples.push({ x: v, y: sampleSignal(node, v, v, 1)[0]?.y ?? 0 })
  }
  return samples
}

function describeOperation(kind: OperationKind, labelA: string, labelB: string): string {
  if (kind === 'sum') return `sum(${labelA}, ${labelB})`
  if (kind === 'product') return `product(${labelA}, ${labelB})`
  return `conv(${labelA}, ${labelB})`
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

function CompactTextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} />
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
