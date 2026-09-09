import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  ApiError,
  deleteDocument,
  documentSourceUrl,
  listDocumentChunks,
  listDocuments,
  listMessages,
  sendChatMessage,
  startAnonymousSession,
  startDocumentIngestion,
  uploadDocument,
  type ChatStreamEvent,
  type DocumentChunk,
  type DocumentRecord,
  type IngestionReceipt,
  type MessageCitation,
  type MessageRecord,
} from './api'
import './App.css'

// Root domain of wherever this app is currently deployed (e.g.
// https://sangcnt.online), not the /demo/support-copilot/ path - read at
// runtime so it always follows the actual domain, even if that changes.
const CONTACT_URL = window.location.origin

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatProcessingDuration(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string | null {
  if (!startIso || !endIso) {
    return null
  }

  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()

  if (!Number.isFinite(ms) || ms < 0) {
    return null
  }

  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

type AppView = 'demo' | 'admin'
type MobilePanel = 'source' | 'chat'
type AdminSection = 'documents' | 'conversations' | 'usage'
type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'support-copilot-theme'

function initialTheme(): Theme {
  const attribute = document.documentElement.dataset.theme
  return attribute === 'light' ? 'light' : 'dark'
}

const FALLBACK_SAMPLE_QUESTIONS = [
  'Summarize this document',
  'What are the key requirements?',
  'What does it say about refunds?',
]

function Brand() {
  return (
    <div className="brand" aria-label="Support Copilot">
      <span className="brand__mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span className="brand__name">
        Support <strong>Copilot</strong>
      </span>
    </div>
  )
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
      title={
        theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

function AppHeader({
  view,
  onViewChange,
  theme,
  onThemeToggle,
}: {
  view: AppView
  onViewChange: (view: AppView) => void
  theme: Theme
  onThemeToggle: () => void
}) {
  return (
    <header className="workspace-topbar">
      <Brand />
      <span className="topbar-divider" aria-hidden="true" />
      <span className="workspace-name">Interactive public demo</span>
      <nav className="view-switcher" aria-label="Demo views">
        <button
          type="button"
          aria-current={view === 'demo' ? 'page' : undefined}
          onClick={() => onViewChange('demo')}
        >
          Public demo
        </button>
        <button
          type="button"
          aria-current={view === 'admin' ? 'page' : undefined}
          onClick={() => onViewChange('admin')}
        >
          Admin preview
        </button>
      </nav>
      <ThemeToggle theme={theme} onToggle={onThemeToggle} />
    </header>
  )
}

function UploadPlaceholder({
  compact = false,
  disabled = false,
  progress = null,
  onFileSelected,
}: {
  compact?: boolean
  disabled?: boolean
  progress?: number | null
  onFileSelected: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploading = progress !== null

  const selectFile = (files: FileList | null) => {
    const file = files?.[0]

    if (file) {
      onFileSelected(file)
    }
  }

  return (
    <div
      className={
        compact
          ? 'upload-placeholder upload-placeholder--compact'
          : 'upload-placeholder'
      }
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        if (!disabled) {
          selectFile(event.dataTransfer.files)
        }
      }}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        onChange={(event) => {
          selectFile(event.target.files)
          event.target.value = ''
        }}
        aria-label="Choose a PDF"
      />
      <span className="upload-placeholder__mark" aria-hidden="true">
        ↑
      </span>
      <div>
        <strong>{compact ? 'Upload a document' : 'Start with a PDF'}</strong>
        <p>
          {compact
            ? 'Drop a PDF here or choose a file.'
            : 'Upload a document, then ask questions and inspect every citation.'}
        </p>
      </div>
      {uploading ? (
        <div
          className="upload-progress"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="upload-progress__track">
            <div
              className="upload-progress__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="upload-progress__label">Uploading… {progress}%</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Choose PDF
        </button>
      )}
      <small>PDF only · Maximum 10 MB</small>
    </div>
  )
}

type SourceView = 'pdf' | 'text'

function DocumentTextView({
  chunks,
  loading,
  error,
  highlightedChunkId,
}: {
  chunks: DocumentChunk[]
  loading: boolean
  error: string | null
  highlightedChunkId: string | null
}) {
  const chunkRefs = useRef<Map<string, HTMLElement>>(new Map())

  useEffect(() => {
    const element = highlightedChunkId
      ? chunkRefs.current.get(highlightedChunkId)
      : null

    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightedChunkId])

  if (loading) {
    return <p className="document-text-view__status">Loading document text…</p>
  }

  if (error) {
    return <p className="document-text-view__status">{error}</p>
  }

  if (chunks.length === 0) {
    return (
      <p className="document-text-view__status">
        No extracted text is available yet.
      </p>
    )
  }

  return (
    <div className="document-text-view">
      {chunks.map((chunk) => (
        <section
          key={chunk.chunk_id}
          ref={(element) => {
            if (element) {
              chunkRefs.current.set(chunk.chunk_id, element)
            } else {
              chunkRefs.current.delete(chunk.chunk_id)
            }
          }}
          className={
            highlightedChunkId === chunk.chunk_id
              ? 'document-text-view__chunk document-text-view__chunk--highlighted'
              : 'document-text-view__chunk'
          }
        >
          {chunk.page_start !== null && (
            <span className="document-text-view__page">
              {chunk.page_start === chunk.page_end
                ? `Page ${chunk.page_start}`
                : `Pages ${chunk.page_start}–${chunk.page_end}`}
            </span>
          )}
          <p>{chunk.text}</p>
        </section>
      ))}
    </div>
  )
}

function DocumentSummary({ document }: { document: DocumentRecord }) {
  const size = document.latest_version
    ? `${(document.latest_version.byte_size / 1024 / 1024).toFixed(2)} MB`
    : 'PDF'
  const badgeClassName =
    document.status === 'ready'
      ? 'ready-badge'
      : document.status === 'failed'
        ? 'error-badge'
        : 'waiting-badge'
  const badgeLabel =
    document.status === 'ready'
      ? 'Ready'
      : document.status === 'failed'
        ? 'Failed'
        : 'Processing'

  return (
    <>
      <span className="file-mark" aria-hidden="true">
        PDF
      </span>
      <div>
        <strong>{document.display_name}</strong>
        <span>{size} · Stored privately</span>
      </div>
      <span className={badgeClassName}>{badgeLabel}</span>
    </>
  )
}

function UploadButton({
  disabled,
  onFileSelected,
  className,
}: {
  disabled: boolean
  onFileSelected: (file: File) => void
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]

          if (file) {
            onFileSelected(file)
          }

          event.target.value = ''
        }}
        aria-label="Upload another PDF"
      />
      <button
        type="button"
        className={className ? `source-upload ${className}` : 'source-upload'}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        + Upload
      </button>
    </>
  )
}

