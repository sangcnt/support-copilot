import { useEffect, useRef, useState } from 'react'
import {
  deleteDocument,
  documentSourceUrl,
  listDocuments,
  startAnonymousSession,
  startDocumentIngestion,
  uploadDocument,
  type DocumentRecord,
  type IngestionReceipt,
} from './api'
import './App.css'

type AppView = 'demo' | 'admin'
type MobilePanel = 'source' | 'chat'
type AdminSection = 'documents' | 'conversations' | 'usage'

const sampleQuestions = [
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

function AppHeader({
  view,
  onViewChange,
}: {
  view: AppView
  onViewChange: (view: AppView) => void
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
    </header>
  )
}

function UploadPlaceholder({
  compact = false,
  disabled = false,
  onFileSelected,
}: {
  compact?: boolean
  disabled?: boolean
  onFileSelected: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

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
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {disabled ? 'Uploading…' : 'Choose PDF'}
      </button>
      <small>PDF only · Maximum 10 MB</small>
    </div>
  )
}

function SourcePanel({
  document,
  initializing,
  uploading,
  ingesting,
  sourceChunked,
  error,
  onFileSelected,
  onRemove,
}: {
  document: DocumentRecord | null
  initializing: boolean
  uploading: boolean
  ingesting: boolean
  sourceChunked: boolean
  error: string | null
  onFileSelected: (file: File) => void
  onRemove: () => void
}) {
  if (document) {
    const size = document.latest_version
      ? `${(document.latest_version.byte_size / 1024 / 1024).toFixed(2)} MB`
      : 'PDF'

    return (
      <section
        className="workspace-panel source-panel"
        aria-label="Source document"
      >
        <header className="panel-header">
          <div>
            <span className="panel-header__label">Source document</span>
            <h2>{document.display_name}</h2>
          </div>
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
        </header>

        <div className="document-meta">
          <span className="file-mark" aria-hidden="true">
            PDF
          </span>
          <div>
            <strong>{document.display_name}</strong>
            <span>{size} · Stored privately</span>
          </div>
          <span className="waiting-badge">
            {ingesting
              ? 'Ingesting'
              : sourceChunked
                ? 'Chunked'
                : 'Awaiting ingestion'}
          </span>
        </div>

        {error && (
          <div className="inline-error inline-error--source" role="alert">
            <span aria-hidden="true">!</span>
            <p>{error}</p>
          </div>
        )}

        <div className="source-preview">
          <iframe
            title={`Preview of ${document.display_name}`}
            src={documentSourceUrl(document.id)}
          />
        </div>
      </section>
    )
  }

  return (
    <section
      className="workspace-panel source-panel"
      aria-label="Source document"
    >
      <header className="panel-header">
        <div>
          <span className="panel-header__label">Source document</span>
          <h2>
            {initializing ? 'Restoring your session…' : 'No PDF selected'}
          </h2>
        </div>
      </header>

      <div className="source-empty">
        <UploadPlaceholder
          disabled={initializing || uploading}
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

function ChatPanel({
  document,
  ingesting,
  ingestionReceipt,
  ingestionError,
  onStartIngestion,
}: {
  document: DocumentRecord | null
  ingesting: boolean
  ingestionReceipt: IngestionReceipt | null
  ingestionError: string | null
  onStartIngestion: () => void
}) {
  const [draft, setDraft] = useState('')
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(
    null,
  )

  const submitQuestion = (question: string) => {
    const normalizedQuestion = question.trim()

    if (!normalizedQuestion) {
      return
    }

    setSubmittedQuestion(normalizedQuestion)
    setDraft('')
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
    const state = ingesting
      ? 'ingesting'
      : ingestionError
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
          <span className="waiting-badge">
            {state === 'ingesting'
              ? 'Ingesting'
              : state === 'received'
                ? 'Chunked'
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
              <p>{ingestionError}</p>
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

      <div className="conversation" aria-live="polite">
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

        {submittedQuestion && (
          <>
            <article className="message message--user">
              <div className="message__content">
                <p>{submittedQuestion}</p>
              </div>
            </article>
            <div className="chat-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>Upload a PDF first</strong>
                <p>A document is required before Support Copilot can answer.</p>
              </div>
            </div>
          </>
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
                onClick={() => submitQuestion(question)}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submitQuestion(draft)
          }}
        >
          <label htmlFor="chat-draft">Ask about this document</label>
          <textarea
            id="chat-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitQuestion(draft)
              }
            }}
            placeholder="Ask about your PDF…"
            rows={2}
          />
          <div className="chat-composer__footer">
            <span>
              <kbd>↵</kbd> to send · <kbd>⇧ ↵</kbd> for new line
            </span>
            <button
              type="submit"
              className="send-button"
              disabled={!draft.trim()}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
        </form>
        <p>Answers will be limited to the active document.</p>
      </div>
    </section>
  )
}

function PublicDemo() {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('source')
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestionReceipt, setIngestionReceipt] =
    useState<IngestionReceipt | null>(null)
  const [ingestionError, setIngestionError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      try {
        await startAnonymousSession()
        const documents = await listDocuments()

        if (active) {
          setDocument(
            documents.find((candidate) => !candidate.is_sample) ??
              documents[0] ??
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

  const ingestDocument = async (target: DocumentRecord) => {
    setIngesting(true)
    setIngestionReceipt(null)
    setIngestionError(null)

    try {
      const receipt = await startDocumentIngestion(target.id)
      setIngestionReceipt(receipt)
    } catch (error) {
      setIngestionError(
        error instanceof Error
          ? error.message
          : 'The AI service could not receive this PDF.',
      )
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

    try {
      const uploaded = await uploadDocument(file)
      setDocument(uploaded)
      setUploading(false)
      void ingestDocument(uploaded)
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'The PDF upload failed.',
      )
    } finally {
      setUploading(false)
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
      setDocument(null)
      setIngestionReceipt(null)
      setIngestionError(null)
    } catch (error) {
      setDocumentError(
        error instanceof Error ? error.message : 'Unable to remove the PDF.',
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
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
            initializing={initializing}
            uploading={uploading}
            ingesting={ingesting}
            sourceChunked={ingestionReceipt !== null}
            error={documentError}
            onFileSelected={(file) => void handleUpload(file)}
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

  return (
    <div className="workspace-shell">
      <AppHeader view={view} onViewChange={setView} />
      {view === 'demo' ? <PublicDemo /> : <AdminPreview />}
    </div>
  )
}

export default App
