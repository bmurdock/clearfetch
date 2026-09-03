import {
  ConfigError,
  HttpError,
  NetworkError,
  ParseError,
  TimeoutError,
  createClient,
  isHttpClientError,
  isHttpError,
  request,
  type BeforeRequestHook,
  type ErrorContext,
  type HttpClient,
  type RequestOptions,
} from '../dist/index.js'

const jsonClient: HttpClient = createClient()
const jsonResult: Promise<{ ok: boolean } | undefined> =
  jsonClient.get<{ ok: boolean }>('https://api.example.com/status')

const textClient = createClient({ responseType: 'text' })
const textResult: Promise<string> = textClient.get(
  'https://api.example.com/status',
)
const legacyTextClient: HttpClient = textClient

const rawClient = textClient.extend({ responseType: 'raw' })
const rawResult: Promise<Response> = rawClient.get(
  'https://api.example.com/status',
)
const legacyRawClient: HttpClient = rawClient

const requestResult: Promise<ArrayBuffer> = request(
  'https://api.example.com/data',
  { responseType: 'arrayBuffer' },
)

const explicitJsonResult: Promise<{ ok: boolean } | undefined> =
  textClient.get<{ ok: boolean }>('https://api.example.com/status', {
    responseType: 'json',
  })

const inheritedTextClient = textClient.extend({
  headers: { Accept: 'text/plain' },
})
const inheritedTextResult: Promise<string> = inheritedTextClient.get(
  'https://api.example.com/status',
)

const postResult: Promise<string> = jsonClient.post(
  'https://api.example.com/items',
  {
    json: { name: 'example' },
    responseType: 'text',
  },
)

const requestOptions: RequestOptions = {
  method: 'POST',
  body: 'example',
}

const beforeRequest: BeforeRequestHook = ({ headers, options }) => {
  headers.set('x-attempt', String(options.attempt))
}

const errorContext: ErrorContext = {
  input: 'https://api.example.com/status',
  error: new NetworkError('offline'),
}

const publicErrors = [
  new ConfigError('invalid configuration'),
  new NetworkError('offline'),
  new ParseError({
    response: new Response('invalid'),
    responseType: 'json',
  }),
  new TimeoutError(100),
]

for (const error of publicErrors) {
  if (!isHttpClientError(error)) {
    throw new Error('public error was not recognized')
  }
}

const httpError = new HttpError({
  status: 404,
  statusText: 'Not Found',
  response: new Response('missing', { status: 404 }),
})
if (!isHttpError(httpError)) {
  throw new Error('HTTP error was not recognized')
}

request('https://api.example.com/items', {
  method: 'POST',
  json: { name: 'example' },
})

// @ts-expect-error request bodies require a body-capable method
request('https://api.example.com/items', {
  method: 'GET',
  json: { name: 'example' },
})

jsonClient.get('https://api.example.com/items', {
  // @ts-expect-error GET helpers do not accept request bodies
  body: 'invalid',
})

// @ts-expect-error body and json options are mutually exclusive
jsonClient.post('https://api.example.com/items', {
  body: 'example',
  json: { name: 'example' },
})

void jsonResult
void textResult
void legacyTextClient
void rawResult
void legacyRawClient
void requestResult
void explicitJsonResult
void inheritedTextResult
void postResult
void requestOptions
void beforeRequest
void errorContext
