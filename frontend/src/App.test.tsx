import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('opens directly in an upload-first public workspace', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'No PDF selected' }),
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
    expect(
      screen.queryByRole('button', { name: 'Summarize this document' }),
    ).not.toBeInTheDocument()
  })

  it('shows an honest placeholder error after choosing a PDF', () => {
    render(<App />)

    const file = new File(['test'], 'policy.pdf', {
      type: 'application/pdf',
    })

    fireEvent.change(screen.getByLabelText('Choose a PDF'), {
      target: { files: [file] },
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'policy.pdf was selected, but the upload pipeline is not connected yet.',
    )
  })

  it('provides working admin navigation and empty product states', () => {
    render(<App />)

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

  it('switches between source and chat panels on mobile navigation', () => {
    render(<App />)

    const sourceTab = screen.getByRole('tab', { name: 'Source' })
    const chatTab = screen.getByRole('tab', { name: 'Chat' })

    expect(sourceTab).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(chatTab)
    expect(chatTab).toHaveAttribute('aria-selected', 'true')
    expect(sourceTab).toHaveAttribute('aria-selected', 'false')
  })
})
