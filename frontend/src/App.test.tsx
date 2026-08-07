import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)

const sseResponse = (events: string[]) => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event))
      }
      controller.close()
    },
  })

  return Promise.resolve({ ok: true, status: 200, body } as unknown as Response)
}

const emptyDemoApi = () =>
  vi.fn((input: RequestInfo | URL) => {
    const requestUrl = String(input)

    if (requestUrl.endsWith('api/public/session')) {
      return jsonResponse({
        data: { id: 'session-1', expires_at: '2026-08-07T00:00:00Z' },
      })
    }

    if (requestUrl.endsWith('api/public/documents')) {
      return jsonResponse({ data: [] })
    }

    if (requestUrl.endsWith('sanctum/csrf-cookie')) {
      return jsonResponse(null, 204)
    }

    throw new Error(`Unexpected request: ${requestUrl}`)
  })

// uploadDocument() uses XMLHttpRequest (not fetch) so it can report upload
// progress. Tests that exercise the upload flow install a responder below.
class FakeXMLHttpRequest {
  method = ''
  url = ''
  status = 0
  responseText = ''
  withCredentials = false
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
    onprogress: null,
  }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader() {}

  send() {
    queueMicrotask(() => xhrResponder(this))
  }
}

let xhrResponder: (request: FakeXMLHttpRequest) => void = () => {
  throw new Error('No XMLHttpRequest responder configured for this test')
}

