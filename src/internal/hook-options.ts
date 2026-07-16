import type {
  HookRequestOptions,
  NormalizedRequestOptions,
  PrimitiveQueryValue,
  QueryParams,
} from '../types.js'

export function createHookRequestOptions(
  options: NormalizedRequestOptions,
  metadata: HookLifecycleMetadata,
): HookRequestOptions {
  // Hooks get a read-only metadata view rather than the internal mutable
  // execution object. This keeps hook inspection useful without turning
  // `context.options` into a hidden mutation surface.
  const snapshot: HookRequestOptions = {
    method: options.method,
    attempt: metadata.attempt,
    maxAttempts: metadata.maxAttempts,
    responseType: options.responseType,
    retry:
      options.retry === false
        ? false
        : Object.freeze({
            ...options.retry,
            retryOnStatuses: Object.freeze([...options.retry.retryOnStatuses]),
            retryOnMethods: Object.freeze([...options.retry.retryOnMethods]),
          }),
    parseJson: options.parseJson,
  }

  if (metadata.queryString !== undefined) {
    Object.defineProperty(snapshot, 'queryString', {
      configurable: false,
      enumerable: true,
      value: metadata.queryString,
      writable: false,
    })
  }

  if (options.query !== undefined && !isURLSearchParams(options.query)) {
    Object.defineProperty(snapshot, 'query', {
      configurable: false,
      enumerable: true,
      value: freezeQueryParams(options.query),
      writable: false,
    })
  }

  if (options.timeout !== undefined) {
    Object.defineProperty(snapshot, 'timeout', {
      configurable: false,
      enumerable: true,
      value: options.timeout,
      writable: false,
    })
  }

  if (options.signal !== undefined) {
    Object.defineProperty(snapshot, 'signal', {
      configurable: false,
      enumerable: true,
      value: options.signal,
      writable: false,
    })
  }

  return Object.freeze(snapshot)
}

export interface HookLifecycleMetadata {
  attempt: number
  maxAttempts: number
  queryString?: string
}

function isURLSearchParams(value: unknown): value is URLSearchParams {
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

function freezeQueryParams(query: QueryParams): QueryParams {
  const snapshot: QueryParams = {}

  for (const [key, value] of Object.entries(query)) {
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: Array.isArray(value)
        ? Object.freeze([...value]) as PrimitiveQueryValue[]
        : value,
      writable: true,
    })
  }

  return Object.freeze(snapshot)
}