function DocumentMenu({
  documents,
  activeDocumentId,
  disabled,
  onSelect,
  anchorRef,
}: {
  documents: DocumentRecord[]
  activeDocumentId: string | null
  disabled: boolean
  onSelect: (document: DocumentRecord) => void
  anchorRef: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node

      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return
      }

      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  if (documents.length === 0) {
    return null
  }

  const toggle = () => {
    if (!open && anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width })
    }

    setOpen((value) => !value)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="document-menu__toggle"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Your documents"
        disabled={disabled}
        onClick={toggle}
      >
        <span aria-hidden="true">▾</span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            className="document-menu__panel"
            role="listbox"
            aria-label="Your documents"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
          >
            {documents.map((doc) => {
              const duration = formatProcessingDuration(
                doc.latest_version?.ingestion_started_at,
                doc.latest_version?.ingestion_completed_at,
              )
              const statusLabel =
                doc.status === 'ready'
                  ? 'Ready'
                  : doc.status === 'failed'
                    ? 'Failed'
                    : 'Processing'

              return (
                <button
                  key={doc.id}
                  type="button"
                  role="option"
                  aria-selected={doc.id === activeDocumentId}
                  className="document-menu__item"
                  title={`${formatTimestamp(doc.created_at)} · ${statusLabel}${duration ? ` in ${duration}` : ''}`}
                  onClick={() => {
                    onSelect(doc)
                    setOpen(false)
                  }}
                >
                  <DocumentSummary document={doc} />
                </button>
              )
            })}
          </div>,
          window.document.body,
        )}
    </>
  )
}

