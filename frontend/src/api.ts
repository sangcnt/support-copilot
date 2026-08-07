export type DocumentRecord = {
  id: string
  display_name: string
  source_type: string
  status: string
  failure_reason: string | null
  is_sample: boolean
  expires_at: string | null
  latest_version: {
    id: string
    mime_type: string
    byte_size: number
    content_checksum: string
    ingestion_status: string
  } | null
  created_at: string
}

export type IngestionReceipt = {
  status: 'received'
  document_version_id: string
  file: {
    filename: string
    content_type: string | null
    byte_size: number
    sha256: string
    checksum_matches: boolean | null
    pdf_signature: string
  }
  parser: {
    parser_version: string
    page_count: number
    character_count: number
    line_count: number
    empty_page_count: number
    has_extractable_text: boolean
    metadata: Record<string, string>
    normalized_text: string
    pages: Array<{
      page_number: number
      width: number
      height: number
      rotation: number
      text_start: number
      text_end: number
      line_count: number
      lines: Array<{
        line_number: number
        text: string
        text_start: number
        text_end: number
        bbox: [number, number, number, number]
      }>
    }>
  }
  chunking: {
    chunker_version: string
    tokenizer: string
    min_tokens: number
    target_tokens: number
    max_tokens: number
    overlap_tokens: number
    chunk_count: number
    checksum: string
    chunks: Array<{
      ordinal: number
      checksum: string
      text: string
      token_count: number
      character_count: number
      page_start: number
      page_end: number
      source_text_start: number
      source_text_end: number
      source_spans: Array<{
        page_number: number
        line_start: number
        line_end: number
        text_start: number
        text_end: number
      }>
    }>
  }
  embedding: {
    provider: string
    model: string
    batch_size: number
    batch_count: number
    embedding_count: number
    dimensions: number
    input_tokens: number
  }
  document: DocumentRecord
}

export type MessageCitation = {
  chunk_id: string
  citation_order: number
  excerpt: string
  retrieval_score: number | null
}

export type MessageRecord = {
  id: string
  role: 'user' | 'assistant'
  content: string
  model: string | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  fallback_reason: string | null
  citations: MessageCitation[]
  created_at: string
}

type StreamCitation = {
  chunk_id: string
  page_start: number | null
  page_end: number | null
  excerpt: string
  score: number
}

export type ChatStreamEvent =
  | { event: 'started'; data: Record<string, never> }
  | {
      event: 'retrieval'
      data: {
        evidence_sufficient: boolean
        chunk_count: number
        chunks: Array<{
          chunk_id: string
          page_start: number | null
          page_end: number | null
          score: number
        }>
      }
    }
  | { event: 'token'; data: { text: string } }
  | { event: 'citations'; data: { citations: StreamCitation[] } }
  | {
      event: 'usage'
      data: { input_tokens: number; output_tokens: number; latency_ms: number }
    }
  | {
      event: 'completed'
      data: {
        fallback: boolean
        fallback_reason: string | null
        answer: string
        citations: StreamCitation[]
        model: string | null
        input_tokens: number
        output_tokens: number
        latency_ms: number
      }
    }
  | { event: 'error'; data: { message: string } }

type ErrorEnvelope = {
  error?: {
    message?: string
    details?: Record<string, string[]>
  }
}

const publicBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`

const url = (path: string) => `${publicBase}${path.replace(/^\//, '')}`

async function errorMessage(response: Response): Promise<string> {
  const fallback = `The request failed with status ${response.status}.`

  try {
    const payload = (await response.json()) as ErrorEnvelope
    const validationMessage = Object.values(
      payload.error?.details ?? {},
    )[0]?.[0]

    return validationMessage ?? payload.error?.message ?? fallback
  } catch {
    return fallback
  }
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url(path), {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(await errorMessage(response))
  }

  return (await response.json()) as T
}

function csrfToken(): string | null {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith('XSRF-TOKEN='))

  return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : null
}

async function csrfHeaders(refresh = false): Promise<Record<string, string>> {
  let token = csrfToken()

  if (refresh || !token) {
    const response = await fetch(url('sanctum/csrf-cookie'), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(
        'Unable to initialize a secure request. Please try again.',
      )
    }

    token = csrfToken()
  }

  return token ? { 'X-XSRF-TOKEN': token } : {}
}

export async function startAnonymousSession(): Promise<void> {
  await jsonRequest('api/public/session')
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const payload = await jsonRequest<{ data: DocumentRecord[] }>(
    'api/public/documents',
  )

  return payload.data
}

export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<DocumentRecord> {
  const headers = await csrfHeaders(true)
  const body = new FormData()
  body.append('file', file)

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', url('api/public/documents'))
    request.withCredentials = true
    request.setRequestHeader('Accept', 'application/json')

    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value)
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }

    request.onload = () => {
      let payload: { data?: DocumentRecord } & ErrorEnvelope = {}

      try {
        payload = JSON.parse(request.responseText) as typeof payload
      } catch {
        // Fall through to the generic error below.
      }

      if (request.status >= 200 && request.status < 300 && payload.data) {
        resolve(payload.data)
        return
      }

      const validationMessage = Object.values(
        payload.error?.details ?? {},
      )[0]?.[0]

      reject(
        new Error(
          validationMessage ??
            payload.error?.message ??
            `The request failed with status ${request.status}.`,
        ),
      )
    }

    request.onerror = () => {
      reject(new Error('The PDF upload failed.'))
    }

    request.send(body)
  })
}

export async function deleteDocument(documentId: string): Promise<void> {
  const headers = await csrfHeaders(true)

  await jsonRequest(`api/public/documents/${documentId}`, {
    method: 'DELETE',
    headers,
  })
}

export async function startDocumentIngestion(
  documentId: string,
): Promise<IngestionReceipt> {
  const headers = await csrfHeaders()
  const payload = await jsonRequest<{ data: IngestionReceipt }>(
    `api/public/documents/${documentId}/ingestions`,
    {
      method: 'POST',
      headers,
    },
  )

  return payload.data
}

export function documentSourceUrl(documentId: string): string {
  return url(`api/public/documents/${documentId}/source`)
}

export async function listMessages(
  documentId: string,
): Promise<MessageRecord[]> {
  const payload = await jsonRequest<{ data: MessageRecord[] }>(
    `api/public/documents/${documentId}/messages`,
  )

  return payload.data
}

function parseSseEvent(raw: string): ChatStreamEvent | null {
  let eventName: string | null = null
  const dataLines: string[] = []

  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) {
      eventName = line.slice('event: '.length)
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice('data: '.length))
    }
  }

  if (!eventName) {
    return null
  }

  try {
    const data = JSON.parse(dataLines.join('\n'))
    return { event: eventName, data } as ChatStreamEvent
  } catch {
    return null
  }
}

/**
 * Send a chat message and stream the grounded answer as Server-Sent Events.
 * Uses fetch + ReadableStream (not EventSource) because the request needs a
 * POST body; `signal` lets the caller cancel an in-flight answer.
 */
export async function sendChatMessage(
  documentId: string,
  content: string,
  clientMessageId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers = await csrfHeaders()

  const response = await fetch(
    url(`api/public/documents/${documentId}/messages`),
    {
      method: 'POST',
      credentials: 'same-origin',
      signal,
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        content,
        client_message_id: clientMessageId,
      }),
    },
  )

  if (!response.ok || !response.body) {
    throw new Error(await errorMessage(response))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')

    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const parsed = parseSseEvent(rawEvent)

      if (parsed) {
        onEvent(parsed)
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}
