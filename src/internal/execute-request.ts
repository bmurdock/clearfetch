import {
  ConfigError,
  HttpClientError,
  HttpError,
} from '../errors.js'
import type {
  AfterResponseContext,
  AfterResponseHook,
  ClientDefaults,
  ErrorContext,
  HttpClient,
  OnErrorHook,
  RequestMethod,
  RequestOptions,
} from '../types.js'
import {
  mergeClientDefaults,
  snapshotClientDefaults,
} from './client-defaults.js'
import { normalizeExecutionError } from './normalize-error.js'
import {
  buildRequestFromContext,
  createBeforeRequestContext,
  type ExecutionBeforeRequestContext,
} from './normalize-request.js'
import { parseResponse } from './parse-response.js'
import {
  getRetryDelay,
  shouldRetryError,
  shouldRetryStatus,
} from './retry-policy.js'
import {
  createTimeoutController,
  sleep,
} from './timeout-controller.js'

type FetchLike = typeof fetch

export async function executeRequest<T = unknown>(
  input: string | URL,
  defaults: ClientDefaults = {},
  options: RequestOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<T | Response | string | Blob | ArrayBuffer | undefined> {
  // Determine retry bounds from a normalized first pass, then rebuild the
  // full execution context per attempt so hook mutations do not leak across retries.
  const initialContext = createBeforeRequestContext(input, defaults, options)
  const maxAttempts =
    initialContext._internalOptions.retry === false
      ? 1
      : initialContext._internalOptions.retry.attempts

  let lastError: HttpClientError | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const context =
      attempt === 1
        ? initialContext
        : createBeforeRequestContext(input, defaults, options)

    try {
      await runBeforeRequestHooks(context)

      const timeout = createTimeoutController(
        context._internalOptions.signal,
        context._internalOptions.timeout,
      )

      try {
        const request = buildRequestFromContext(context, timeout.signal)
        const response = await fetchWithHandling({
          attempt,
          context,
          fetchImpl,
          input,
          request,
          timeout,
        })

        const afterResponseHooks = context._internalOptions.hooks.afterResponse
        if (afterResponseHooks.length > 0) {
          await runAfterResponseHooks({
            input,
            request,
            response: response.clone(),
            options: context.options,
          }, afterResponseHooks)
        }

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
  // Snapshot defaults once so client behavior does not drift if caller-owned
  // objects are mutated after client creation.
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

async function runBeforeRequestHooks(
  context: ExecutionBeforeRequestContext,
): Promise<void> {
  for (const hook of context._internalOptions.hooks.beforeRequest) {
    await hook(context)
  }
}

async function runAfterResponseHooks(
  context: AfterResponseContext,
  hooks: AfterResponseHook[],
): Promise<void> {
  for (const hook of hooks) {
    await hook(context)
  }
}

async function runOnErrorHooks(
  context: ErrorContext,
  hooks: OnErrorHook[],
): Promise<void> {
  for (const hook of hooks) {
    await hook(context)
  }
}

class RetrySignal {
  readonly error: HttpClientError

  constructor(error: HttpClientError) {
    this.error = error
  }
}

async function fetchWithHandling(params: {
  attempt: number
  context: ExecutionBeforeRequestContext
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
      context._internalOptions.timeout !== undefined && timeout.didTimeout()
        ? { error, timeout: context._internalOptions.timeout }
        : { error },
    )

    if (
      shouldRetryError(
        normalized,
        context._internalOptions.method,
        context._internalOptions.retry,
        attempt,
      )
    ) {
      try {
        await sleep(
          getRetryDelay(context._internalOptions.retry, attempt),
          request.signal,
        )
      } catch (delayError) {
        throw normalizeExecutionError(
          context._internalOptions.timeout !== undefined && timeout.didTimeout()
            ? { error: delayError, timeout: context._internalOptions.timeout }
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

    await runOnErrorHooks(errorContext, context._internalOptions.hooks.onError)

    throw normalized
  }
}

async function parseWithHandling<T>(params: {
  attempt: number
  context: ExecutionBeforeRequestContext
  input: string | URL
  request: Request
  response: Response
  timeout: ReturnType<typeof createTimeoutController>
}): Promise<T | Response | string | Blob | ArrayBuffer | undefined> {
  const { attempt, context, input, request, response, timeout } = params

  if (
    !response.ok &&
    shouldRetryStatus(
      response,
      context._internalOptions.method,
      context._internalOptions.retry,
      attempt,
    )
  ) {
    try {
      await sleep(
        getRetryDelay(context._internalOptions.retry, attempt),
        request.signal,
      )
    } catch (delayError) {
      throw normalizeExecutionError(
        context._internalOptions.timeout !== undefined && timeout.didTimeout()
          ? { error: delayError, timeout: context._internalOptions.timeout }
          : { error: delayError },
      )
    }

    throw new RetrySignal(new HttpError({
      status: response.status,
      statusText: response.statusText,
      response,
      request,
    }))
  }

  try {
    return (await parseResponse<T>({
      request,
      response,
      responseType: context._internalOptions.responseType,
      parseJson: context._internalOptions.parseJson,
    })) as T | Response | string | Blob | ArrayBuffer | undefined
  } catch (error) {
    const normalized = normalizeExecutionError(
      context._internalOptions.timeout !== undefined && timeout.didTimeout()
        ? { error, timeout: context._internalOptions.timeout }
        : { error },
    )

    if (
      shouldRetryError(
        normalized,
        context._internalOptions.method,
        context._internalOptions.retry,
        attempt,
      )
    ) {
      try {
        await sleep(
          getRetryDelay(context._internalOptions.retry, attempt),
          request.signal,
        )
      } catch (delayError) {
        throw normalizeExecutionError(
          context._internalOptions.timeout !== undefined && timeout.didTimeout()
            ? { error: delayError, timeout: context._internalOptions.timeout }
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

    await runOnErrorHooks(errorContext, context._internalOptions.hooks.onError)

    throw normalized
  }
}
