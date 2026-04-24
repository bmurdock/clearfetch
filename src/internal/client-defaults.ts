import type {
  ClientDefaults,
  Hooks,
  RetryOptions,
} from '../types.js'

export function mergeClientDefaults(
  parent: ClientDefaults,
  child: ClientDefaults,
): ClientDefaults {
  const merged: ClientDefaults = {}

  const baseURL = child.baseURL ?? parent.baseURL
  if (baseURL !== undefined) {
    merged.baseURL = baseURL
  }

  const timeout = child.timeout ?? parent.timeout
  if (timeout !== undefined) {
    merged.timeout = timeout
  }

  const responseType = child.responseType ?? parent.responseType
  if (responseType !== undefined) {
    merged.responseType = responseType
  }

  const retry = child.retry ?? parent.retry
  if (retry !== undefined) {
    merged.retry = retry
  }

  const parseJson = child.parseJson ?? parent.parseJson
  if (parseJson !== undefined) {
    merged.parseJson = parseJson
  }

  const headers = new Headers(parent.headers)
  const childHeaders = new Headers(child.headers)
  for (const [key, value] of childHeaders.entries()) {
    headers.set(key, value)
  }
  if ([...headers.keys()].length > 0) {
    merged.headers = headers
  }

  const hooks = {
    beforeRequest: [
      ...(parent.hooks?.beforeRequest ?? []),
      ...(child.hooks?.beforeRequest ?? []),
    ],
    afterResponse: [
      ...(parent.hooks?.afterResponse ?? []),
      ...(child.hooks?.afterResponse ?? []),
    ],
    onError: [
      ...(parent.hooks?.onError ?? []),
      ...(child.hooks?.onError ?? []),
    ],
  }

  if (hooks.beforeRequest.length + hooks.afterResponse.length + hooks.onError.length > 0) {
    merged.hooks = hooks
  }

  return merged
}

export function snapshotClientDefaults(defaults: ClientDefaults): ClientDefaults {
  const snapshot: ClientDefaults = {}

  if (defaults.baseURL !== undefined) {
    snapshot.baseURL =
      defaults.baseURL instanceof URL ? new URL(defaults.baseURL) : defaults.baseURL
  }

  if (defaults.headers !== undefined) {
    snapshot.headers = new Headers(defaults.headers)
  }

  if (defaults.timeout !== undefined) {
    snapshot.timeout = defaults.timeout
  }

  if (defaults.responseType !== undefined) {
    snapshot.responseType = defaults.responseType
  }

  if (defaults.retry !== undefined) {
    if (defaults.retry === false) {
      snapshot.retry = false
    } else {
      const retry: RetryOptions = {
        ...defaults.retry,
      }

      if (defaults.retry.retryOnStatuses !== undefined) {
        retry.retryOnStatuses = defaults.retry.retryOnStatuses.slice()
      }

      if (defaults.retry.retryOnMethods !== undefined) {
        retry.retryOnMethods = defaults.retry.retryOnMethods.slice()
      }

      snapshot.retry = retry
    }
  }

  if (defaults.hooks !== undefined) {
    const hooks: Hooks = {}

    if (defaults.hooks.beforeRequest !== undefined) {
      hooks.beforeRequest = defaults.hooks.beforeRequest.slice()
    }

    if (defaults.hooks.afterResponse !== undefined) {
      hooks.afterResponse = defaults.hooks.afterResponse.slice()
    }

    if (defaults.hooks.onError !== undefined) {
      hooks.onError = defaults.hooks.onError.slice()
    }

    snapshot.hooks = hooks
  }

  if (defaults.parseJson !== undefined) {
    snapshot.parseJson = defaults.parseJson
  }

  return snapshot
}
