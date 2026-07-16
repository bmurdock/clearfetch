import { ConfigError } from '../errors.js'
import type {
  PrimitiveQueryValue,
  QueryInput,
  QueryParams,
} from '../types.js'
import { isURLSearchParams } from './platform-values.js'

export function snapshotQueryInput(query: QueryInput): QueryInput {
  if (isURLSearchParams(query)) {
    return new URLSearchParams(URLSearchParams.prototype.toString.call(query))
  }

  const snapshot: QueryParams = {}
  for (const [key, value] of Object.entries(query)) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: Array.isArray(value) ? [...value] : value,
      writable: true,
    })
  }
  return snapshot
}

export function serializeQueryParams(query?: QueryInput): string {
  if (query === undefined) {
    return ''
  }

  validateQueryInput(query)
  return serializeValidatedQueryParams(query)
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

export function validateQueryInput(
  query: unknown,
): asserts query is QueryInput {
  if (isURLSearchParams(query)) {
    return
  }

  if (!isQueryParamsRecord(query)) {
    throw new ConfigError('`query` must be a record or URLSearchParams')
  }

  validateQueryParams(query)
}

function serializeScalarQueryValue(value: PrimitiveQueryValue): string {
  if (value === null) {
    return 'null'
  }

  return String(value)
}

function validateQueryParams(query: QueryParams): void {
  for (const [key, value] of Object.entries(query)) {
    validateQueryValue(key, value)
  }
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

function validateQueryValue(key: string, value: QueryParams[string]): void {
  if (value === undefined) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateQueryScalarValue(key, item)
    }
    return
  }

  validateQueryScalarValue(key, value)
}

function validateQueryScalarValue(key: string, value: unknown): void {
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
