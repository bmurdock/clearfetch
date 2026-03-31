import { executeRequest } from './internal/execute-request.js'
import type { RequestOptions } from './types.js'

export function request<T = unknown>(
  input: string | URL,
  options?: RequestOptions,
): Promise<T | Response | undefined> {
  return executeRequest<T>(input, {}, options)
}
