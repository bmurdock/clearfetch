import { ConfigError } from '../errors.js'

export function snapshotRequestBody(body: BodyInit | null): BodyInit | null {
  if (body === null || typeof body === 'string') {
    return body
  }

  if (isURLSearchParams(body)) {
    return new URLSearchParams(URLSearchParams.prototype.toString.call(body))
  }

  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice()
  }

  const arrayBufferSnapshot = snapshotArrayBuffer(body)
  if (arrayBufferSnapshot !== undefined) {
    return arrayBufferSnapshot
  }

  const formDataSnapshot = snapshotFormData(body)
  if (formDataSnapshot !== undefined) {
    return formDataSnapshot
  }

  return body
}

export function isURLSearchParams(
  value: unknown,
): value is URLSearchParams {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  try {
    URLSearchParams.prototype.toString.call(value)
    return true
  } catch {
    return false
  }
}

export function isReadableStream(value: unknown): value is ReadableStream {
  if (
    typeof ReadableStream === 'undefined' ||
    typeof value !== 'object' ||
    value === null ||
    Object.prototype.toString.call(value) !== '[object ReadableStream]'
  ) {
    return false
  }

  const lockedGetter = Object.getOwnPropertyDescriptor(
    ReadableStream.prototype,
    'locked',
  )?.get
  if (lockedGetter === undefined) {
    return value instanceof ReadableStream
  }

  try {
    lockedGetter.call(value)
    return true
  } catch {
    return false
  }
}

function snapshotArrayBuffer(body: BodyInit): ArrayBuffer | undefined {
  if (Object.prototype.toString.call(body) !== '[object ArrayBuffer]') {
    return undefined
  }

  try {
    return ArrayBuffer.prototype.slice.call(body as ArrayBuffer, 0)
  } catch {
    return undefined
  }
}

function snapshotFormData(body: BodyInit): FormData | undefined {
  if (typeof FormData === 'undefined') {
    return undefined
  }

  const entries = getFormDataEntries(body)
  if (entries === undefined) {
    return undefined
  }

  const snapshot = new FormData()
  for (const [name, value] of entries) {
    if (typeof value === 'string') {
      snapshot.append(name, value)
      continue
    }

    const blobSnapshot = snapshotBlob(value)
    if (blobSnapshot === undefined) {
      throw new ConfigError(
        'Retry is not supported for FormData files that cannot be cloned safely',
      )
    }
    snapshot.append(name, blobSnapshot, value.name)
  }
  return snapshot
}

function snapshotBlob(value: Blob): Blob | undefined {
  if (typeof Blob === 'undefined') {
    return undefined
  }

  try {
    return Blob.prototype.slice.call(value, 0, value.size, value.type)
  } catch {
    return undefined
  }
}

function getFormDataEntries(
  body: BodyInit,
): IterableIterator<[string, FormDataEntryValue]> | undefined {
  try {
    return FormData.prototype.entries.call(body as FormData)
  } catch {
    // Some browser-like runtimes implement each realm with a distinct class
    // whose platform brand cannot be checked by the current realm's intrinsic.
  }

  if (!hasFormDataShape(body)) {
    return undefined
  }

  try {
    return body.entries()
  } catch {
    return undefined
  }
}

function hasFormDataShape(value: unknown): value is FormData {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as FormData
  try {
    return (
      candidate.constructor?.name === 'FormData' &&
      typeof candidate.append === 'function' &&
      typeof candidate.delete === 'function' &&
      typeof candidate.entries === 'function' &&
      typeof candidate.get === 'function' &&
      typeof candidate.getAll === 'function' &&
      typeof candidate.has === 'function' &&
      typeof candidate.set === 'function'
    )
  } catch {
    return false
  }
}
