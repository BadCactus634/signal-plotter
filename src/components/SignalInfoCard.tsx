import type { SignalStats, ViewMode, SignalNode } from '../domain/signals'
import { formatFormula } from '../domain/signals'

type SignalInfoCardProps = {
  signal: {
    id: string
    label: string
    expression: string
    mode: ViewMode
    visible: boolean
    showInfo: boolean
    node: SignalNode
    stats: SignalStats
    color: string
  }
  onEdit: () => void
  onDelete: () => void
  onToggleVisibility: () => void
  onToggleInfo: () => void
}

export function SignalInfoCard({ signal, onEdit, onDelete, onToggleVisibility, onToggleInfo }: SignalInfoCardProps) {
  const formula = formatFormula(signal.node)

  return (
    <div className="signal-row" style={{ borderLeftColor: signal.color }}>
      <div className="signal-row__top">
        <span className="signal-row__swatch" style={{ backgroundColor: signal.color }} />
        <button type="button" className="signal-row__label" onClick={onEdit}>
          {signal.label}
        </button>
        <span className={signal.visible ? 'signal-row__state signal-row__state--on' : 'signal-row__state'}>
          {signal.visible ? 'on' : 'off'}
        </span>
        <button type="button" className="signal-row__tiny" onClick={onToggleVisibility}>vis</button>
        <button type="button" className="signal-row__tiny" onClick={onToggleInfo}>info</button>
        <button type="button" className="signal-row__tiny" onClick={onEdit}>edit</button>
        <button type="button" className="signal-row__tiny signal-row__tiny--danger" onClick={onDelete}>del</button>
      </div>

      {signal.showInfo && (
        <div className="signal-row__body">
          <div className="signal-row__line">
            <span>E</span>
            <strong style={{ color: signal.color }}>{signal.stats.energy.toFixed(2)}</strong>
            <span>P</span>
            <strong style={{ color: signal.color }}>{signal.stats.averagePower.toFixed(2)}</strong>
            <span>A</span>
            <strong style={{ color: signal.color }}>{signal.stats.peak.toFixed(2)}</strong>
          </div>
          <div className="signal-row__line signal-row__line--muted">
            <span>T</span>
            <strong style={{ color: signal.color }}>{signal.stats.estimatedPeriod ? signal.stats.estimatedPeriod.toFixed(2) : '—'}</strong>
            <span>f</span>
            <strong style={{ color: signal.color }}>{signal.stats.estimatedFrequency ? signal.stats.estimatedFrequency.toFixed(2) : '—'}</strong>
            <span>Z</span>
            <strong style={{ color: signal.color }}>{signal.stats.zeroCrossings}</strong>
          </div>
          <div className="signal-row__formula">{formula}</div>
        </div>
      )}
    </div>
  )
}
