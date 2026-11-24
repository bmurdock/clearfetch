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
  dependentSignal: AbortSignal | undefined
}>()
// Node's Request owns the controller that forwards aborts to its signal.
const activeRequests = new WeakMap<AbortController, Request>()

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

function createRetainedAbortCleanup(
  link: RetainedAbortListener,
  controller: AbortController,
  body: WeakRef<ReadableStream<Uint8Array>>,
): () => void {
  return () => {
    removeRetainedAbortListener(link)
    retainedAbortListeners.unregister(controller)
    const retainedBody = body.deref()
    if (retainedBody !== undefined) {
      rawBodyControllers.delete(retainedBody)
    }
  }
}

export function observeAbortSignal(signal: AbortSignal): AbortSignal {
  // A native dependent signal aborts even when a listener on the caller's
  // signal stops propagation.
  if (typeof AbortSignal.any === 'function') {
    try {
      return AbortSignal.any([signal])
    } catch (error) {
      // Mixed fetch implementations may use a different AbortSignal brand.
      if (!(error instanceof TypeError)) throw error
    }
  }
  return signal
}

export function createTimeoutController(sourceSignal?: AbortSignal, timeout?: number): {
  abort: (reason?: unknown) => void
  cleanup: () => void
  stopTimer: () => void
  retainRequest: (request: Request) => void
  retainExternalAbort: (body: ReadableStream<Uint8Array> | null, request: Request) => void
  didTimeout: () => boolean
  signal: AbortSignal
} {
  const controller = new AbortController()
  const signal = sourceSignal === undefined ? undefined : observeAbortSignal(sourceSignal)
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
    stopTimer: clearTimeoutId,
    retainRequest: (request) => { activeRequests.set(controller, request) },
    retainExternalAbort: (body, request) => {
      if (
        body === null ||
        signal === undefined ||
        controller.signal.aborted
      ) {
        return
      }

      // A raw Response may still be streaming after attempt cleanup. Keep
      // cancellation connected without letting a long-lived caller signal
      // strongly retain the completed request. The caller may only retain a
      // reader, so anchor the controller, native Request, and private dependent
      // signal to the body. The caller signal itself remains weak.
      const source = new WeakRef(signal)
      const link = {
        source,
        listener: createWeakAbortListener(source, new WeakRef(controller)),
      }
      rawBodyControllers.set(body, {
        controller,
        request,
        dependentSignal: signal === sourceSignal ? undefined : signal,
      })
      retainedAbortListeners.register(controller, link, controller)
      controller.signal.addEventListener(
        'abort',
        createRetainedAbortCleanup(link, controller, new WeakRef(body)),
        { once: true },
      )
      signal.addEventListener('abort', link.listener, { once: true })
    },
    cleanup: () => {
      clearTimeoutId()
      activeRequests.delete(controller)

      signal?.removeEventListener('abort', onAbort)
    },
  }
}

export function sleep(duration: number, sourceSignal?: AbortSignal): Promise<void> {
  const signal = sourceSignal === undefined ? undefined : observeAbortSignal(sourceSignal)
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
