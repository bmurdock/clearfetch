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
): Promise<T | Response | undefined> {
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
        const response = await fetchImpl(request)
        currentResponse = response

        await runAfterResponseHooks({
          input,
          request,
          response,
          options: context.options,
        })

        return (await parseResponse<T>({
          request,
          response,
          responseType: context.options.responseType,
          parseJson: context.options.parseJson,
        })) as T | Response | undefined
      } catch (error) {
        const normalizeParams: { error: unknown; timeout?: number } = { error }
        if (timeout.didTimeout() && context.options.timeout !== undefined) {
          normalizeParams.timeout = context.options.timeout
        }

        const normalized = normalizeExecutionError(normalizeParams)

        if (shouldRetry(normalized, context.options.method, context.options.retry, attempt)) {
          await sleep(getRetryDelay(context.options.retry, attempt))
          lastError = normalized
          continue
        }

        const errorContext: ErrorContext = {
          input,
          error: normalized,
          options: context.options,
        }

        if (currentRequest !== undefined) {
          errorContext.request = currentRequest
        }

        const errorResponse =
          normalized instanceof HttpError ? normalized.response : currentResponse
        if (errorResponse !== undefined) {
          errorContext.response = errorResponse
        }

        await runOnErrorHooks(errorContext)

        throw normalized
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
  return {
    request: <T = unknown>(input: string | URL, options?: RequestOptions) =>
      executeRequest<T>(input, defaults, options),
    get: createMethodCaller(defaults, 'GET'),
    post: createMethodCaller(defaults, 'POST'),
    put: createMethodCaller(defaults, 'PUT'),
    patch: createMethodCaller(defaults, 'PATCH'),
    delete: createMethodCaller(defaults, 'DELETE'),
    head: createMethodCaller(defaults, 'HEAD'),
    options: createMethodCaller(defaults, 'OPTIONS'),
    extend: (childDefaults: ClientDefaults) =>
      createClient(mergeClientDefaults(defaults, childDefaults)),
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

function sleep(duration: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, duration)
  })
}
