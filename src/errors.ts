import type { ResponseType } from './types.js'

export class HttpClientError extends Error {
  readonly code: string
  declare readonly cause?: unknown

  constructor(message: string, code: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = new.target.name
    this.code = code
  }
}

export class ConfigError extends HttpClientError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIG_ERROR', cause)
  }
}

export class NetworkError extends HttpClientError {
  constructor(message = 'Network request failed', cause?: unknown) {
    super(message, 'NETWORK_ERROR', cause)
  }
}

export class TimeoutError extends HttpClientError {
  readonly timeout: number

  constructor(timeout: number, cause?: unknown) {
    super(`Request timed out after ${timeout}ms`, 'TIMEOUT_ERROR', cause)
    this.timeout = timeout
  }
}

export class AbortRequestError extends HttpClientError {
  constructor(message = 'Request was aborted', cause?: unknown) {
    super(message, 'ABORT_ERROR', cause)
  }
}

export class HttpError extends HttpClientError {
  readonly status: number
  readonly statusText: string
  readonly response: Response
  readonly request?: Request
  readonly bodyText?: string

  constructor(params: {
    status: number
    statusText: string
    response: Response
    request?: Request
    bodyText?: string
  }) {
    super(`HTTP ${params.status} ${params.statusText}`, 'HTTP_ERROR')
    this.status = params.status
    this.statusText = params.statusText
    this.response = params.response
    if (params.request !== undefined) {
      this.request = params.request
    }
    if (params.bodyText !== undefined) {
      this.bodyText = params.bodyText
    }
  }
}

export class ParseError extends HttpClientError {
  readonly response: Response
  readonly responseType: ResponseType
  readonly bodyText?: string

  constructor(params: {
    response: Response
    responseType: ResponseType
    bodyText?: string
    cause?: unknown
  }) {
    super(
      `Failed to parse response as ${params.responseType}`,
      'PARSE_ERROR',
      params.cause,
    )
    this.response = params.response
    this.responseType = params.responseType
    if (params.bodyText !== undefined) {
      this.bodyText = params.bodyText
    }
  }
}

export function isHttpClientError(error: unknown): error is HttpClientError {
  return error instanceof HttpClientError
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}
