import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createDemoApi } from './demo-api'
import type { ScreenMcpApi } from '../shared/contracts'
import './styles.css'

const apiWindow = window as unknown as { screenmcp?: ScreenMcpApi }
if (!apiWindow.screenmcp) {
  const interactiveRequest = new URLSearchParams(window.location.search).get('interactiveRequest')
  if (interactiveRequest === null) apiWindow.screenmcp = createDemoApi()
  else if (interactiveRequest === 'click') apiWindow.screenmcp = createDemoApi({ interactiveRequest })
  else if (interactiveRequest === 'type_text') apiWindow.screenmcp = createDemoApi({ interactiveRequest })
  else throw new Error(`Unknown demo interactive request: ${JSON.stringify(interactiveRequest)}`)
}

const root = document.querySelector('#root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(<StrictMode><App /></StrictMode>)
