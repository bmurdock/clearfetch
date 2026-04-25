export async function withMockedFetch<T>(
  fetchImpl: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl

  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

export async function withPatchedResponseMethod<
  K extends 'clone' | 'text',
  T,
>(
  method: K,
  replacement: Response[K],
  run: () => Promise<T>,
): Promise<T> {
  const original = Response.prototype[method]
  Response.prototype[method] = replacement

  try {
    return await run()
  } finally {
    Response.prototype[method] = original
  }
}
