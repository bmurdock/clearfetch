import { ConfigError } from '../errors.js'
import type {
  AfterResponseHook,
  BeforeRequestHook,
  Hooks,
  OnErrorHook,
} from '../types.js'

type HookList = BeforeRequestHook[] | AfterResponseHook[] | OnErrorHook[]

export function mergeHooks(
  defaultHooks?: Hooks,
  requestHooks?: Hooks,
): Required<Hooks> {
  return {
    beforeRequest: [
      ...normalizeBeforeRequestHooks(defaultHooks),
      ...normalizeBeforeRequestHooks(requestHooks),
    ],
    afterResponse: [
      ...normalizeAfterResponseHooks(defaultHooks),
      ...normalizeAfterResponseHooks(requestHooks),
    ],
    onError: [
      ...normalizeOnErrorHooks(defaultHooks),
      ...normalizeOnErrorHooks(requestHooks),
    ],
  }
}

export function normalizeBeforeRequestHooks(hooks?: Hooks): BeforeRequestHook[] {
  return normalizeHookList(hooks?.beforeRequest, 'beforeRequest') as BeforeRequestHook[]
}

export function normalizeAfterResponseHooks(hooks?: Hooks): AfterResponseHook[] {
  return normalizeHookList(hooks?.afterResponse, 'afterResponse') as AfterResponseHook[]
}

export function normalizeOnErrorHooks(hooks?: Hooks): OnErrorHook[] {
  return normalizeHookList(hooks?.onError, 'onError') as OnErrorHook[]
}

function normalizeHookList(value: unknown, key: keyof Hooks): HookList {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new ConfigError(`\`hooks.${key}\` must be an array of functions`)
  }

  for (const hook of value) {
    if (typeof hook !== 'function') {
      throw new ConfigError(`\`hooks.${key}\` must be an array of functions`)
    }
  }

  return value.slice() as HookList
}
