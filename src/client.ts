import {
  createClient as createClientInternal,
} from './internal/execute-request.js'
import type { ClientDefaults, HttpClient } from './types.js'

/**
 * Creates a reusable HTTP client with shared defaults such as `baseURL`,
 * headers, timeout, retry behavior, hooks, and JSON parsing behavior.
 */
export function createClient(defaults: ClientDefaults = {}): HttpClient {
  return createClientInternal(defaults)
}