describe('App', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=test-csrf-token; path=/'
    vi.stubGlobal('fetch', emptyDemoApi())
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens directly in an upload-first public workspace', async () => {
    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'No PDF selected' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Support chat' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Citations will open here')).toBeInTheDocument()
    expect(
      screen.queryByText('Northstar Support Handbook'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Upload a PDF to enable chat')).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'Ask about this document' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Send message' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the PDF preview available while the second request ingests it', async () => {
    const uploadedDocument = {
      id: 'document-1',
      display_name: 'policy.pdf',
      source_type: 'upload',
      status: 'pending_ingestion',
      failure_reason: null,
      is_sample: false,
      expires_at: '2026-08-07T00:00:00Z',
      latest_version: {
        id: 'version-1',
        mime_type: 'application/pdf',
        byte_size: 1024,
        content_checksum: 'checksum',
        ingestion_status: 'pending',
      },
      created_at: '2026-07-31T00:00:00Z',
    }
    let completeIngestion: ((response: Response) => void) | undefined
    const ingestionResponse = new Promise<Response>((resolve) => {
      completeIngestion = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(input)

      if (requestUrl.endsWith('api/public/session')) {
        return jsonResponse({ data: { id: 'session-1' } })
      }

      if (
        requestUrl.endsWith('api/public/documents/document-1/ingestions') &&
        init?.method === 'POST'
      ) {
        return ingestionResponse
      }

      if (requestUrl.endsWith('api/public/documents')) {
        return jsonResponse({ data: [] })
      }

      if (requestUrl.endsWith('api/public/documents/document-1/messages')) {
        return jsonResponse({ data: [] })
      }

      if (requestUrl.endsWith('sanctum/csrf-cookie')) {
        return jsonResponse(null, 204)
      }

      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const capturedUploadRequests: FakeXMLHttpRequest[] = []
    xhrResponder = (request) => {
      capturedUploadRequests.push(request)
      request.status = 201
      request.responseText = JSON.stringify({ data: uploadedDocument })
      request.upload.onprogress?.({
        lengthComputable: true,
        loaded: 8,
        total: 8,
      } as ProgressEvent)
      request.onload?.()
    }
    render(<App />)

    const input = await screen.findByLabelText('Choose a PDF')
    const file = new File(['%PDF-1.4'], 'policy.pdf', {
      type: 'application/pdf',
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(
      await screen.findByTitle('Preview of policy.pdf'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sending PDF to the AI service'),
    ).toBeInTheDocument()
    expect(screen.getAllByText('Ingesting')).toHaveLength(2)
    expect(
      screen.queryByRole('textbox', { name: 'Ask about this document' }),
    ).not.toBeInTheDocument()

    completeIngestion?.(
      (await jsonResponse({
        data: {
          status: 'received',
          document_version_id: 'version-1',
          file: {
            filename: 'policy.pdf',
            content_type: 'application/pdf',
            byte_size: 1024,
            sha256: 'checksum',
            checksum_matches: true,
            pdf_signature: '%PDF-',
          },
          parser: {
            parser_version: 'pdfplumber-0.11.10:v1',
            page_count: 1,
            character_count: 58,
            line_count: 2,
            empty_page_count: 0,
            has_extractable_text: true,
            metadata: { title: 'Refund policy' },
            normalized_text:
              'Refund policy\nCustomers may request a refund within 30 days.',
            pages: [],
          },
          chunking: {
            chunker_version: 'line-token-v1',
            tokenizer: 'cl100k_base',
            min_tokens: 500,
            target_tokens: 650,
            max_tokens: 800,
            overlap_tokens: 80,
            chunk_count: 1,
            checksum: 'chunking-checksum',
            chunks: [
              {
                ordinal: 0,
                checksum: 'chunk-checksum',
                text: 'Refund policy\nCustomers may request a refund within 30 days.',
                token_count: 11,
                character_count: 58,
                page_start: 1,
                page_end: 1,
                source_text_start: 0,
                source_text_end: 58,
                source_spans: [],
              },
            ],
          },
          embedding: {
            provider: 'openai',
            model: 'text-embedding-3-small',
            batch_size: 32,
            batch_count: 1,
            embedding_count: 1,
            dimensions: 1536,
            input_tokens: 11,
          },
          document: {
            ...uploadedDocument,
            status: 'ready',
            latest_version: {
              ...uploadedDocument.latest_version,
              ingestion_status: 'ready',
            },
          },
        },
      })) as Response,
    )

    expect(await screen.findByText('Document ready')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(
      screen.getByText(
        '1 chunk embedded with text-embedding-3-small at 1536 dimensions.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Ask about this document' }),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(capturedUploadRequests).toHaveLength(1)
      expect(capturedUploadRequests[0].method).toBe('POST')
      expect(capturedUploadRequests[0].url).toContain('api/public/documents')
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api/public/documents/document-1/ingestions'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('streams a grounded answer and shows a validated citation', async () => {
    const readyDocument = {
      id: 'document-1',
      display_name: 'policy.pdf',
      source_type: 'upload',
      status: 'ready',
      failure_reason: null,
      is_sample: false,
      expires_at: null,
      latest_version: {
        id: 'version-1',
        mime_type: 'application/pdf',
        byte_size: 1024,
        content_checksum: 'checksum',
        ingestion_status: 'ready',
      },
      created_at: '2026-08-01T00:00:00Z',
    }

    const sseEvents = [
      'event: started\ndata: {}\n\n',
      'event: retrieval\ndata: {"evidence_sufficient":true,"chunk_count":1,"chunks":[]}\n\n',
      'event: token\ndata: {"text":"Refunds"}\n\n',
      'event: token\ndata: {"text":" are available."}\n\n',
      'event: citations\ndata: {"citations":[{"chunk_id":"chunk-1","page_start":1,"page_end":1,"excerpt":"Refunds are available within 30 days.","score":0.9}]}\n\n',
      'event: usage\ndata: {"input_tokens":50,"output_tokens":8,"latency_ms":1200}\n\n',
      'event: completed\ndata: {"fallback":false,"fallback_reason":null,"answer":"Refunds are available.","citations":[{"chunk_id":"chunk-1","page_start":1,"page_end":1,"excerpt":"Refunds are available within 30 days.","score":0.9}],"model":"gpt-test","input_tokens":50,"output_tokens":8,"latency_ms":1200}\n\n',
    ]

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(input)

      if (requestUrl.endsWith('api/public/session')) {
        return jsonResponse({ data: { id: 'session-1' } })
      }

      if (requestUrl.endsWith('api/public/documents')) {
        return jsonResponse({ data: [readyDocument] })
      }

      if (
        requestUrl.endsWith('api/public/documents/document-1/messages') &&
        init?.method === 'POST'
      ) {
        return sseResponse(sseEvents)
      }

      if (requestUrl.endsWith('api/public/documents/document-1/messages')) {
        return jsonResponse({ data: [] })
      }

      if (requestUrl.endsWith('sanctum/csrf-cookie')) {
        return jsonResponse(null, 204)
      }

      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const textbox = await screen.findByRole('textbox', {
      name: 'Ask about this document',
    })
    fireEvent.change(textbox, {
      target: { value: 'What is the refund policy?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    // The fake SSE ReadableStream needs a real macrotask tick to drain in
    // jsdom before Testing Library's polling observes the resulting
    // updates; a manual flush avoids relying on internal waitFor timing.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(
      await screen.findByText('What is the refund policy?'),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Refunds are available.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Source 1')).toBeInTheDocument()
    expect(screen.getByText('gpt-test')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Source 1'))
    expect(
      screen.getByText('Refunds are available within 30 days.'),
    ).toBeInTheDocument()
  })

  it('restores conversation history on load', async () => {
    const readyDocument = {
      id: 'document-1',
      display_name: 'policy.pdf',
      source_type: 'upload',
      status: 'ready',
      failure_reason: null,
      is_sample: false,
      expires_at: null,
      latest_version: {
        id: 'version-1',
        mime_type: 'application/pdf',
        byte_size: 1024,
        content_checksum: 'checksum',
        ingestion_status: 'ready',
      },
      created_at: '2026-08-01T00:00:00Z',
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const requestUrl = String(input)

      if (requestUrl.endsWith('api/public/session')) {
        return jsonResponse({ data: { id: 'session-1' } })
      }

      if (requestUrl.endsWith('api/public/documents')) {
        return jsonResponse({ data: [readyDocument] })
      }

      if (requestUrl.endsWith('api/public/documents/document-1/messages')) {
        return jsonResponse({
          data: [
            {
              id: 'message-1',
              role: 'user',
              content: 'What is the refund policy?',
              model: null,
              latency_ms: null,
              input_tokens: null,
              output_tokens: null,
              fallback_reason: null,
              citations: [],
              created_at: '2026-08-01T00:00:00Z',
            },
            {
              id: 'message-2',
              role: 'assistant',
              content: 'Refunds are available within 30 days.',
              model: 'gpt-test',
              latency_ms: 900,
              input_tokens: 40,
              output_tokens: 6,
              fallback_reason: null,
              citations: [],
              created_at: '2026-08-01T00:00:05Z',
            },
          ],
        })
      }

      if (requestUrl.endsWith('sanctum/csrf-cookie')) {
        return jsonResponse(null, 204)
      }

      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    expect(
      await screen.findByText('What is the refund policy?'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Refunds are available within 30 days.'),
    ).toBeInTheDocument()
  })

  it('provides working admin navigation and empty product states', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'No PDF selected' })
    fireEvent.click(screen.getByRole('button', { name: 'Admin preview' }))

    expect(
      screen.getByRole('heading', { name: 'Documents', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText('No documents yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Conversations' }))
    expect(screen.getByText('No conversations yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Usage' }))
    expect(screen.getByText('Estimated cost')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('switches between source and chat panels on mobile navigation', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'No PDF selected' })
    const sourceTab = screen.getByRole('tab', { name: 'Source' })
    const chatTab = screen.getByRole('tab', { name: 'Chat' })

    expect(sourceTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(chatTab)
    expect(chatTab).toHaveAttribute('aria-selected', 'true')
    expect(sourceTab).toHaveAttribute('aria-selected', 'false')
  })
})
