import { useEffect, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

export function Field(props: { label: string; overridden?: boolean; onReset?: () => void; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className={`field${props.overridden ? ' overridden' : ''}`}>
      <label>
        {props.label}
        {props.overridden && props.onReset && (
          <button className="reset" title="기본값으로 복원" onClick={props.onReset}>
            <RotateCcw />
          </button>
        )}
      </label>
      <div className="field-ctl">
        {props.children}
        {props.hint && <div className="hint">{props.hint}</div>}
      </div>
    </div>
  )
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; small?: boolean; disabled?: boolean }) {
  return (
    <div className={`seg${props.small ? ' small' : ''}`} role="radiogroup">
      {props.options.map((o) => (
        <button key={o.value} role="radio" aria-checked={props.value === o.value} className={props.value === o.value ? 'on' : ''} disabled={props.disabled} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch(props: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button className={`switch${props.on ? ' on' : ''}`} role="switch" aria-checked={props.on} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(!props.on)} />
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="toggle" onClick={() => !props.disabled && props.onChange(!props.on)}>
      <Switch on={props.on} onChange={() => undefined} label={props.label} disabled={props.disabled} />
      <span className="toggle-text">
        {props.label}
        {props.hint && <span className="hint">{props.hint}</span>}
      </span>
    </div>
  )
}

export function TextInput(props: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; disabled?: boolean; ariaLabel?: string }) {
  const [v, setV] = useState(props.value)
  useEffect(() => setV(props.value), [props.value])
  const commit = () => {
    if (v !== props.value) props.onCommit(v)
  }
  return (
    <input
      className={`input${props.mono ? ' mono' : ''}`}
      value={v}
      placeholder={props.placeholder}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setV(props.value)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

export function NumberInput(props: { value: number; onCommit: (v: number) => void; min?: number; max?: number; disabled?: boolean; ariaLabel?: string; width?: number }) {
  const [v, setV] = useState(String(props.value))
  useEffect(() => setV(String(props.value)), [props.value])
  const commit = () => {
    let n = Number(v)
    if (!Number.isFinite(n)) {
      setV(String(props.value))
      return
    }
    if (props.min !== undefined) n = Math.max(props.min, n)
    if (props.max !== undefined) n = Math.min(props.max, n)
    n = Math.round(n)
    setV(String(n))
    if (n !== props.value) props.onCommit(n)
  }
  return (
    <input
      className="input num"
      style={props.width ? { width: props.width } : undefined}
      inputMode="numeric"
      value={v}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      onChange={(e) => setV(e.target.value.replace(/[^\d-]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const n = (Number(v) || 0) + (e.key === 'ArrowUp' ? 1 : -1)
          setV(String(n))
        }
      }}
    />
  )
}

export function Select<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean; ariaLabel?: string; className?: string }) {
  return (
    <select className={`select ${props.className ?? ''}`} value={props.value} disabled={props.disabled} aria-label={props.ariaLabel} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
