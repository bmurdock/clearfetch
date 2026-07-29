import {
  createClient as createClientInternal,
} from './internal/execute-request.js'
import type { ClientDefaults, HttpClient, ResponseType } from './types.js'

/**
 * Creates a reusable HTTP client with shared defaults such as `baseURL`,
 * headers, timeout, retry behavior, hooks, and JSON parsing behavior.
 */
export function createClient<DefaultResponseType extends ResponseType>(
  defaults: Omit<ClientDefaults, 'responseType'> & {
    responseType: DefaultResponseType
  },
): HttpClient<DefaultResponseType> & HttpClient

export function createClient(
  defaults?: Omit<ClientDefaults, 'responseType'> & {
    responseType?: never
  },
): HttpClient<'json'>

export function createClient(
  defaults: ClientDefaults,
): HttpClient<ResponseType> & HttpClient

export function createClient(
  defaults: ClientDefaults = {},
): HttpClient<ResponseType> {
  return createClientInternal(defaults)
}
