import { createClient, request } from '../src/index.js'

const client = createClient()

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
