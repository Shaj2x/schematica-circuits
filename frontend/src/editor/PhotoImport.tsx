import { useEffect, useState } from 'react'
import type { Api, Detection, Recognition, RecognitionWarning } from '../api'
import type { Schematic } from '../schematic/model'

/** Below this the detector was guessing; such parts are drawn amber for review. */
export const LOW_CONFIDENCE = 0.5

const MARKS = new Set(['text', 'junction', 'crossover'])

function detectionStyle(d: Detection): { stroke: string; label: string } {
  if (d.part_id) {
    const label = d.value_text ? `${d.part_id} ${d.value_text}` : d.part_id
    return { stroke: d.confidence < LOW_CONFIDENCE ? '#fbbf24' : '#22d3ee', label }
  }
  if (d.label === 'other') return { stroke: '#f87171', label: 'unsupported' }
  if (d.label === 'ground') return { stroke: '#94a3b8', label: 'ground' }
  return { stroke: '#64748b', label: MARKS.has(d.label) ? '' : d.label }
}

interface PhotoImportProps {
  api: Api
  onLoad: (schematic: Schematic, warnings: RecognitionWarning[]) => void
  onClose: () => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; result: Recognition }

/**
 * Upload a photo of a hand-drawn circuit, see what was recognized drawn over
 * it, and load it into the editor to correct. Nothing replaces the drawing
 * until the user has seen the result and pressed Load.
 */
export function PhotoImport({ api, onLoad, onClose }: PhotoImportProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [preview, setPreview] = useState<string>()
  const [dragging, setDragging] = useState(false)

  // Object URLs hold the image in memory until revoked.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function choose(file: File | undefined) {
    if (!file) return
    setPreview(URL.createObjectURL(file))
    setStatus({ kind: 'working' })
    try {
      setStatus({ kind: 'done', result: await api.recognize(file) })
    } catch (e) {
      setStatus({ kind: 'failed', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const result = status.kind === 'done' ? status.result : undefined
  const partCount = result?.schematic.parts.length ?? 0

  const input = (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      aria-label="Photo of a circuit"
      className="sr-only"
      onChange={(e) => choose(e.target.files?.[0])}
    />
  )

  return (
    <section
      role="dialog"
      aria-label="Circuit from a photo"
      className="ui-enter space-y-4 rounded-xl bg-white/[0.06] p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-white">Circuit from a photo</h2>
          <p className="text-xs text-slate-400">Dark pen on plain paper, photographed straight on, works best.</p>
        </div>
        {preview && (
          <label className="btn btn-secondary ml-auto cursor-pointer">
            Choose another photo
            {input}
          </label>
        )}
        <button type="button" onClick={onClose} className={`btn btn-ghost ${preview ? '' : 'ml-auto'}`}>
          Cancel
        </button>
      </div>

      {!preview && (
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            choose(e.dataTransfer.files[0])
          }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors duration-150 ${
            dragging ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/15 bg-white/[0.02] hover:border-white/25'
          }`}
        >
          <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-slate-500" aria-hidden>
            <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5M12 15V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-medium text-slate-200">Drop a photo here, or click to choose one</span>
          <span className="text-xs text-slate-400">PNG, JPEG or WebP, up to 15 MB</span>
          {input}
        </label>
      )}

      {status.kind === 'failed' && (
        <p role="alert" className="ui-enter rounded-lg bg-red-500/10 p-2.5 text-sm text-red-200 ring-1 ring-red-400/30 ring-inset">
          {status.message}
        </p>
      )}

      {preview && (
        <div className="relative max-h-[28rem] overflow-auto rounded-lg bg-white/[0.05] ring-1 ring-white/[0.06]">
          <img
            src={preview}
            alt="Uploaded circuit"
            className={`block w-full transition-[opacity,filter] duration-300 ${status.kind === 'working' ? 'opacity-70 saturate-50' : ''}`}
          />
          {status.kind === 'working' && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="scan-beam h-1/2 w-full" />
              </div>
              <p
                role="status"
                className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink-950/85 px-3 py-1 text-xs font-medium text-white backdrop-blur"
              >
                Recognizing…
              </p>
            </>
          )}
          {result && (
            <svg
              viewBox={`0 0 ${result.image.width} ${result.image.height}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-label="Recognized symbols"
              role="img"
            >
              {result.detections.map((d, i) => {
                const { stroke, label } = detectionStyle(d)
                const [x0, y0, x1, y1] = d.box
                return (
                  <g
                    key={i}
                    data-testid={d.part_id ? `detected-${d.part_id}` : undefined}
                    className="detect-box"
                    // Found one by one, in the order the detector is most sure of.
                    style={{ animationDelay: `${Math.min(i * 35, 600)}ms` }}
                  >
                    <rect
                      x={x0}
                      y={y0}
                      width={x1 - x0}
                      height={y1 - y0}
                      rx={4}
                      fill={stroke}
                      fillOpacity={0.08}
                      stroke={stroke}
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                    {label && (
                      <text
                        x={x0}
                        y={y0 - 5}
                        fill={stroke}
                        fontSize={Math.max(12, result.image.width / 60)}
                        fontWeight={600}
                        paintOrder="stroke"
                        stroke="#05080f"
                        strokeWidth={3}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      )}

      {result && (
        <div className="ui-enter space-y-3">
          <p className="text-sm text-slate-200">
            <span className="font-semibold text-white">
              Found {partCount} part{partCount === 1 ? '' : 's'}.
            </span>{' '}
            {partCount > 0 && 'Load it into the editor to check and correct it.'}
          </p>
          {result.warnings.length > 0 && (
            <ul className="space-y-1.5 text-sm text-amber-100">
              {result.warnings.map((w) => (
                <li key={w.code} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>
                    {w.message}
                    {w.part_ids.length > 0 && <span className="readout text-amber-200"> ({w.part_ids.join(', ')})</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={partCount === 0}
            onClick={() => onLoad(result.schematic, result.warnings)}
            className="btn btn-primary font-semibold"
          >
            Load into editor
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * After loading a recognized circuit: what to check, with each part named as
 * a button that selects it in the editor. Stays until dismissed or the
 * drawing is replaced.
 */
export function ReviewList({
  warnings,
  onSelect,
  onDismiss,
}: {
  warnings: RecognitionWarning[]
  onSelect: (id: string) => void
  onDismiss: () => void
}) {
  return (
    <section
      aria-label="Check the recognized circuit"
      className="ui-enter rounded-xl bg-amber-400/10 p-3.5 text-sm text-amber-100 shadow-[var(--shadow-card)] ring-1 ring-amber-400/25 ring-inset"
    >
      <div className="mb-1 flex items-center">
        <h2 className="font-semibold">Check the recognized circuit</h2>
        <button type="button" onClick={onDismiss} className="btn ml-auto px-2.5 py-1 text-amber-100 hover:bg-amber-400/15">
          Done
        </button>
      </div>
      {warnings.length === 0 ? (
        <p>Nothing looked uncertain, but compare it with your drawing before trusting the results.</p>
      ) : (
        <ul className="space-y-1">
          {warnings.map((w) => (
            <li key={w.code}>
              {w.message}{' '}
              {w.part_ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  className="btn readout mr-1 rounded-md bg-white/[0.06] px-1.5 py-0 text-xs text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-400/15"
                >
                  {id}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
