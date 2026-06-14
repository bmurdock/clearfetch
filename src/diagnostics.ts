import type { RedactHeadersOptions } from './types.js'

const DEFAULT_REDACTED_HEADER_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
]

const DEFAULT_REPLACEMENT = '[redacted]'

export function redactHeaders(
  headers: HeadersInit,
  options: RedactHeadersOptions = {},
): Headers {
  const redacted = new Headers(headers)
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT
  const sensitiveNames = new Set(
    (options.headerNames ?? DEFAULT_REDACTED_HEADER_NAMES).map((name) =>
      name.toLowerCase(),
    ),
  )

  for (const [name] of redacted.entries()) {
    if (sensitiveNames.has(name.toLowerCase())) {
      redacted.set(name, replacement)
    }
  }

  return redacted
}
