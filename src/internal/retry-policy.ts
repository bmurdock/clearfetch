import { ConfigError, HttpError, NetworkError } from '../errors.js'
import type { HttpClientError } from '../errors.js'
import type { RequestMethod, RetryOptions } from '../types.js'

export const REQUEST_METHODS = new Set<RequestMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])

export const DEFAULT_RETRY: Required<RetryOptions> = {
  attempts: 3,
  backoffMs: 250,
  maxBackoffMs: 2_000,
  multiplier: 2,
  retryOnStatuses: [429, 502, 503, 504],
  retryOnMethods: ['GET', 'HEAD'],
}

export function normalizeRetry(
  defaultRetry?: false | RetryOptions,
  requestRetry?: false | RetryOptions,
): false | Required<RetryOptions> {
  const source = selectRetrySource(defaultRetry, requestRetry)
  if (source === false) {
    return false
  }

  const retry = buildRetry(source)
  validateRetryNumbers(retry)
  validateRetryOnStatuses(retry.retryOnStatuses)
  validateRetryOnMethods(retry.retryOnMethods)

  return retry
}

function selectRetrySource(
  defaultRetry?: false | RetryOptions,
  requestRetry?: false | RetryOptions,
): false | RetryOptions {
  if (requestRetry === false) {
    return false
  }

  const source = requestRetry ?? defaultRetry
  if (source === undefined || source === false) {
    return false
  }

  return source
}

function buildRetry(source: RetryOptions): Required<RetryOptions> {
  return {
    attempts: source.attempts ?? DEFAULT_RETRY.attempts,
    backoffMs: source.backoffMs ?? DEFAULT_RETRY.backoffMs,
    maxBackoffMs: source.maxBackoffMs ?? DEFAULT_RETRY.maxBackoffMs,
    multiplier: source.multiplier ?? DEFAULT_RETRY.multiplier,
    retryOnStatuses: source.retryOnStatuses ?? DEFAULT_RETRY.retryOnStatuses,
    retryOnMethods: source.retryOnMethods ?? DEFAULT_RETRY.retryOnMethods,
  }
}

function validateRetryNumbers(retry: Required<RetryOptions>): void {
  if (!Number.isInteger(retry.attempts) || retry.attempts <= 0) {
    throw new ConfigError('`retry.attempts` must be a positive integer')
  }

  if (!Number.isFinite(retry.backoffMs) || retry.backoffMs < 0) {
    throw new ConfigError('`retry.backoffMs` must be a non-negative finite number')
  }

  if (!Number.isFinite(retry.maxBackoffMs) || retry.maxBackoffMs < 0) {
    throw new ConfigError(
      '`retry.maxBackoffMs` must be a non-negative finite number',
    )
  }

  if (!Number.isFinite(retry.multiplier) || retry.multiplier < 1) {
    throw new ConfigError('`retry.multiplier` must be a finite number >= 1')
  }
}

function validateRetryOnStatuses(retryOnStatuses: number[]): void {
  if (!Array.isArray(retryOnStatuses)) {
    throw new ConfigError('`retry.retryOnStatuses` must be an array of status codes')
  }

  for (const status of retryOnStatuses) {
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new ConfigError(
        '`retry.retryOnStatuses` must contain valid HTTP status codes',
      )
    }
  }
}

function validateRetryOnMethods(retryOnMethods: string[]): void {
  if (!Array.isArray(retryOnMethods)) {
    throw new ConfigError('`retry.retryOnMethods` must be an array of methods')
  }

  for (const method of retryOnMethods) {
    if (typeof method !== 'string' || !REQUEST_METHODS.has(method as RequestMethod)) {
      throw new ConfigError(
        '`retry.retryOnMethods` must contain supported uppercase methods',
      )
    }
  }
}

export function shouldRetryError(
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

export function shouldRetryStatus(
  response: Response,
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

  return retry.retryOnStatuses.includes(response.status)
}

export function getRetryDelay(
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
