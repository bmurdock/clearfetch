import {
  AbortRequestError,
  ConfigError,
  HttpClientError,
  HttpError,
  NetworkError,
} from '../errors.js'
import type {
  AfterResponseContext,
  BeforeRequestContext,
  ClientDefaults,
  ErrorContext,
  Hooks,
  HttpClient,
  RequestMethod,
  RequestOptions,
  RetryOptions,
} from '../types.js'
import { normalizeExecutionError } from './normalize-error.js'
import {
  buildRequestFromContext,
  createBeforeRequestContext,
} from './normalize-request.js'
import { parseResponse } from './parse-response.js'

type FetchLike = typeof fetch

export async function executeRequest<T = unknown>(
  input: string | URL,
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<T | Response | string | Blob | ArrayBuffer | undefined> {
  const initialContext = createBeforeRequestContext(input, defaults, options)
  const maxAttempts =
    initialContext.options.retry === false ? 1 : initialContext.options.retry.attempts

  let lastError: HttpClientError | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const context = createBeforeRequestContext(input, defaults, options)
    let currentRequest: Request | undefined
    let currentResponse: Response | undefined

    try {
      await runBeforeRequestHooks(context)

      const timeout = createTimeoutController(
        context.options.signal,
        context.options.timeout,
      )

      try {
        const request = buildRequestFromContext(context, timeout.signal)
        currentRequest = request
        const response = await fetchWithHandling({
          attempt,
          context,
          fetchImpl,
          input,
          request,
          timeout,
        })
        currentResponse = response

        await runAfterResponseHooks({
          input,
          request,
          response: response.clone(),
          options: context.options,
        })

        return await parseWithHandling<T>({
          attempt,
          context,
          input,
          request,
          response,
          timeout,
        })
      } catch (error) {
        if (error instanceof RetrySignal) {
          lastError = error.error
          continue
        }
        throw error
      } finally {
        timeout.cleanup()
      }
    } catch (error) {
      if (error instanceof HttpClientError) {
        lastError = error
      }
      throw error
    }
  }

  throw lastError ?? new ConfigError('Request execution ended without a result')
}

export function createClient(defaults: ClientDefaults = {}): HttpClient {
  const frozenDefaults = snapshotClientDefaults(defaults)

  return {
    request: <T = unknown>(input: string | URL, options?: RequestOptions) =>
      executeRequest<T>(input, frozenDefaults, options),
    get: createMethodCaller(frozenDefaults, 'GET'),
    post: createMethodCaller(frozenDefaults, 'POST'),
    put: createMethodCaller(frozenDefaults, 'PUT'),
    patch: createMethodCaller(frozenDefaults, 'PATCH'),
    delete: createMethodCaller(frozenDefaults, 'DELETE'),
    head: createMethodCaller(frozenDefaults, 'HEAD'),
    options: createMethodCaller(frozenDefaults, 'OPTIONS'),
    extend: (childDefaults: ClientDefaults) =>
      createClient(mergeClientDefaults(frozenDefaults, childDefaults)),
  }
}

function createMethodCaller(
  defaults: ClientDefaults,
  method: RequestMethod,
): HttpClient['get'] {
  return <T = unknown>(
    input: string | URL,
    options: RequestOptions = {},
  ) => executeRequest<T>(input, defaults, { ...options, method })
}

