interface PollingOptions {
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>
  retryDelaysMs?: number[]
  sleepImpl?: (delayMs: number) => Promise<void>
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
  logError?: (...values: unknown[]) => void
}

export function waitForRegistryMetadata(options: PollingOptions & {
  packageName: string
  packageVersion: string
  expectedIntegrity: string
}): Promise<string>

export function waitForAttestationDocument(options: PollingOptions & {
  attestationURL: string
}): Promise<unknown>

export function verifyProvenance(options: {
  document: unknown
  packageIntegrity: string
  packageName: string
  packageVersion: string
  githubRepository: string
  githubSha: string
  tagName: string
}): void
