import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

interface SegmentedProps<T extends string> {
  options: readonly (readonly [T, ReactNode])[]
  value: T
  onChange: (value: T) => void
  label: string
  /** "tabs": role=tablist/tab with aria-selected; "toggle": a group of aria-pressed buttons. */
  kind?: 'tabs' | 'toggle'
  className?: string
}

/**
 * A segmented control whose selection slides between segments.
 *
 * The highlighted look is a second, decorative copy of the segments drawn
 * on top and clipped to the selected one. Moving the clip moves the white
 * pill and the coloured label together, frame for frame; animating a
 * background and a text colour separately never quite lines up.
 */
export function Segmented<T extends string>({ options, value, onChange, label, kind = 'toggle', className = '' }: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [clip, setClip] = useState<string>()
  // No transition until the first position is known, so the pill does not
  // slide in from the edge when the control first appears.
  const [settled, setSettled] = useState(false)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const active = list.querySelector<HTMLElement>(`[data-value="${value}"]`)
      if (!active) return
      const width = list.clientWidth
      const left = active.offsetLeft
      const right = width - left - active.offsetWidth
      setClip(`inset(0 ${right}px 0 ${left}px round 0.375rem)`)
    }
    measure()
    const frame = requestAnimationFrame(() => setSettled(true))
    // Labels can reflow (font load, sidebar resize): keep the clip on the segment.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(list)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [value, options.length])

  const segment = 'flex-1 whitespace-nowrap rounded-md px-3 py-1 text-center text-[13px] font-medium'

  return (
    <div className={`relative rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/[0.06] ${className}`}>
      <div
        ref={listRef}
        role={kind === 'tabs' ? 'tablist' : 'group'}
        aria-label={label}
        className="relative flex"
      >
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            data-value={option}
            role={kind === 'tabs' ? 'tab' : undefined}
            aria-selected={kind === 'tabs' ? value === option : undefined}
            aria-pressed={kind === 'toggle' ? value === option : undefined}
            onClick={() => onChange(option)}
            className={`${segment} text-slate-400 transition-colors duration-150 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400`}
          >
            {text}
          </button>
        ))}
        {/* The selected look, clipped to the selected segment. */}
        <div
          aria-hidden
          className={`${settled ? 'segmented-active' : ''} pointer-events-none absolute inset-0 flex rounded-md bg-ink-700 text-cyan-200 shadow-[var(--shadow-raised)]`}
          style={{ clipPath: clip ?? 'inset(0 100% 0 0)' }}
        >
          {options.map(([option, text]) => (
            <span key={option} className={segment}>
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
