import {
  createClient,
  request,
  type NormalizedRequestOptions,
} from '../src/index.js'

const client = createClient()
type PublicNormalizedRequestOptions = NormalizedRequestOptions
void (undefined as unknown as PublicNormalizedRequestOptions)

const jsonPromise: Promise<{ ok: boolean } | undefined> = request<{ ok: boolean }>(
  'https://api.example.com/users',
)
void jsonPromise

const textPromise: Promise<string> = request('https://api.example.com/text', {
  responseType: 'text',
})
void textPromise

const blobPromise: Promise<Blob> = request('https://api.example.com/blob', {
  responseType: 'blob',
})
void blobPromise

const arrayBufferPromise: Promise<ArrayBuffer> = request(
  'https://api.example.com/binary',
  {
    responseType: 'arrayBuffer',
  },
)
void arrayBufferPromise

const rawPromise: Promise<Response> = request('https://api.example.com/raw', {
  responseType: 'raw',
})
void rawPromise

const clientTextPromise: Promise<string> = client.get('https://api.example.com/text', {
  responseType: 'text',
})
void clientTextPromise

const clientJsonPromise: Promise<{ ok: boolean } | undefined> = client.get<{
  ok: boolean
}>('https://api.example.com/users')
void clientJsonPromise

request('https://api.example.com/create', {
  method: 'POST',
  json: { ok: true },
})

client.post('https://api.example.com/create', {
  json: { ok: true },
})

request('https://api.example.com/users', {
  query: new URLSearchParams('tag=a&tag=b'),
})

client.get('https://api.example.com/users', {
  query: new URLSearchParams('tag=a&tag=b'),
})

// @ts-expect-error body and json are mutually exclusive
request('https://api.example.com/create', {
  method: 'POST',
  body: 'raw',
  json: { ok: true },
})

// @ts-expect-error one-off JSON bodies require a body-capable method
request('https://api.example.com/create', {
  json: { ok: true },
})

// @ts-expect-error GET requests cannot include JSON request bodies
request('https://api.example.com/users', {
  method: 'GET',
  json: { invalid: true },
})

client.get('https://api.example.com/users', {
  // @ts-expect-error GET helper options cannot include request bodies
  body: 'invalid',
})

const typedTextPromise = request('https://api.example.com/text', {
  responseType: 'text',
})
// @ts-expect-error text mode resolves to Promise<string>
const invalidTextPromise: Promise<number | undefined> = typedTextPromise
void invalidTextPromise

const typedRawPromise = client.get('https://api.example.com/raw', {
  responseType: 'raw',
})
const typedClientRawPromise: Promise<Response> = typedRawPromise
void typedClientRawPromise

// @ts-expect-error raw mode resolves to Promise<Response>
const invalidRawPromise: Promise<{ statusCode: number } | undefined> = rawPromise
void invalidRawPromise
