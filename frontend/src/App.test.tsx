import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)

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

describe('App', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=test-csrf-token; path=/'
    vi.stubGlobal('fetch', emptyDemoApi())
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

  it('uploads and previews a PDF while chat waits for ingestion', async () => {
    const uploadedDocument = {
      id: 'document-1',
      display_name: 'policy.pdf',
      source_type: 'upload',
      status: 'pending_ingestion',
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
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = String(input)

      if (requestUrl.endsWith('api/public/session')) {
        return jsonResponse({ data: { id: 'session-1' } })
      }

      if (
        requestUrl.endsWith('api/public/documents') &&
        init?.method === 'POST'
      ) {
        return jsonResponse({ data: uploadedDocument }, 201)
      }

      if (requestUrl.endsWith('api/public/documents')) {
        return jsonResponse({ data: [] })
      }

      if (requestUrl.endsWith('sanctum/csrf-cookie')) {
        return jsonResponse(null, 204)
      }

      throw new Error(`Unexpected request: ${requestUrl}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const input = await screen.findByLabelText('Choose a PDF')
    const file = new File(['%PDF-1.4'], 'policy.pdf', {
      type: 'application/pdf',
    })

    fireEvent.change(input, { target: { files: [file] } })

    expect(
      await screen.findByTitle('Preview of policy.pdf'),
    ).toBeInTheDocument()
    expect(screen.getByText('PDF uploaded securely')).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting ingestion')).toHaveLength(2)
    expect(
      screen.queryByRole('textbox', { name: 'Ask about this document' }),
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('api/public/documents'),
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      )
    })
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