function SourcePanel({
  document,
  documents,
  initializing,
  uploading,
  uploadProgress,
  ingesting,
  sourceChunked,
  error,
  sourceView,
  onSourceViewChange,
  chunks,
  chunksLoading,
  chunksError,
  highlightedChunkId,
  onFileSelected,
  onSelectDocument,
  onRemove,
}: {
  document: DocumentRecord | null
  documents: DocumentRecord[]
  initializing: boolean
  uploading: boolean
  uploadProgress: number | null
  ingesting: boolean
  sourceChunked: boolean
  error: string | null
  sourceView: SourceView
  onSourceViewChange: (view: SourceView) => void
  chunks: DocumentChunk[]
  chunksLoading: boolean
  chunksError: string | null
  highlightedChunkId: string | null
  onFileSelected: (file: File) => void
  onSelectDocument: (document: DocumentRecord) => void
  onRemove: () => void
}) {
  const metaRef = useRef<HTMLDivElement>(null)
  const emptyHeaderRef = useRef<HTMLElement>(null)

  if (document) {
    const size = document.latest_version
      ? `${(document.latest_version.byte_size / 1024 / 1024).toFixed(2)} MB`
      : 'PDF'
    const badgeClassName =
      !ingesting && document.status === 'ready'
        ? 'ready-badge'
        : !ingesting && document.status === 'failed'
          ? 'error-badge'
          : 'waiting-badge'
    const badgeLabel = ingesting
      ? 'Ingesting'
      : document.status === 'ready'
        ? 'Ready'
        : document.status === 'failed'
          ? 'Failed'
          : sourceChunked
            ? 'Chunked'
            : 'Awaiting ingestion'

    return (
      <section
        className="workspace-panel source-panel"
        aria-label="Source document"
      >
        <UploadButton
          className="source-upload--full"
          disabled={initializing || uploading || ingesting}
          onFileSelected={onFileSelected}
        />

        <div className="document-meta" ref={metaRef}>
          <span className="file-mark" aria-hidden="true">
            PDF
          </span>
          <div>
            <strong>{document.display_name}</strong>
            <span>{size} · Stored privately</span>
          </div>
          <span className={badgeClassName}>{badgeLabel}</span>
          {!document.is_sample && (
            <button
              className="source-remove"
              type="button"
              disabled={uploading || ingesting}
              onClick={onRemove}
            >
              Remove
            </button>
          )}
          <DocumentMenu
            documents={documents}
            activeDocumentId={document.id}
            disabled={initializing || uploading || ingesting}
            onSelect={onSelectDocument}
            anchorRef={metaRef}
          />
        </div>

        {error && (
          <div className="inline-error inline-error--source" role="alert">
            <span aria-hidden="true">!</span>
            <p>{error}</p>
          </div>
        )}

        <div
          className="source-view-toggle"
          role="tablist"
          aria-label="Source view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sourceView === 'pdf'}
            onClick={() => onSourceViewChange('pdf')}
          >
            PDF
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceView === 'text'}
            onClick={() => onSourceViewChange('text')}
          >
            Text
          </button>
        </div>

        <div className="source-preview">
          {sourceView === 'pdf' ? (
            <iframe
              title={`Preview of ${document.display_name}`}
              src={documentSourceUrl(document.id)}
            />
          ) : (
            <DocumentTextView
              chunks={chunks}
              loading={chunksLoading}
              error={chunksError}
              highlightedChunkId={highlightedChunkId}
            />
          )}
        </div>
      </section>
    )
  }

  return (
    <section
      className="workspace-panel source-panel"
      aria-label="Source document"
    >
      <header className="panel-header" ref={emptyHeaderRef}>
        <div>
          <span className="panel-header__label">Source document</span>
          <h2>
            {initializing ? 'Restoring your session…' : 'No PDF selected'}
          </h2>
        </div>
        <div className="panel-header__actions">
          <DocumentMenu
            documents={documents}
            activeDocumentId={null}
            disabled={initializing || uploading}
            onSelect={onSelectDocument}
            anchorRef={emptyHeaderRef}
          />
        </div>
      </header>

      <div className="source-empty">
        <UploadPlaceholder
          disabled={initializing || uploading}
          progress={uploadProgress}
          onFileSelected={onFileSelected}
        />

        {error && (
          <div className="inline-error" role="alert">
            <span aria-hidden="true">!</span>
            <p>{error}</p>
          </div>
        )}

        <div className="citation-preview-note">
          <span aria-hidden="true">01</span>
          <div>
            <strong>Citations will open here</strong>
            <p>
              On desktop, a citation will reveal and highlight its source in
              this panel. On mobile, it will switch to the Source tab.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

type PendingAnswer = {
  content: string
  citations: MessageCitation[]
  chunkCount: number | null
  evidenceSufficient: boolean | null
}

function CitationList({
  citations,
  messageKey,
  expanded,
  onToggle,
  onViewSource,
}: {
  citations: MessageCitation[]
  messageKey: string
  expanded: string | null
  onToggle: (id: string | null) => void
  onViewSource: (chunkId: string) => void
}) {
  if (citations.length === 0) {
    return null
  }

  const openCitation = citations.find(
    (citation) => expanded === `${messageKey}:${citation.chunk_id}`,
  )

  return (
    <>
      <div className="citations">
        {citations.map((citation) => {
          const id = `${messageKey}:${citation.chunk_id}`
          const isOpen = expanded === id

          return (
            <button
              key={id}
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                onToggle(isOpen ? null : id)
                onViewSource(citation.chunk_id)
              }}
            >
              <span aria-hidden="true">{citation.citation_order}</span>
              Source {citation.citation_order}
            </button>
          )
        })}
      </div>
      {openCitation && (
        <blockquote className="citation-excerpt">
          {openCitation.excerpt}
        </blockquote>
      )}
    </>
  )
}

