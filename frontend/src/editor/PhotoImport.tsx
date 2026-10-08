import { useEffect, useState } from 'react'
import type { Api, Detection, Recognition, RecognitionWarning } from '../api'
import type { Schematic } from '../schematic/model'

/** Below this the detector was guessing; such parts are drawn amber for review. */
export const LOW_CONFIDENCE = 0.5

const MARKS = new Set(['text', 'junction', 'crossover'])

function detectionStyle(d: Detection): { stroke: string; label: string } {
  if (d.part_id) {
    const label = d.value_text ? `${d.part_id} ${d.value_text}` : d.part_id
    return { stroke: d.confidence < LOW_CONFIDENCE ? '#d97706' : '#0284c7', label }
  }
  if (d.label === 'other') return { stroke: '#dc2626', label: 'unsupported' }
  if (d.label === 'ground') return { stroke: '#475569', label: 'ground' }
  return { stroke: '#94a3b8', label: MARKS.has(d.label) ? '' : d.label }
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

  return (
    <section role="dialog" aria-label="Circuit from a photo" className="space-y-3 rounded-lg border border-sky-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Circuit from a photo</h2>
        <label className="cursor-pointer rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-700">
          {preview ? 'Choose another photo' : 'Choose a photo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Photo of a circuit"
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </label>
        <p className="text-xs text-slate-500">Dark pen on plain paper, photographed straight on, works best.</p>
        <button type="button" onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>

      {status.kind === 'working' && (
        <p role="status" className="text-sm text-slate-600">
          Recognizing…
        </p>
      )}
      {status.kind === 'failed' && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {status.message}
        </p>
      )}

      {preview && (
        <div className="relative max-h-[28rem] overflow-auto rounded-md border border-slate-200">
          <img src={preview} alt="Uploaded circuit" className="block w-full" />
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
                  <g key={i} data-testid={d.part_id ? `detected-${d.part_id}` : undefined}>
                    <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke={stroke} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    {label && (
                      <text x={x0} y={y0 - 4} fill={stroke} fontSize={Math.max(12, result.image.width / 60)} fontWeight={600}>
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
        <>
          <p className="text-sm text-slate-700">
            Found {partCount} part{partCount === 1 ? '' : 's'}.{' '}
            {partCount > 0 && 'Load it into the editor to check and correct it.'}
          </p>
          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
              {result.warnings.map((w) => (
                <li key={w.code}>
                  {w.message}
                  {w.part_ids.length > 0 && <span className="font-mono"> ({w.part_ids.join(', ')})</span>}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={partCount === 0}
            onClick={() => onLoad(result.schematic, result.warnings)}
            className="rounded-md bg-slate-800 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Load into editor
          </button>
        </>
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
    <section aria-label="Check the recognized circuit" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="mb-1 flex items-center">
        <h2 className="font-semibold">Check the recognized circuit</h2>
        <button type="button" onClick={onDismiss} className="ml-auto rounded px-2 text-amber-800 hover:bg-amber-100">
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
                  className="mr-1 rounded bg-white px-1.5 font-mono text-xs text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
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
