import {
  AbortRequestError,
  HttpClientError,
  NetworkError,
  TimeoutError,
} from '../errors.js'

export function normalizeExecutionError(params: {
  aborted?: boolean
  abortReason?: unknown
  error: unknown
  timeout?: number
}): HttpClientError {
  const { aborted, abortReason, error, timeout } = params

  if (error instanceof HttpClientError) {
    return error
  }

  if (aborted === true || isAbortError(error)) {
    if (timeout !== undefined) {
      return new TimeoutError(timeout, error)
    }

    return new AbortRequestError(
      'Request was aborted',
      aborted === true && abortReason !== undefined ? abortReason : error,
    )
  }

  return new NetworkError('Network request failed', error)
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}
