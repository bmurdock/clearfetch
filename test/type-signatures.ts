import {
  createClient,
  request,
  type ClientDefaults,
  type HttpClient,
  type NormalizedRequestOptions,
  type ResponseType,
} from '../src/index.js'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type Expect<Value extends true> = Value

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

const textDefaultClient = createClient({ responseType: 'text' })
const legacyTextDefaultClient: HttpClient = textDefaultClient
const defaultTextPromise: Promise<string> = textDefaultClient.get(
  'https://api.example.com/text',
)
void legacyTextDefaultClient
void defaultTextPromise

const rawDefaultClient = createClient({ responseType: 'raw' })
const defaultRawPromise: Promise<Response> = rawDefaultClient.get<{
  ignoredAtRuntime: boolean
}>(
  'https://api.example.com/raw',
)
void defaultRawPromise

const blobDefaultClient = createClient({ responseType: 'blob' })
const defaultBlobPromise: Promise<Blob> = blobDefaultClient.get(
  'https://api.example.com/blob',
)
void defaultBlobPromise

const arrayBufferDefaultClient = createClient({ responseType: 'arrayBuffer' })
const defaultArrayBufferPromise: Promise<ArrayBuffer> =
  arrayBufferDefaultClient.get('https://api.example.com/binary')
void defaultArrayBufferPromise

const inheritedTextDefault = textDefaultClient.extend({
  headers: { Accept: 'text/plain' },
})
const inheritedTextPromise: Promise<string> = inheritedTextDefault.get(
  'https://api.example.com/text',
)
void inheritedTextPromise

const extendedRawDefault = textDefaultClient.extend({ responseType: 'raw' })
const legacyRawExtendedClient: HttpClient = extendedRawDefault
const extendedRawPromise: Promise<Response> = extendedRawDefault.get(
  'https://api.example.com/raw',
)
void legacyRawExtendedClient
void extendedRawPromise

const dynamicDefaults: ClientDefaults = { responseType: 'text' }
const dynamicDefaultClient = createClient(dynamicDefaults)
type DynamicDefaultClient = Expect<
  Equal<typeof dynamicDefaultClient, HttpClient<ResponseType> & HttpClient>
>
void (undefined as unknown as DynamicDefaultClient)

const dynamicExtendedDefaults: ClientDefaults = { responseType: 'raw' }
const dynamicExtendedClient = textDefaultClient.extend(dynamicExtendedDefaults)
type DynamicExtendedClient = Expect<
  Equal<typeof dynamicExtendedClient, HttpClient<ResponseType> & HttpClient>
>
void (undefined as unknown as DynamicExtendedClient)

const explicitJsonFromTextDefault: Promise<{ ok: boolean } | undefined> =
  textDefaultClient.get<{ ok: boolean }>('https://api.example.com/users', {
    responseType: 'json',
  })
void explicitJsonFromTextDefault

// @ts-expect-error an explicit client mode requires a matching runtime default
createClient<'text'>()

// @ts-expect-error an explicit extended mode requires a matching runtime default
textDefaultClient.extend<'raw'>({})

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
