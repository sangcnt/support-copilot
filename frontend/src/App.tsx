import './App.css'

function App() {
  return (
    <main className="foundation">
      <section className="foundation__card" aria-labelledby="page-title">
        <div className="foundation__eyebrow">
          <span className="foundation__status-dot" aria-hidden="true" />
          Foundation ready
        </div>
        <p className="foundation__kicker">Grounded AI Support Assistant</p>
        <h1 id="page-title">Support Copilot</h1>
        <p className="foundation__summary">
          The application foundation is running. The document workspace,
          citation-aware chat, and support operations dashboard will be added in
          the next delivery stages.
        </p>
        <dl className="foundation__services">
          <div>
            <dt>Web application</dt>
            <dd>React + TypeScript</dd>
          </div>
          <div>
            <dt>Business API</dt>
            <dd>Laravel</dd>
          </div>
          <div>
            <dt>AI workflow</dt>
            <dd>FastAPI</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

export default App
