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

async function csrfHeaders(): Promise<Record<string, string>> {
  const response = await fetch(url('sanctum/csrf-cookie'), {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('Unable to initialize secure upload. Please try again.')
  }

  const token = csrfToken()

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
  const headers = await csrfHeaders()
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
  const headers = await csrfHeaders()

  await jsonRequest(`api/public/documents/${documentId}`, {
    method: 'DELETE',
    headers,
  })
}

export function documentSourceUrl(documentId: string): string {
  return url(`api/public/documents/${documentId}/source`)
}
