/**
 * Circuits as links and files.
 *
 * A link carries the whole drawing in the URL fragment (`#c=...`), so sharing
 * works on the static website with no server, and the fragment never reaches
 * any server's logs. Files are the same JSON, for keeping circuits offline.
 */

import { KINDS, type Point, type Schematic } from './model'

const FORMAT = 'schematica/schematic'
const VERSION = 1

interface Envelope {
  format: typeof FORMAT
  version: number
  schematic: Schematic
}

export class ShareError extends Error {}

export function toJson(schematic: Schematic): string {
  const envelope: Envelope = { format: FORMAT, version: VERSION, schematic }
  return JSON.stringify(envelope, null, 2)
}

/** Parses a saved file or link payload, checking every field: it may come from anyone. */
export function fromJson(text: string): Schematic {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ShareError('This is not a Schematica circuit file (it is not valid JSON).')
  }
  const envelope = data as Partial<Envelope>
  if (envelope?.format !== FORMAT) throw new ShareError('This is not a Schematica circuit file.')
  if (envelope.version !== VERSION) throw new ShareError(`This file is format version ${envelope.version}, which this version cannot read.`)
  return validate(envelope.schematic)
}

const isInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 10_000
const isPoint = (p: unknown): p is Point => isInt((p as Point)?.x) && isInt((p as Point)?.y)
const isId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z]{1,3}\d{1,5}$/.test(id)

function validate(s: unknown): Schematic {
  const bad = (what: string) => new ShareError(`The circuit is damaged (${what}).`)
  const { parts, wires, grounds } = (s ?? {}) as Partial<Schematic>
  if (!Array.isArray(parts) || !Array.isArray(wires) || !Array.isArray(grounds)) throw bad('missing parts, wires or grounds')
  if (parts.length + wires.length + grounds.length > 2000) throw bad('too many elements')
  for (const p of parts) {
    if (!isId(p.id) || !(p.kind in KINDS) || !isPoint(p.a) || !isPoint(p.b)) throw bad(`part ${String(p.id)}`)
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) throw bad(`value of ${p.id}`)
    if (p.initial !== undefined && !Number.isFinite(p.initial)) throw bad(`initial value of ${p.id}`)
  }
  for (const w of wires) if (!isId(w.id) || !isPoint(w.a) || !isPoint(w.b)) throw bad(`wire ${String(w.id)}`)
  for (const g of grounds) if (!isId(g.id) || !isPoint(g.at)) throw bad(`ground ${String(g.id)}`)
  const ids = [...parts, ...wires, ...grounds].map((e) => e.id)
  if (new Set(ids).size !== ids.length) throw bad('repeated ids')
  // Rebuild from the checked fields only, dropping anything extra.
  return {
    parts: parts.map(({ id, kind, a, b, value, initial }) => ({ id, kind, a: { ...a }, b: { ...b }, value, ...(initial === undefined ? {} : { initial }) })),
    wires: wires.map(({ id, a, b }) => ({ id, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } })),
    grounds: grounds.map(({ id, at }) => ({ id, at: { x: at.x, y: at.y } })),
  }
}

// URL-safe base64 of the UTF-8 JSON (compact, no whitespace).
function encode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(text: string): string {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function toHash(schematic: Schematic): string {
  return `#c=${encode(JSON.stringify({ format: FORMAT, version: VERSION, schematic }))}`
}

/** The circuit in a `#c=...` fragment, or undefined if there is none. */
export function fromHash(hash: string): Schematic | undefined {
  const match = /^#c=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) return undefined
  let text: string
  try {
    text = decode(match[1]!)
  } catch {
    throw new ShareError('This link is incomplete or damaged.')
  }
  return fromJson(text)
}
