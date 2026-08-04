export type DocumentRecord = {
  id: string
  display_name: string
  source_type: string
  status: string
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
}

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

export async function uploadDocument(file: File): Promise<DocumentRecord> {
  const headers = await csrfHeaders(true)
  const body = new FormData()
  body.append('file', file)

  const payload = await jsonRequest<{ data: DocumentRecord }>(
    'api/public/documents',
    {
      method: 'POST',
      headers,
      body,
    },
  )

  return payload.data
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