function ChatPanel({
  document,
  ingesting,
  ingestionReceipt,
  ingestionError,
  onStartIngestion,
  onViewSource,
}: {
  document: DocumentRecord | null
  ingesting: boolean
  ingestionReceipt: IngestionReceipt | null
  ingestionError: string | null
  onStartIngestion: () => void
  onViewSource: (chunkId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<MessageRecord[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pendingAnswerRef = useRef<PendingAnswer | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)

  const documentId = document?.id
  const documentReady = document?.status === 'ready'
  const sampleQuestions =
    document?.latest_version?.sample_questions &&
    document.latest_version.sample_questions.length > 0
      ? document.latest_version.sample_questions
      : FALLBACK_SAMPLE_QUESTIONS

  useEffect(() => {
    let active = true

    if (!documentId || !documentReady) {
      setMessages([])
      return
    }

    listMessages(documentId)
      .then((history) => {
        if (active) {
          setMessages(history)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : 'Unable to load the conversation history.',
          )
        }
      })

    return () => {
      active = false
    }
  }, [documentId, documentReady])

  useEffect(() => {
    // Cancel any in-flight answer if the user switches to a different
    // document while a response is still streaming.
    return () => {
      abortRef.current?.abort()
    }
  }, [documentId])

  useEffect(() => {
    const container = conversationRef.current

    if (pendingQuestion && container) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      } else {
        container.scrollTop = container.scrollHeight
      }
    }
  }, [pendingQuestion])

  const updatePending = (patch: Partial<PendingAnswer>) => {
    pendingAnswerRef.current = pendingAnswerRef.current && {
      ...pendingAnswerRef.current,
      ...patch,
    }
    setPendingAnswer(pendingAnswerRef.current)
  }

  const submitQuestion = async (question: string) => {
    const normalizedQuestion = question.trim()

    if (!normalizedQuestion || pendingAnswer || !documentId) {
      return
    }

    setDraft('')
    setSendError(null)
    setPendingQuestion(normalizedQuestion)
    pendingAnswerRef.current = {
      content: '',
      citations: [],
      chunkCount: null,
      evidenceSufficient: null,
    }
    setPendingAnswer(pendingAnswerRef.current)

    const controller = new AbortController()
    abortRef.current = controller
    const clientMessageId = crypto.randomUUID()
    const startedAt = `${new Date().toISOString()}`

    const finish = (
      answer: string,
      citations: MessageCitation[],
      extra: Partial<MessageRecord> = {},
    ) => {
      setMessages((previous) => [
        ...previous,
        {
          id: `local-user-${clientMessageId}`,
          role: 'user',
          content: normalizedQuestion,
          model: null,
          latency_ms: null,
          input_tokens: null,
          output_tokens: null,
          fallback_reason: null,
          citations: [],
          created_at: startedAt,
        },
        {
          id: `local-assistant-${clientMessageId}`,
          role: 'assistant',
          content: answer,
          model: null,
          latency_ms: null,
          input_tokens: null,
          output_tokens: null,
          fallback_reason: null,
          citations,
          created_at: startedAt,
          ...extra,
        },
      ])
      pendingAnswerRef.current = null
      setPendingAnswer(null)
      setPendingQuestion(null)
    }

    try {
      await sendChatMessage(
        documentId,
        normalizedQuestion,
        clientMessageId,
        (event: ChatStreamEvent) => {
          if (event.event === 'retrieval') {
            updatePending({
              chunkCount: event.data.chunk_count,
              evidenceSufficient: event.data.evidence_sufficient,
            })
          } else if (event.event === 'token') {
            updatePending({
              content:
                (pendingAnswerRef.current?.content ?? '') + event.data.text,
            })
          } else if (event.event === 'citations') {
            updatePending({
              citations: event.data.citations.map((citation, index) => ({
                chunk_id: citation.chunk_id,
                citation_order: index + 1,
                excerpt: citation.excerpt,
                retrieval_score: citation.score,
              })),
            })
          } else if (event.event === 'completed') {
            finish(
              event.data.answer,
              event.data.citations.map((citation, index) => ({
                chunk_id: citation.chunk_id,
                citation_order: index + 1,
                excerpt: citation.excerpt,
                retrieval_score: citation.score,
              })),
              {
                model: event.data.model,
                latency_ms: event.data.latency_ms,
                input_tokens: event.data.input_tokens,
                output_tokens: event.data.output_tokens,
                fallback_reason: event.data.fallback_reason,
              },
            )
          } else if (event.event === 'error') {
            setSendError(event.data.message)
          }
        },
        controller.signal,
      )
    } catch (error) {
      const cancelled = controller.signal.aborted
      const partial = pendingAnswerRef.current

      if (cancelled && partial && partial.content) {
        finish(`${partial.content}\n\n*Stopped.*`, partial.citations)
      } else {
        if (!cancelled) {
          setSendError(
            error instanceof Error
              ? error.message
              : 'The answer stream failed. Please try again.',
          )
        }

        pendingAnswerRef.current = null
        setPendingAnswer(null)
        setPendingQuestion(null)
      }
    } finally {
      abortRef.current = null
    }
  }

  const cancelStreaming = () => {
    abortRef.current?.abort()
  }

  if (!document) {
    return (
      <section className="workspace-panel chat-panel" aria-label="Support chat">
        <header className="panel-header chat-panel__header">
          <div className="assistant-avatar" aria-hidden="true">
            C
            <span />
          </div>
          <div>
            <span className="panel-header__label">Document assistant</span>
            <h2>Ask your PDF</h2>
          </div>
          <span className="waiting-badge">No document</span>
        </header>

        <div className="chat-locked">
          <span className="chat-locked__mark" aria-hidden="true">
            ↑
          </span>
          <strong>Upload a PDF to enable chat</strong>
          <p>
            The question box will appear after the document has finished
            processing.
          </p>
        </div>
      </section>
    )
  }

  if (document.status !== 'ready') {
    const failureMessage = ingestionError ?? document.failure_reason
    const state = ingesting
      ? 'ingesting'
      : failureMessage
        ? 'error'
        : ingestionReceipt
          ? 'received'
          : 'idle'

    return (
      <section className="workspace-panel chat-panel" aria-label="Support chat">
        <header className="panel-header chat-panel__header">
          <div className="assistant-avatar" aria-hidden="true">
            C
            <span />
          </div>
          <div>
            <span className="panel-header__label">Document assistant</span>
            <h2>Ask your PDF</h2>
          </div>
          <span className={state === 'error' ? 'error-badge' : 'waiting-badge'}>
            {state === 'ingesting'
              ? 'Ingesting'
              : state === 'received'
                ? 'Chunked'
                : state === 'error'
                  ? 'Failed'
                  : 'Awaiting ingestion'}
          </span>
        </header>

        <div className="chat-locked" aria-live="polite">
          <span className="chat-locked__mark" aria-hidden="true">
            {state === 'ingesting' ? '↻' : state === 'error' ? '!' : '✓'}
          </span>
          {state === 'ingesting' && (
            <>
              <strong>Sending PDF to the AI service</strong>
              <p>
                The private source is being handed off now. You can keep using
                the PDF preview while this request runs.
              </p>
            </>
          )}
          {state === 'error' && (
            <>
              <strong>AI service did not receive the PDF</strong>
              <p>{failureMessage}</p>
              <button
                type="button"
                className="ingestion-action"
                onClick={onStartIngestion}
              >
                Try again
              </button>
            </>
          )}
          {state === 'received' && ingestionReceipt && (
            <>
              <strong>PDF parsed, chunked, and embedded</strong>
              <p>
                Chunk vectors are available in memory. Persistence is the next
                step, so chat remains locked for now.
              </p>
              <dl className="ingestion-debug">
                <div>
                  <dt>File</dt>
                  <dd>{ingestionReceipt.file.filename}</dd>
                </div>
                <div>
                  <dt>Bytes</dt>
                  <dd>{ingestionReceipt.file.byte_size.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>PDF signature</dt>
                  <dd>{ingestionReceipt.file.pdf_signature}</dd>
                </div>
                <div>
                  <dt>Checksum</dt>
                  <dd>
                    {ingestionReceipt.file.checksum_matches === null
                      ? 'Not supplied'
                      : ingestionReceipt.file.checksum_matches
                        ? 'Match'
                        : 'Mismatch'}
                  </dd>
                </div>
                <div>
                  <dt>Pages</dt>
                  <dd>{ingestionReceipt.parser.page_count}</dd>
                </div>
                <div>
                  <dt>Text characters</dt>
                  <dd>
                    {ingestionReceipt.parser.character_count.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt>Structured lines</dt>
                  <dd>{ingestionReceipt.parser.line_count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Chunks</dt>
                  <dd>{ingestionReceipt.chunking.chunk_count}</dd>
                </div>
                <div>
                  <dt>Tokenizer</dt>
                  <dd>{ingestionReceipt.chunking.tokenizer}</dd>
                </div>
                <div>
                  <dt>Target tokens</dt>
                  <dd>{ingestionReceipt.chunking.target_tokens}</dd>
                </div>
                <div>
                  <dt>Overlap tokens</dt>
                  <dd>{ingestionReceipt.chunking.overlap_tokens}</dd>
                </div>
                <div>
                  <dt>Embedding model</dt>
                  <dd>{ingestionReceipt.embedding.model}</dd>
                </div>
                <div>
                  <dt>Embedding batches</dt>
                  <dd>{ingestionReceipt.embedding.batch_count}</dd>
                </div>
                <div>
                  <dt>Embedded chunks</dt>
                  <dd>{ingestionReceipt.embedding.embedding_count}</dd>
                </div>
                <div>
                  <dt>Vector dimensions</dt>
                  <dd>{ingestionReceipt.embedding.dimensions}</dd>
                </div>
                <div>
                  <dt>Embedding input tokens</dt>
                  <dd>{ingestionReceipt.embedding.input_tokens}</dd>
                </div>
                <div>
                  <dt>Extractable text</dt>
                  <dd>
                    {ingestionReceipt.parser.has_extractable_text
                      ? 'Yes'
                      : 'No'}
                  </dd>
                </div>
                <div className="ingestion-debug__hash">
                  <dt>SHA-256</dt>
                  <dd>{ingestionReceipt.file.sha256}</dd>
                </div>
              </dl>
              <div className="parser-preview">
                <span>First chunk preview</span>
                {ingestionReceipt.chunking.chunks[0] ? (
                  <pre>
                    {ingestionReceipt.chunking.chunks[0].text.slice(0, 700)}
                  </pre>
                ) : (
                  <p>
                    No embedded text was found. OCR is not implemented in this
                    parser step.
                  </p>
                )}
              </div>
            </>
          )}
          {state === 'idle' && (
            <>
              <strong>PDF uploaded securely</strong>
              <p>
                Preview is available now. Send the source to the AI service to
                inspect the ingestion handoff.
              </p>
              <button
                type="button"
                className="ingestion-action"
                onClick={onStartIngestion}
              >
                Send to AI service
              </button>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="workspace-panel chat-panel" aria-label="Support chat">
      <header className="panel-header chat-panel__header">
        <div className="assistant-avatar" aria-hidden="true">
          C
          <span />
        </div>
        <div>
          <span className="panel-header__label">Document assistant</span>
          <h2>Ask your PDF</h2>
        </div>
        <span className="ready-badge">Document ready</span>
      </header>

      <div className="conversation" aria-live="polite" ref={conversationRef}>
        <article className="message message--assistant">
          <div
            className="assistant-avatar assistant-avatar--small"
            aria-hidden="true"
          >
            C
          </div>
          <div className="message__content">
            <p>
              Your PDF is ready. Ask a question and I’ll answer only from that
              document, with supporting passages for every response.
            </p>
          </div>
        </article>

        {ingestionReceipt && (
          <p className="ingestion-ready-summary">
            {ingestionReceipt.embedding.embedding_count}{' '}
            {ingestionReceipt.embedding.embedding_count === 1
              ? 'chunk'
              : 'chunks'}{' '}
            embedded with {ingestionReceipt.embedding.model} at{' '}
            {ingestionReceipt.embedding.dimensions} dimensions.
          </p>
        )}

        {historyError && (
          <div className="chat-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Could not load conversation history</strong>
              <p>{historyError}</p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`message message--${message.role}`}
          >
            {message.role === 'assistant' && (
              <div
                className="assistant-avatar assistant-avatar--small"
                aria-hidden="true"
              >
                C
              </div>
            )}
            <div className="message__content">
              <p>{message.content}</p>
              <CitationList
                citations={message.citations}
                messageKey={message.id}
                expanded={expandedCitation}
                onToggle={setExpandedCitation}
                onViewSource={onViewSource}
              />
              {message.role === 'assistant' && message.model && (
                <div className="message__meta">
                  <span>{message.model}</span>
                  {message.latency_ms !== null && (
                    <span>{(message.latency_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}
            </div>
          </article>
        ))}

        {pendingQuestion && (
          <article className="message message--user">
            <div className="message__content">
              <p>{pendingQuestion}</p>
            </div>
          </article>
        )}

        {pendingAnswer && (
          <article className="message message--assistant">
            <div
              className="assistant-avatar assistant-avatar--small"
              aria-hidden="true"
            >
              C
            </div>
            <div className="message__content">
              <p>
                {pendingAnswer.content}
                <span className="streaming-cursor" aria-hidden="true" />
              </p>
              <CitationList
                citations={pendingAnswer.citations}
                messageKey="pending"
                expanded={expandedCitation}
                onToggle={setExpandedCitation}
                onViewSource={onViewSource}
              />
              <button
                type="button"
                className="stop-generating"
                onClick={cancelStreaming}
              >
                Stop generating
              </button>
            </div>
          </article>
        )}

        {sendError && (
          <div className="chat-error" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <strong>The answer stream failed</strong>
              <p>{sendError}</p>
            </div>
          </div>
        )}
      </div>

      <div className="chat-composer">
        <div className="prompt-suggestions" aria-label="Sample questions">
          <span>Try a sample question</span>
          <div>
            {sampleQuestions.map((question) => (
              <button
                key={question}
                type="button"
                disabled={pendingAnswer !== null}
                onClick={() => void submitQuestion(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submitQuestion(draft)
          }}
        >
          <label htmlFor="chat-draft">Ask about this document</label>
          <textarea
            id="chat-draft"
            value={draft}
            disabled={pendingAnswer !== null}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submitQuestion(draft)
              }
            }}
            placeholder="Ask about your PDF…"
            rows={1}
          />
          <button
            type="submit"
            className="send-button"
            disabled={!draft.trim() || pendingAnswer !== null}
            aria-label="Send message"
          >
            ↑
          </button>
        </form>
        <p>Answers will be limited to the active document.</p>
      </div>
    </section>
  )
}

function PublicDemo() {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('source')
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [initializing, setInitializing] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestionReceipt, setIngestionReceipt] =
    useState<IngestionReceipt | null>(null)
  const [ingestionError, setIngestionError] = useState<string | null>(null)
  const [ingestionErrorCode, setIngestionErrorCode] = useState<string | null>(
    null,
  )
  const [ingestionToastDismissed, setIngestionToastDismissed] = useState(false)
  const [sourceView, setSourceView] = useState<SourceView>('pdf')
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(
    null,
  )
  const [documentChunks, setDocumentChunks] = useState<DocumentChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [chunksError, setChunksError] = useState<string | null>(null)

  const documentId = document?.id
  const documentReady = document?.status === 'ready'

  useEffect(() => {
    let active = true

    if (!documentId || !documentReady) {
      setDocumentChunks([])
      setChunksError(null)
      return
    }

    setChunksLoading(true)
    setChunksError(null)

    listDocumentChunks(documentId)
      .then((chunks) => {
        if (active) {
          setDocumentChunks(chunks)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setChunksError(
            error instanceof Error
              ? error.message
              : 'Unable to load the document text.',
          )
        }
      })
      .finally(() => {
        if (active) {
          setChunksLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [documentId, documentReady])

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      try {
        await startAnonymousSession()
        const restoredDocuments = await listDocuments()

        if (active) {
          setDocuments(restoredDocuments)
          setDocument(
            restoredDocuments.find((candidate) => !candidate.is_sample) ??
              restoredDocuments[0] ??
              null,
          )
        }
      } catch (error) {
        if (active) {
          setDocumentError(
            error instanceof Error
              ? error.message
              : 'Unable to restore the demo session.',
          )
        }
      } finally {
        if (active) {
          setInitializing(false)
        }
      }
    }

    void restoreSession()

    return () => {
      active = false
    }
  }, [])

  const upsertDocument = (updated: DocumentRecord) => {
    setDocuments((previous) => {
      const exists = previous.some((candidate) => candidate.id === updated.id)

      return exists
        ? previous.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          )
        : [updated, ...previous]
    })
  }

  const ingestDocument = async (target: DocumentRecord) => {
    setIngesting(true)
    setIngestionReceipt(null)
    setIngestionError(null)
    setIngestionErrorCode(null)
    setIngestionToastDismissed(false)

    try {
      const receipt = await startDocumentIngestion(target.id)
      setIngestionReceipt(receipt)
      setDocument(receipt.document)
      upsertDocument(receipt.document)
    } catch (error) {
      setIngestionError(
        error instanceof Error
          ? error.message
          : 'The AI service could not receive this PDF.',
      )
      setIngestionErrorCode(error instanceof ApiError ? error.code : null)
    } finally {
      setIngesting(false)
    }
  }

  const handleUpload = async (file: File) => {
    setDocumentError(null)

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setDocumentError('Choose a valid PDF document.')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      setDocumentError('The PDF must not exceed 10 MB.')
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setSourceView('pdf')
    setHighlightedChunkId(null)
    setMobilePanel('source')

    try {
      const uploaded = await uploadDocument(file, setUploadProgress)
      setDocument(uploaded)
      upsertDocument(uploaded)
      void ingestDocument(uploaded)
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'The PDF upload failed.',
      )
    } finally {
      setUploading(false)
      setUploadProgress(null)
    }
  }

  const handleRemove = async () => {
    if (
      !document ||
      !window.confirm('Remove this PDF from the demo session?')
    ) {
      return
    }

    setUploading(true)
    setDocumentError(null)

    try {
      await deleteDocument(document.id)
      const remaining = documents.filter(
        (candidate) => candidate.id !== document.id,
      )
      setDocuments(remaining)
      setDocument(remaining[0] ?? null)
      setIngestionReceipt(null)
      setIngestionError(null)
      setIngestionErrorCode(null)
      setSourceView('pdf')
      setHighlightedChunkId(null)
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'Unable to remove the PDF.',
      )
    } finally {
      setUploading(false)
    }
  }

  const handleSelectDocument = (target: DocumentRecord) => {
    if (target.id === document?.id) {
      return
    }

    setDocument(target)
    setDocumentError(null)
    setIngestionReceipt(null)
    setIngestionError(null)
    setIngestionErrorCode(null)
    setIngestionToastDismissed(false)
    setSourceView('pdf')
    setHighlightedChunkId(null)
    setMobilePanel('source')
  }

  const handleViewSource = (chunkId: string) => {
    setSourceView('text')
    setMobilePanel('source')
    setHighlightedChunkId(chunkId)
  }

  return (
    <>
      {ingestionErrorCode && !ingestionToastDismissed && (
        <div
          className="toast-backdrop"
          onClick={() => setIngestionToastDismissed(true)}
        >
          <div
            className="toast toast--error"
            role="alertdialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="toast__icon" aria-hidden="true">
              !
            </span>
            <div className="toast__body">
              <strong>
                {ingestionErrorCode === 'document_unprocessable'
                  ? "This document type isn't supported yet"
                  : "We couldn't process this PDF"}
              </strong>
              <p>
                {ingestionErrorCode === 'document_unprocessable' ? (
                  <>
                    This looks like a scanned PDF without selectable text - we
                    don't support that yet. Have a use case for it?{' '}
                    <a href={CONTACT_URL} target="_blank" rel="noreferrer">
                      Reach out to Sang
                    </a>
                    .
                  </>
                ) : (
                  ingestionError
                )}
              </p>
            </div>
            <button
              type="button"
              className="toast__dismiss"
              aria-label="Dismiss"
              onClick={() => setIngestionToastDismissed(true)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div
        className="mobile-panel-tabs"
        role="tablist"
        aria-label="Workspace panels"
      >
        <button
          id="source-tab"
          type="button"
          role="tab"
          aria-controls="source-panel"
          aria-selected={mobilePanel === 'source'}
          onClick={() => setMobilePanel('source')}
        >
          Source
        </button>
        <button
          id="chat-tab"
          type="button"
          role="tab"
          aria-controls="chat-panel"
          aria-selected={mobilePanel === 'chat'}
          onClick={() => setMobilePanel('chat')}
        >
          Chat
        </button>
      </div>

      <main className="workspace">
        <div
          id="source-panel"
          className="workspace__source"
          data-mobile-visible={mobilePanel === 'source'}
          role="tabpanel"
          aria-labelledby="source-tab"
        >
          <SourcePanel
            document={document}
            documents={documents}
            initializing={initializing}
            uploading={uploading}
            uploadProgress={uploadProgress}
            ingesting={ingesting}
            sourceChunked={ingestionReceipt !== null}
            error={documentError}
            sourceView={sourceView}
            onSourceViewChange={setSourceView}
            chunks={documentChunks}
            chunksLoading={chunksLoading}
            chunksError={chunksError}
            highlightedChunkId={highlightedChunkId}
            onFileSelected={(file) => void handleUpload(file)}
            onSelectDocument={handleSelectDocument}
            onRemove={() => void handleRemove()}
          />
        </div>
        <div
          id="chat-panel"
          className="workspace__chat"
          data-mobile-visible={mobilePanel === 'chat'}
          role="tabpanel"
          aria-labelledby="chat-tab"
        >
          <ChatPanel
            document={document}
            ingesting={ingesting}
            ingestionReceipt={ingestionReceipt}
            ingestionError={ingestionError}
            onStartIngestion={() => {
              if (document) {
                void ingestDocument(document)
              }
            }}
            onViewSource={handleViewSource}
          />
        </div>
      </main>
    </>
  )
}

function AdminDocuments() {
  const [uploadError, setUploadError] = useState<string | null>(null)

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div>
          <p>Knowledge sources</p>
          <h1>Documents</h1>
        </div>
        <span>0 documents</span>
      </header>

      <UploadPlaceholder
        compact
        onFileSelected={(file) => {
          setUploadError(
            `${file.name} was selected. Upload is not connected yet.`,
          )
        }}
      />

      {uploadError && (
        <div className="inline-error inline-error--admin" role="alert">
          <span aria-hidden="true">!</span>
          <p>{uploadError}</p>
        </div>
      )}

      <section
        className="admin-card document-list"
        aria-labelledby="document-list-title"
      >
        <header>
          <div>
            <h2 id="document-list-title">Document library</h2>
            <p>Track upload, processing, and availability.</p>
          </div>
        </header>
        <div className="table-heading" aria-hidden="true">
          <span>Document</span>
          <span>Status</span>
          <span>Uploaded</span>
        </div>
        <div className="admin-empty">
          <span aria-hidden="true">PDF</span>
          <strong>No documents yet</strong>
          <p>Uploaded PDFs will appear here with their ingestion status.</p>
        </div>
      </section>
    </div>
  )
}

function AdminConversations() {
  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div>
          <p>Support activity</p>
          <h1>Conversations</h1>
        </div>
        <span>0 conversations</span>
      </header>

      <section className="conversation-admin" aria-label="Conversation list">
        <div className="conversation-admin__list">
          <header>
            <h2>Recent conversations</h2>
            <span>All</span>
          </header>
          <div className="admin-empty admin-empty--compact">
            <strong>No conversations yet</strong>
            <p>Public chat sessions will appear after a PDF is ready.</p>
          </div>
        </div>
        <div className="conversation-admin__detail">
          <div className="admin-empty">
            <span aria-hidden="true">•••</span>
            <strong>Select a conversation</strong>
            <p>Messages, citations, latency, and usage will appear here.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function AdminUsage() {
  const metrics = [
    ['AI requests', '0'],
    ['Input tokens', '0'],
    ['Output tokens', '0'],
    ['Estimated cost', '$0.00'],
  ]

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <div>
          <p>Cost and performance</p>
          <h1>Usage</h1>
        </div>
        <span>Current period</span>
      </header>

      <div className="usage-metrics">
        {metrics.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>No activity yet</small>
          </article>
        ))}
      </div>

      <section
        className="admin-card usage-chart"
        aria-labelledby="usage-chart-title"
      >
        <header>
          <div>
            <h2 id="usage-chart-title">Requests over time</h2>
            <p>
              Daily request volume will appear after the AI workflow is
              connected.
            </p>
          </div>
        </header>
        <div className="usage-chart__empty">
          <div aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <p>No usage data for this period.</p>
        </div>
      </section>
    </div>
  )
}

function AdminPreview() {
  const [section, setSection] = useState<AdminSection>('documents')
  const navigation: Array<{ id: AdminSection; label: string }> = [
    { id: 'documents', label: 'Documents' },
    { id: 'conversations', label: 'Conversations' },
    { id: 'usage', label: 'Usage' },
  ]

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div>
          <span>Admin preview</span>
          <strong>Operations</strong>
        </div>
        <nav aria-label="Admin sections">
          {navigation.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <span aria-hidden="true">0{index + 1}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <p>Static product shell</p>
      </aside>

      <div className="admin-content">
        {section === 'documents' && <AdminDocuments />}
        {section === 'conversations' && <AdminConversations />}
        {section === 'usage' && <AdminUsage />}
      </div>
    </main>
  )
}

function App() {
  const [view, setView] = useState<AppView>('demo')
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Private browsing or storage disabled: theme just won't persist.
    }
  }, [theme])

  return (
    <div className="workspace-shell">
      <AppHeader
        view={view}
        onViewChange={setView}
        theme={theme}
        onThemeToggle={() =>
          setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
        }
      />
      {view === 'demo' ? <PublicDemo /> : <AdminPreview />}
    </div>
  )
}

export default App
