import { useState } from 'react'
import './App.css'

type MobilePanel = 'source' | 'chat'

type DemoQuestion = {
  id: string
  label: string
  question: string
}

const sourceSections: Array<{
  heading: string
  body: string
}> = [
  {
    heading: '4. Billing and refunds',
    body: 'This policy applies to subscriptions purchased directly through Northstar Cloud.',
  },
  {
    heading: '4.2 Refund eligibility',
    body: 'Customers may request a full refund within 14 calendar days of the initial purchase when usage remains below 20% of the monthly plan allowance.',
  },
  {
    heading: '4.3 Refund method',
    body: 'Approved refunds are returned to the original payment method. Bank processing may take 5–10 business days after approval.',
  },
  {
    heading: '4.4 Renewals',
    body: 'Subscription renewals are not refundable after the renewal date unless required by applicable law.',
  },
]

const demoQuestions: DemoQuestion[] = [
  {
    id: 'refund-eligibility',
    label: 'Refund eligibility',
    question: 'Can I get a refund after trying the Pro plan?',
  },
  {
    id: 'refund-timing',
    label: 'Refund timing',
    question: 'How long does an approved refund take?',
  },
  {
    id: 'renewal-policy',
    label: 'Renewal policy',
    question: 'Can I refund a subscription renewal?',
  },
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

function SourcePanel() {
  return (
    <section
      className="workspace-panel source-panel"
      aria-label="Source document"
    >
      <header className="panel-header">
        <div>
          <span className="panel-header__label">Source document</span>
          <h2>Northstar Support Handbook</h2>
        </div>
      </header>

      <div className="document-meta">
        <span className="file-mark" aria-hidden="true">
          PDF
        </span>
        <div>
          <strong>northstar-support.pdf</strong>
          <span>Page 4 of 12 · 684 KB</span>
        </div>
        <span className="ready-badge">Ready</span>
      </div>

      <div className="document-canvas">
        <article className="document-page">
          <header>
            <span>NORTHSTAR CLOUD</span>
            <span>SUPPORT HANDBOOK · 2026</span>
          </header>
          <p className="document-page__chapter">CUSTOMER POLICY</p>
          <h3>Billing, refunds, and renewals</h3>
          <p className="document-page__intro">
            Guidelines for subscription purchases, refund eligibility, and
            payment processing.
          </p>

          <div className="document-page__rule" />

          {sourceSections.map((section) => (
            <section key={section.heading} className="source-section">
              <h4>{section.heading}</h4>
              <p>{section.body}</p>
            </section>
          ))}

          <footer>
            <span>Internal support reference</span>
            <span>04</span>
          </footer>
        </article>
      </div>
    </section>
  )
}

function ChatPanel() {
  const [draft, setDraft] = useState('')
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const submitQuestion = (question: string) => {
    const normalizedQuestion = question.trim()

    if (!normalizedQuestion) {
      return
    }

    setSubmittedQuestion(normalizedQuestion)
    setDraft('')
    setError(
      'Unable to generate an answer right now. The AI workflow is not connected yet.',
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
          <span className="panel-header__label">Knowledge assistant</span>
          <h2>Northstar Support</h2>
        </div>
        <span
          className="grounded-badge"
          aria-label="Answers use only this source document"
          title="Answers are limited to the source document"
        >
          <span aria-hidden="true">◆</span>
          Uses this document
        </span>
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
              Ask a question about the Northstar Support Handbook. Answers will
              include citations to the supporting passages.
            </p>
          </div>
        </article>

        {submittedQuestion && error && (
          <>
            <article className="message message--user">
              <div className="message__content">
                <p>{submittedQuestion}</p>
              </div>
            </article>
            <div className="chat-error" role="alert">
              <span aria-hidden="true">!</span>
              <div>
                <strong>Answer unavailable</strong>
                <p>{error}</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="chat-composer">
        <div className="prompt-suggestions" aria-label="Sample questions">
          <span>Try a sample question</span>
          <div>
            {demoQuestions.map((question) => (
              <button
                key={question.id}
                type="button"
                onClick={() => submitQuestion(question.question)}
              >
                {question.label}
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
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitQuestion(draft)
              }
            }}
            placeholder="Ask about this document…"
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
        <p>Answers may be incomplete. Always verify important details.</p>
      </div>
    </section>
  )
}

function WorkspaceScreen() {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('chat')

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <Brand />
        <span className="topbar-divider" aria-hidden="true" />
        <span className="workspace-name">Interactive public demo</span>
      </header>

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
          <SourcePanel />
        </div>
        <div
          id="chat-panel"
          className="workspace__chat"
          data-mobile-visible={mobilePanel === 'chat'}
          role="tabpanel"
          aria-labelledby="chat-tab"
        >
          <ChatPanel />
        </div>
      </main>
    </div>
  )
}

function App() {
  return <WorkspaceScreen />
}

export default App
