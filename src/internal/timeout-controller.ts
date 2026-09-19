export const MAX_TIMER_DELAY_MS = 2_147_483_647

interface RetainedAbortListener {
  source: WeakRef<AbortSignal>
  listener: () => void
}

const retainedAbortListeners = new FinalizationRegistry<RetainedAbortListener>(
  removeRetainedAbortListener,
)
const rawBodyControllers = new WeakMap<ReadableStream<Uint8Array>, {
  controller: AbortController
  request: Request
}>()

function removeRetainedAbortListener(link: RetainedAbortListener): void {
  link.source.deref()?.removeEventListener('abort', link.listener)
}

// Keep this factory separate so the source's listener cannot capture the
// controller through the lexical environment of the handoff function.
function createWeakAbortListener(
  source: WeakRef<AbortSignal>,
  target: WeakRef<AbortController>,
): () => void {
  return () => target.deref()?.abort(source.deref()?.reason)
}

export function createTimeoutController(signal?: AbortSignal, timeout?: number): {
  abort: (reason?: unknown) => void
  cleanup: () => void
  retainExternalAbort: (body: ReadableStream<Uint8Array> | null, request: Request) => void
  didTimeout: () => boolean
  signal: AbortSignal
} {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const clearTimeoutId = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
  }

  const onAbort = () => {
    clearTimeoutId()
    controller.abort(signal?.reason)
  }

  if (signal?.aborted === true) {
    controller.abort(signal.reason)
  } else if (signal !== undefined) {
    signal.addEventListener('abort', onAbort, { once: true })
  }

  if (timeout !== undefined && !controller.signal.aborted) {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort(new DOMException('Request timed out', 'AbortError'))
    }, timeout)
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    abort: (reason?: unknown) => {
      clearTimeoutId()
      controller.abort(reason)
    },
    retainExternalAbort: (body, request) => {
      if (body === null || signal === undefined || controller.signal.aborted) {
        return
      }

      // A raw Response may still be streaming after attempt cleanup. Keep
      // cancellation connected without letting a long-lived caller signal
      // strongly retain the completed request. Anchor the controller to the
      // body, since a caller may retain only a reader. Retain the Request too:
      // its signal alone may not keep its native controller alive.
      const source = new WeakRef(signal)
      const link = {
        source,
        listener: createWeakAbortListener(source, new WeakRef(controller)),
      }
      rawBodyControllers.set(body, { controller, request })
      retainedAbortListeners.register(controller, link, controller)
      const bodyRef = new WeakRef(body)
      controller.signal.addEventListener('abort', () => {
        removeRetainedAbortListener(link)
        retainedAbortListeners.unregister(controller)
        const retainedBody = bodyRef.deref()
        if (retainedBody !== undefined) {
          rawBodyControllers.delete(retainedBody)
        }
      }, { once: true })
      signal.addEventListener('abort', link.listener, { once: true })
    },
    cleanup: () => {
      clearTimeoutId()

      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export function sleep(duration: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, duration)

    const onAbort = () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
