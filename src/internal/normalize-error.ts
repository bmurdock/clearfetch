import {
  AbortRequestError,
  HttpClientError,
  NetworkError,
  TimeoutError,
} from '../errors.js'

export function normalizeExecutionError(params: {
  error: unknown
  timeout?: number
}): HttpClientError {
  const { error, timeout } = params

  if (error instanceof HttpClientError) {
    return error
  }

  if (isAbortError(error)) {
    if (timeout !== undefined) {
      return new TimeoutError(timeout, error)
    }

    return new AbortRequestError('Request was aborted', error)
  }

  return new NetworkError('Network request failed', error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
