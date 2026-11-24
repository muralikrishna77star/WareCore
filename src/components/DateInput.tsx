'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from 'react'
import { formatDate } from '@/lib/dates'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * A date box that reads 24-Nov-2026 on every device.
 *
 * The browser's own date box (<input type="date">) shows dates in the
 * device's regional format (24/11/2026, 11/24/2026...), and that can't be
 * changed. So at rest this shows the date as text in WareCore's format; as
 * soon as it's tapped, clicked or tabbed into it becomes the browser's own
 * date box (calendar picker, keyboard entry), and back to text when you
 * leave it. It's still one <input>, so the className lays out exactly as
 * before.
 *
 * Works controlled (value + onChange) or as a plain form field (name +
 * defaultValue): the value sent with a form is always YYYY-MM-DD, through a
 * hidden input carrying the name. required, min and max still block a form
 * from submitting.
 */
export const DateInput = forwardRef<HTMLInputElement, Props>(function DateInput(
  { value, defaultValue, name, onChange, onFocus, onBlur, onPointerDown, min, max, required, disabled, placeholder, className, style, ...rest },
  ref,
) {
  const input = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => input.current as HTMLInputElement)

  const controlled = value !== undefined
  const [own, setOwn] = useState(String(defaultValue ?? ''))
  const iso = controlled ? String(value ?? '') : own
  const [editing, setEditing] = useState(false)
  const openPicker = useRef(false)

  // After switching to the browser's date box from a tap or click, focus it
  // and open its calendar (the tap itself happened on the text box).
  useEffect(() => {
    const el = input.current
    if (!editing || !el) return
    if (document.activeElement !== el) el.focus()
    if (openPicker.current) {
      openPicker.current = false
      try { el.showPicker?.() } catch { /* not allowed here (e.g. no recent tap) */ }
    }
  }, [editing])

  // Text mode is a plain text box, so the browser can't check min/max
  // itself: report them the same way it would.
  useEffect(() => {
    const el = input.current
    if (!el) return
    let msg = ''
    if (!editing && iso) {
      if (min && iso < String(min)) msg = `Choose ${formatDate(String(min))} or later.`
      else if (max && iso > String(max)) msg = `Choose ${formatDate(String(max))} or earlier.`
    }
    el.setCustomValidity(msg)
  }, [editing, iso, min, max])

  const startEditing = (picker: boolean) => {
    if (disabled) return
    if (picker) openPicker.current = true
    if (!editing) setEditing(true)
  }

  return (
    <>
      <input
        {...rest}
        ref={input}
        type={editing ? 'date' : 'text'}
        inputMode={editing ? undefined : 'none'}
        value={editing ? iso : formatDate(iso)}
        min={editing ? min : undefined}
        max={editing ? max : undefined}
        required={required}
        disabled={disabled}
        placeholder={placeholder ?? 'dd-mmm-yyyy'}
        autoComplete="off"
        className={`wc-date ${editing ? '' : 'wc-date-text'} ${className ?? ''}`}
        style={style}
        onPointerDown={(e) => {
          onPointerDown?.(e)
          startEditing(true)
        }}
        onFocus={(e) => {
          onFocus?.(e)
          startEditing(false)
        }}
        onKeyDown={(e) => {
          rest.onKeyDown?.(e)
          if (!editing && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            startEditing(true)
          }
        }}
        onChange={(e) => {
          if (!editing) return // the text form is display only
          if (!controlled) setOwn(e.target.value)
          onChange?.(e)
        }}
        onBlur={(e) => {
          onBlur?.(e)
          setEditing(false)
        }}
      />
      {name && <input type="hidden" name={name} value={iso} disabled={disabled} />}
    </>
  )
})

export default DateInput
