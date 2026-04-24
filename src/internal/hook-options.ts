import type {
  HookRequestOptions,
  NormalizedRequestOptions,
  PrimitiveQueryValue,
  QueryParams,
} from '../types.js'

export function createHookRequestOptions(
  options: NormalizedRequestOptions,
): HookRequestOptions {
  // Hooks get a read-only metadata view rather than the internal mutable
  // execution object. This keeps hook inspection useful without turning
  // `context.options` into a hidden mutation surface.
  const snapshot: HookRequestOptions = {
    method: options.method,
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

  if (options.query !== undefined) {
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

function freezeQueryParams(query: QueryParams): QueryParams {
  const snapshot: QueryParams = {}

  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      snapshot[key] = Object.freeze([...value]) as PrimitiveQueryValue[]
      continue
    }

    snapshot[key] = value
  }

  return Object.freeze(snapshot)
}
