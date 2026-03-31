import { HttpError, ParseError } from '../errors.js'
import type { ResponseType } from '../types.js'

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
      bodyText,
      cause,
    })
  }
}

async function readBodyTextSafely(response: Response): Promise<string | undefined> {
  try {
    const bodyText = await response.clone().text()
    return bodyText === '' ? undefined : bodyText
  } catch {
    return undefined
  }
}