function mergeClientDefaults(
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

function snapshotClientDefaults(defaults: ClientDefaults): ClientDefaults {
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

async function runBeforeRequestHooks(context: BeforeRequestContext): Promise<void> {
  for (const hook of context.options.hooks.beforeRequest) {
    await hook(context)
  }
}

async function runAfterResponseHooks(context: AfterResponseContext): Promise<void> {
  for (const hook of context.options.hooks.afterResponse) {
    await hook(context)
  }
}

async function runOnErrorHooks(context: ErrorContext): Promise<void> {
  for (const hook of context.options?.hooks.onError ?? []) {
    await hook(context)
  }
}

function shouldRetry(
  error: HttpClientError,
  method: RequestMethod,
  retry: false | Required<RetryOptions>,
  attempt: number,
): boolean {
  if (retry === false || attempt >= retry.attempts) {
    return false
  }

  if (!retry.retryOnMethods.includes(method)) {
    return false
  }

  if (error instanceof HttpError) {
    return retry.retryOnStatuses.includes(error.status)
  }

  return error instanceof NetworkError
}

function getRetryDelay(
  retry: false | { backoffMs: number; maxBackoffMs: number; multiplier: number },
  attempt: number,
): number {
  if (retry === false) {
    return 0
  }

  return Math.min(
    retry.backoffMs * retry.multiplier ** (attempt - 1),
    retry.maxBackoffMs,
  )
}

function createTimeoutController(signal?: AbortSignal, timeout?: number): {
  cleanup: () => void
  didTimeout: () => boolean
  signal?: AbortSignal
} {
  if (signal === undefined && timeout === undefined) {
    return {
      cleanup: () => undefined,
      didTimeout: () => false,
    }
  }

  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const onAbort = () => {
    controller.abort(signal?.reason)
  }

  if (signal?.aborted === true) {
    controller.abort(signal.reason)
  } else if (signal !== undefined) {
    signal.addEventListener('abort', onAbort, { once: true })
  }

  if (timeout !== undefined) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('Request timed out', 'AbortError'))
    }, timeout)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function sleep(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortReason = signal?.reason ?? new DOMException('Aborted', 'AbortError')

    if (signal?.aborted === true) {
      reject(abortReason)
      return
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, duration)

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      reject(abortReason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class RetrySignal {
  readonly error: HttpClientError

  constructor(error: HttpClientError) {
    this.error = error
  }
}

async function fetchWithHandling(params: {
  attempt: number
  context: BeforeRequestContext
  fetchImpl: FetchLike
  input: string | URL
  request: Request
  timeout: ReturnType<typeof createTimeoutController>
}): Promise<Response> {
  const {
    attempt,
    context,
    fetchImpl,
    input,
    request,
    timeout,
  } = params

  try {
    return await fetchImpl(request)
  } catch (error) {
    const normalized = normalizeExecutionError(
      context.options.timeout !== undefined && timeout.didTimeout()
        ? { error, timeout: context.options.timeout }
        : { error },
    )

    if (shouldRetry(normalized, context.options.method, context.options.retry, attempt)) {
      try {
        await sleep(getRetryDelay(context.options.retry, attempt), request.signal)
      } catch (delayError) {
        throw normalizeExecutionError(
          context.options.timeout !== undefined && timeout.didTimeout()
            ? { error: delayError, timeout: context.options.timeout }
            : { error: delayError },
        )
      }
      throw new RetrySignal(normalized)
    }

    const errorContext: ErrorContext = {
      input,
      error: normalized,
      options: context.options,
      request,
    }

    const errorResponse =
      normalized instanceof HttpError ? normalized.response : undefined
    if (errorResponse !== undefined) {
      errorContext.response = errorResponse
    }

    await runOnErrorHooks(errorContext)

    throw normalized
  }
}

async function parseWithHandling<T>(params: {
  attempt: number
  context: BeforeRequestContext
  input: string | URL
  request: Request
  response: Response
  timeout: ReturnType<typeof createTimeoutController>
}): Promise<T | Response | string | Blob | ArrayBuffer | undefined> {
  const { attempt, context, input, request, response, timeout } = params

  try {
    return (await parseResponse<T>({
      request,
      response,
      responseType: context.options.responseType,
      parseJson: context.options.parseJson,
    })) as T | Response | string | Blob | ArrayBuffer | undefined
  } catch (error) {
    const normalized = normalizeExecutionError(
      context.options.timeout !== undefined && timeout.didTimeout()
        ? { error, timeout: context.options.timeout }
        : { error },
    )

    if (shouldRetry(normalized, context.options.method, context.options.retry, attempt)) {
      try {
        await sleep(getRetryDelay(context.options.retry, attempt), request.signal)
      } catch (delayError) {
        throw normalizeExecutionError(
          context.options.timeout !== undefined && timeout.didTimeout()
            ? { error: delayError, timeout: context.options.timeout }
            : { error: delayError },
        )
      }
      throw new RetrySignal(normalized)
    }

    const errorContext: ErrorContext = {
      input,
      error: normalized,
      options: context.options,
      request,
      response: normalized instanceof HttpError ? normalized.response : response,
    }

    await runOnErrorHooks(errorContext)

    throw normalized
  }
}
