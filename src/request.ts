import { executeRequest } from './internal/execute-request.js'
import type { RequestOptions } from './types.js'

export function request<T = unknown>(
  input: string | URL,
  options?: RequestOptions & { responseType?: 'json' },
): Promise<T | undefined>

export function request(
  input: string | URL,
  options: RequestOptions & { responseType: 'text' },
): Promise<string>

export function request(
  input: string | URL,
  options: RequestOptions & { responseType: 'blob' },
): Promise<Blob>

export function request(
  input: string | URL,
  options: RequestOptions & { responseType: 'arrayBuffer' },
): Promise<ArrayBuffer>

export function request(
  input: string | URL,
  options: RequestOptions & { responseType: 'raw' },
): Promise<Response>

export function request<T = unknown>(
  input: string | URL,
  options?: RequestOptions,
): Promise<T | Response | string | Blob | ArrayBuffer | undefined> {
  return executeRequest<T>(input, {}, options)
}
