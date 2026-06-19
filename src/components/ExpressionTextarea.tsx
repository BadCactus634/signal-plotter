import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'

const COMMANDS = [
  { name: 'delta', label: '\\delta', desc: 'δ( ) — Impulso di Dirac', text: 'δ()', cursorBack: 1 },
  { name: 'pi',    label: '\\pi',    desc: 'π — Pi greco',             text: 'π',   cursorBack: 0 },
] as const

type Cmd = typeof COMMANDS[number]
type PaletteState = { filter: string; backslashIdx: number }

type Props = {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}

export type ExpressionTextareaHandle = {
  insertAtCursor: (text: string) => void
}

export const ExpressionTextarea = forwardRef<ExpressionTextareaHandle, Props>(
  function ExpressionTextarea({ value, onChange, placeholder, rows = 3 }, fwdRef) {
    const ref = useRef<HTMLTextAreaElement>(null)
    const pendingCursor = useRef<number | null>(null)
    const [palette, setPalette] = useState<PaletteState | null>(null)

    useImperativeHandle(fwdRef, () => ({
      insertAtCursor(text: string) {
        const ta = ref.current
        const pos = ta ? (ta.selectionStart ?? value.length) : value.length
        const end = ta ? (ta.selectionEnd ?? pos) : pos
        const newValue = value.slice(0, pos) + text + value.slice(end)
        onChange(newValue)
        pendingCursor.current = pos + text.length
        // Restore focus so cursor position is applied
        requestAnimationFrame(() => ta?.focus())
      },
    }))

    // Imposta il cursore dopo che React aggiorna il DOM
    useLayoutEffect(() => {
      if (pendingCursor.current !== null && ref.current) {
        ref.current.selectionStart = pendingCursor.current
        ref.current.selectionEnd = pendingCursor.current
        pendingCursor.current = null
      }
    })

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      const ta = ref.current
      if (!ta) return
      const { selectionStart: s, selectionEnd: e2 } = ta
      const v = ta.value

      // Auto-chiusura parentesi
      if (e.key === '(' && s === e2) {
        e.preventDefault()
        onChange(v.slice(0, s) + '()' + v.slice(e2))
        pendingCursor.current = s + 1
        return
      }
      if (e.key === '[' && s === e2) {
        e.preventDefault()
        onChange(v.slice(0, s) + '[]' + v.slice(e2))
        pendingCursor.current = s + 1
        return
      }

      // Salta la chiusura se il carattere successivo è già la chiusura
      if ((e.key === ')' && v[s] === ')') || (e.key === ']' && v[s] === ']')) {
        e.preventDefault()
        ta.selectionStart = s + 1
        ta.selectionEnd = s + 1
        return
      }

      // Smart delete: se cursore è tra "()" o "[]", cancella entrambi
      if (e.key === 'Backspace' && s === e2 && s > 0) {
        const prev = v[s - 1]
        const next = v[s]
        if ((prev === '(' && next === ')') || (prev === '[' && next === ']')) {
          e.preventDefault()
          onChange(v.slice(0, s - 1) + v.slice(s + 1))
          pendingCursor.current = s - 1
          return
        }
      }

      // Backslash → apre la palette comandi
      if (e.key === '\\') {
        e.preventDefault()
        onChange(v.slice(0, s) + '\\' + v.slice(e2))
        setPalette({ filter: '', backslashIdx: s })
        pendingCursor.current = s + 1
        return
      }

      if (palette) {
        if (e.key === 'Escape') { setPalette(null); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const matches = COMMANDS.filter(c => c.name.startsWith(palette.filter))
          if (matches[0]) applyCommand(matches[0])
          return
        }
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const newVal = e.target.value
      if (palette) {
        const { backslashIdx: bs } = palette
        const cursor = e.target.selectionStart ?? 0
        if (cursor > bs && newVal[bs] === '\\') {
          const typed = newVal.slice(bs + 1, cursor)
          if (/^[a-z]*$/i.test(typed)) {
            setPalette({ ...palette, filter: typed })
          } else {
            setPalette(null)
          }
        } else {
          setPalette(null)
        }
      }
      onChange(newVal)
    }

    function applyCommand(cmd: Cmd) {
      if (!palette) return
      const ta = ref.current
      if (!ta) return
      const v = ta.value
      const { backslashIdx: bs, filter } = palette
      const toRemove = 1 + filter.length
      const newVal = v.slice(0, bs) + cmd.text + v.slice(bs + toRemove)
      pendingCursor.current = bs + cmd.text.length - cmd.cursorBack
      setPalette(null)
      onChange(newVal)
    }

    const filteredCmds = palette ? COMMANDS.filter(c => c.name.startsWith(palette.filter)) : []

    return (
      <div className="expression-input-wrap">
        <textarea
          ref={ref}
          rows={rows}
          value={value}
          placeholder={placeholder}
          className="expression-textarea"
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          onBlur={() => { setTimeout(() => setPalette(null), 150) }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        {palette && filteredCmds.length > 0 && (
          <ul className="palette-dropdown" role="listbox">
            {filteredCmds.map(cmd => (
              <li key={cmd.name}>
                <button
                  type="button"
                  className="palette-item"
                  onMouseDown={e => { e.preventDefault(); applyCommand(cmd) }}
                >
                  <code className="palette-item__trigger">{cmd.label}</code>
                  <span className="palette-item__desc">{cmd.desc}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
)
