import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './app.css'

/**
 * Show what went wrong instead of nothing.
 *
 * A white page is the least useful failure a deployed app can have: it looks
 * identical whether the script 404'd, the bundle threw, or a browser served
 * something stale, and it gives whoever hit it nothing to report.
 */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('mazegen failed to render', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div className="fatal">
        <h1>mazegen could not start</h1>
        <p>Something went wrong drawing the page. The message below says what.</p>
        <pre>{error.message}</pre>
        <p>
          A reload that ignores the cache often fixes it: hold Shift and press the reload button,
          or press <kbd>⌘</kbd> <kbd>Shift</kbd> <kbd>R</kbd>.
        </p>
      </div>
    )
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
