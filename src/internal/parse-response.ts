import { HttpError, ParseError } from '../errors.js'
import type { ResponseType } from '../types.js'

const MAX_ERROR_BODY_TEXT_CHARS = 16_384
const MAX_ERROR_BODY_READ_MS = 250
const MAX_ERROR_BODY_DECODE_CHUNK_BYTES = 4_096
const TRUNCATED_BODY_SUFFIX = '...[truncated]'

export async function parseResponse<T = unknown>(params: {
  response: Response
  responseType: ResponseType
  parseJson: (text: string) => unknown | PromiseLike<unknown>
  request?: Request
}): Promise<unknown | Response | undefined> {
  const { parseJson, request, response, responseType } = params

  if (!response.ok) {
    throw await createHttpError(response, request)
  }

  switch (responseType) {
    case 'raw':
      return response
    case 'json':
      return parseJsonResponse<T>(response, parseJson)
    case 'text':
      return response.text()
    case 'blob':
      return response.blob()
    case 'arrayBuffer':
      return response.arrayBuffer()
  }
}

export async function createHttpError(
  response: Response,
  request?: Request,
): Promise<HttpError> {
  const bodyText = await readBodyTextSafely(response)

  const params: ConstructorParameters<typeof HttpError>[0] = {
    status: response.status,
    statusText: response.statusText,
    response,
  }

  if (request !== undefined) {
    params.request = request
  }

  if (bodyText !== undefined) {
    params.bodyText = bodyText
  }

  return new HttpError(params)
}

async function parseJsonResponse<T>(
  response: Response,
  parseJson: (text: string) => unknown | PromiseLike<unknown>,
): Promise<T | undefined> {
  const bodyText = await response.text()

  if (bodyText === '') {
    return undefined
  }

  try {
    return await parseJson(bodyText) as T
  } catch (cause) {
    throw new ParseError({
      response,
      responseType: 'json',
      bodyText: truncateBodyText(bodyText, MAX_ERROR_BODY_TEXT_CHARS),
      cause,
    })
  }
}

async function readBodyTextSafely(response: Response): Promise<string | undefined> {
  try {
    const bodyText = await readBodyTextWithLimit(
      response,
      MAX_ERROR_BODY_TEXT_CHARS,
    )
    return bodyText === '' ? undefined : bodyText
  } catch {
    return undefined
  }
}

async function readBodyTextWithLimit(
  response: Response,
  maxChars: number,
): Promise<string> {
  const body = response.body
  if (body === null || typeof TextDecoder === 'undefined') {
    return truncateBodyText(await response.text(), maxChars)
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let bodyText = ''
  let truncated = false
  let stoppedEarly = false
  const deadline = Date.now() + MAX_ERROR_BODY_READ_MS

  try {
    readLoop:
    while (true) {
      const result = await readWithDeadline(reader, deadline)
      if (result === undefined) {
        stoppedEarly = true
        truncated = bodyText !== ''
        void reader.cancel().catch(() => undefined)
        break
      }

      const { done, value } = result
      if (done) {
        break
      }

      for (
        let offset = 0;
        offset < value.byteLength;
        offset += MAX_ERROR_BODY_DECODE_CHUNK_BYTES
      ) {
        const chunk = value.subarray(
          offset,
          Math.min(
            offset + MAX_ERROR_BODY_DECODE_CHUNK_BYTES,
            value.byteLength,
          ),
        )
        bodyText += decoder.decode(chunk, { stream: true })

        if (bodyText.length >= maxChars) {
          stoppedEarly = true
          truncated = true
          bodyText = sliceAtCodePointBoundary(bodyText, maxChars)
          void reader.cancel().catch(() => undefined)
          break readLoop
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!stoppedEarly) {
    bodyText += decoder.decode()
  }

  return truncated
    ? `${bodyText}${TRUNCATED_BODY_SUFFIX}`
    : bodyText
}

async function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    return undefined
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => {
      settled = true
      resolve(undefined)
    }, remainingMs)

    void reader.read().then(
      (result) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutId)
        resolve(result)
      },
      (error: unknown) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function truncateBodyText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  return `${sliceAtCodePointBoundary(text, maxChars)}${TRUNCATED_BODY_SUFFIX}`
}

function sliceAtCodePointBoundary(text: string, maxChars: number): string {
  let end = maxChars
  const lastRetainedCodeUnit = text.charCodeAt(end - 1)
  const firstOmittedCodeUnit = text.charCodeAt(end)

  if (
    lastRetainedCodeUnit >= 0xd800 &&
    lastRetainedCodeUnit <= 0xdbff &&
    firstOmittedCodeUnit >= 0xdc00 &&
    firstOmittedCodeUnit <= 0xdfff
  ) {
    end -= 1
  }

  return text.slice(0, end)
}
