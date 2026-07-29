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
  return normalizeHookList(hooks, 'beforeRequest') as BeforeRequestHook[]
}

export function normalizeAfterResponseHooks(hooks?: Hooks): AfterResponseHook[] {
  return normalizeHookList(hooks, 'afterResponse') as AfterResponseHook[]
}

export function normalizeOnErrorHooks(hooks?: Hooks): OnErrorHook[] {
  return normalizeHookList(hooks, 'onError') as OnErrorHook[]
}

function normalizeHookList(hooks: Hooks | undefined, key: keyof Hooks): HookList {
  if (
    hooks !== undefined &&
    (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks))
  ) {
    throw new ConfigError('`hooks` must be an object')
  }

  const value = hooks?.[key]
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
