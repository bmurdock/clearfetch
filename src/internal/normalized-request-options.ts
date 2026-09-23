import type { Hooks, QueryInput, RequestMethod, ResponseType, RetryOptions } from '../types.js'

/** Internal execution state; not part of the public package contract. */
export interface NormalizedRequestOptions {
  method: RequestMethod
  headers: Headers
  query?: QueryInput
  body?: BodyInit | null
  json?: unknown
  timeout?: number
  signal?: AbortSignal
  responseType: ResponseType
  retry: false | Required<RetryOptions>
  hooks: Required<Hooks>
  parseJson: (text: string) => unknown | PromiseLike<unknown>
}
