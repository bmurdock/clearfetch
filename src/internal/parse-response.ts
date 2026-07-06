import { HttpError, ParseError } from '../errors.js'
import type { ResponseType } from '../types.js'

const MAX_ERROR_BODY_TEXT_CHARS = 16_384
const TRUNCATED_BODY_SUFFIX = '...[truncated]'

export async function parseResponse<T = unknown>(params: {
  response: Response
  responseType: ResponseType
  parseJson: (text: string) => unknown
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
  parseJson: (text: string) => unknown,
): Promise<T | undefined> {
  const bodyText = await response.text()

  if (bodyText === '') {
    return undefined
  }

  try {
    return parseJson(bodyText) as T
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

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      const remainingChars = maxChars - bodyText.length
      const chunk =
        value.byteLength > remainingChars + 1
          ? value.subarray(0, remainingChars + 1)
          : value

      bodyText += decoder.decode(chunk, { stream: true })
      if (
        value.byteLength > chunk.byteLength ||
        bodyText.length >= maxChars
      ) {
        truncated = true
        bodyText = bodyText.slice(0, maxChars)
        void reader.cancel().catch(() => undefined)
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  bodyText += decoder.decode()

  return truncated
    ? `${bodyText}${TRUNCATED_BODY_SUFFIX}`
    : bodyText
}

function truncateBodyText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  return `${text.slice(0, maxChars)}${TRUNCATED_BODY_SUFFIX}`
}
