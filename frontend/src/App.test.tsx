import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('opens directly in an empty public demo workspace', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Northstar Support Handbook' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Support chat' }),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Answers use only this source document'),
    ).toHaveTextContent('Uses this document')
    expect(
      screen.queryByText('Can I get a refund after trying the Pro plan?'),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('submits a sample question without inventing a static answer', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Refund timing' }))

    expect(
      screen.getByText('How long does an approved refund take?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Answer unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The AI workflow is not connected yet.',
    )
    expect(
      screen.queryByText(
        'Your bank may take 5–10 business days after approval to show the refund.',
      ),
    ).not.toBeInTheDocument()
  })

  it('accepts a typed question and shows the current static error state', () => {
    render(<App />)

    const input = screen.getByRole('textbox', {
      name: 'Ask about this document',
    })

    fireEvent.change(input, {
      target: { value: 'Does the policy cover annual plans?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(
      screen.getByText('Does the policy cover annual plans?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('does not expose document controls that are not implemented yet', () => {
    render(<App />)

    expect(
      screen.queryByRole('button', { name: 'Start with your PDF' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'More document options' }),
    ).not.toBeInTheDocument()
  })
})
