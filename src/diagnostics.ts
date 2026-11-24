import type { RedactHeadersOptions } from './types.js'
import { SENSITIVE_HEADER_NAMES } from './internal/sensitive-headers.js'

const DEFAULT_REPLACEMENT = '[redacted]'

export function redactHeaders(
  headers: HeadersInit,
  options: RedactHeadersOptions = {},
): Headers {
  const redacted = new Headers(headers)
  const replacement = options.replacement ?? DEFAULT_REPLACEMENT
  const sensitiveNames = new Set(
    [...SENSITIVE_HEADER_NAMES, ...(options.headerNames ?? [])].map((name) =>
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
