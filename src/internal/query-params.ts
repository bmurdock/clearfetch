import { ConfigError } from '../errors.js'
import type {
  PrimitiveQueryValue,
  QueryInput,
  QueryParams,
} from '../types.js'
import { isURLSearchParams } from './platform-values.js'

export function snapshotQueryInput(query: unknown): QueryInput {
  if (isURLSearchParams(query)) {
    return new URLSearchParams(URLSearchParams.prototype.toString.call(query))
  }

  if (!isQueryParamsRecord(query)) {
    throw new ConfigError('`query` must be a record or URLSearchParams')
  }

  const snapshot: QueryParams = {}
  for (const [key, value] of Object.entries(query)) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: snapshotQueryValue(key, value),
      writable: true,
    })
  }
  return snapshot
}

export function freezeQueryInput(query: QueryInput): QueryInput {
  if (isURLSearchParams(query)) {
    return query
  }

  for (const value of Object.values(query)) {
    if (Array.isArray(value)) {
      Object.freeze(value)
    }
  }

  return Object.freeze(query)
}

export function isFrozenQueryInput(query: QueryInput): boolean {
  if (isURLSearchParams(query) || !Object.isFrozen(query)) {
    return false
  }

  return Object.values(query).every(
    (value) => !Array.isArray(value) || Object.isFrozen(value),
  )
}

export function serializeQueryParams(query?: QueryInput): string {
  if (query === undefined) {
    return ''
  }

  return serializeValidatedQueryParams(snapshotQueryInput(query))
}

export function serializeValidatedQueryParams(query?: QueryInput): string {
  if (query === undefined) {
    return ''
  }

  if (isURLSearchParams(query)) {
    return URLSearchParams.prototype.toString.call(query)
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, serializeScalarQueryValue(item))
      }
      continue
    }

    params.append(key, serializeScalarQueryValue(value))
  }

  return params.toString()
}

export function applyQueryString(url: URL, queryString: string): void {
  if (queryString === '') {
    return
  }

  const suffix = url.search === '' ? queryString : `&${queryString}`
  url.search += suffix
}

function serializeScalarQueryValue(value: PrimitiveQueryValue): string {
  if (value === null) {
    return 'null'
  }

  return String(value)
}

function isQueryParamsRecord(value: unknown): value is QueryParams {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  try {
    return Object.prototype.toString.call(value) === '[object Object]'
  } catch {
    return false
  }
}

function snapshotQueryValue(
  key: string,
  value: unknown,
): QueryParams[string] {
  if (value === undefined) {
    return undefined
  }

  if (Array.isArray(value)) {
    const snapshot: PrimitiveQueryValue[] = []
    for (const item of value) {
      validateQueryScalarValue(key, item)
      snapshot.push(item)
    }
    return snapshot
  }

  validateQueryScalarValue(key, value)
  return value
}

function validateQueryScalarValue(
  key: string,
  value: unknown,
): asserts value is PrimitiveQueryValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return
  }

  throw new ConfigError(
    `Unsupported query value for \`${key}\`; only string, number, boolean, null, arrays, and undefined are allowed`,
  )
}
