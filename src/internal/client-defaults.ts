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

  mergeScalarDefaults(merged, parent, child)
  mergeHeaderDefaults(merged, parent, child)
  mergeHookDefaults(merged, parent, child)

  return merged
}

export function snapshotClientDefaults(defaults: ClientDefaults): ClientDefaults {
  const snapshot: ClientDefaults = {}

  snapshotBaseURL(snapshot, defaults)
  snapshotHeaders(snapshot, defaults)
  snapshotScalarDefaults(snapshot, defaults)
  snapshotRetryDefaults(snapshot, defaults)
  snapshotHookDefaults(snapshot, defaults)
  snapshotParseJsonDefault(snapshot, defaults)

  return snapshot
}

function mergeScalarDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
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
}

function mergeHeaderDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
  const headers = new Headers(parent.headers)
  const childHeaders = new Headers(child.headers)
  for (const [key, value] of childHeaders.entries()) {
    headers.set(key, value)
  }
  if ([...headers.keys()].length > 0) {
    merged.headers = headers
  }
}

function mergeHookDefaults(
  merged: ClientDefaults,
  parent: ClientDefaults,
  child: ClientDefaults,
): void {
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
}

function snapshotBaseURL(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.baseURL !== undefined) {
    snapshot.baseURL =
      defaults.baseURL instanceof URL ? new URL(defaults.baseURL) : defaults.baseURL
  }
}

function snapshotHeaders(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.headers !== undefined) {
    snapshot.headers = new Headers(defaults.headers)
  }
}

function snapshotScalarDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.timeout !== undefined) {
    snapshot.timeout = defaults.timeout
  }

  if (defaults.responseType !== undefined) {
    snapshot.responseType = defaults.responseType
  }
}

function snapshotRetryDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.retry !== undefined) {
    snapshot.retry = snapshotRetry(defaults.retry)
  }
}

function snapshotHookDefaults(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.hooks !== undefined) {
    snapshot.hooks = snapshotHooks(defaults.hooks)
  }
}

function snapshotParseJsonDefault(
  snapshot: ClientDefaults,
  defaults: ClientDefaults,
): void {
  if (defaults.parseJson !== undefined) {
    snapshot.parseJson = defaults.parseJson
  }
}

function snapshotRetry(retry: false | RetryOptions): false | RetryOptions {
  if (retry === false) {
    return false
  }

  const snapshot: RetryOptions = {
    ...retry,
  }

  copyRetryOnStatuses(snapshot, retry)
  copyRetryOnMethods(snapshot, retry)

  return snapshot
}

function copyRetryOnStatuses(
  snapshot: RetryOptions,
  retry: RetryOptions,
): void {
  if (retry.retryOnStatuses !== undefined) {
    snapshot.retryOnStatuses = retry.retryOnStatuses.slice()
  }
}

function copyRetryOnMethods(
  snapshot: RetryOptions,
  retry: RetryOptions,
): void {
  if (retry.retryOnMethods !== undefined) {
    snapshot.retryOnMethods = retry.retryOnMethods.slice()
  }
}

function snapshotHooks(hooks: Hooks): Hooks {
  const snapshot: Hooks = {}

  copyHookList(snapshot, 'beforeRequest', hooks.beforeRequest)
  copyHookList(snapshot, 'afterResponse', hooks.afterResponse)
  copyHookList(snapshot, 'onError', hooks.onError)

  return snapshot
}

function copyHookList<Key extends keyof Hooks>(
  snapshot: Hooks,
  key: Key,
  hooks: Hooks[Key],
): void {
  if (hooks !== undefined) {
    snapshot[key] = hooks.slice() as Hooks[Key]
  }
}
