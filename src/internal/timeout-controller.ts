export function createTimeoutController(signal?: AbortSignal, timeout?: number): {
  cleanup: () => void
  didTimeout: () => boolean
  signal?: AbortSignal
} {
  if (signal === undefined && timeout === undefined) {
    return {
      cleanup: () => undefined,
      didTimeout: () => false,
    }
  }

  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const onAbort = () => {
    controller.abort(signal?.reason)
  }

  if (signal?.aborted === true) {
    controller.abort(signal.reason)
  } else if (signal !== undefined) {
    signal.addEventListener('abort', onAbort, { once: true })
  }

  if (timeout !== undefined) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('Request timed out', 'AbortError'))
    }, timeout)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }

      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export function sleep(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortReason = signal?.reason ?? new DOMException('Aborted', 'AbortError')

    if (signal?.aborted === true) {
      reject(abortReason)
      return
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, duration)

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      reject(abortReason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
