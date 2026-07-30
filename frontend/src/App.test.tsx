import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('identifies the product and foundation status', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: 'Support Copilot' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Foundation ready')).toBeInTheDocument()
  })
})
