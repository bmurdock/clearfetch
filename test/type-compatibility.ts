import {
  createClient,
  request,
  type HttpClient,
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

void jsonResult
void textResult
void legacyTextClient
void rawResult
void legacyRawClient
void requestResult
