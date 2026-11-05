import React from 'react'
import ReactDOM from 'react-dom/client'
import CtApp from './CtApp'
import './ct.css'
import * as ctData from './data'
import * as ctGeometry from './geometry'

// ?selftest exposes the real data/decoding modules so automated tests can verify
// every slice with the same code path the viewer uses. Nothing is exposed otherwise.
if (new URLSearchParams(location.search).has('selftest')) {
  ;(window as unknown as { __ctSelftest: unknown }).__ctSelftest = { ...ctData, ...ctGeometry }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CtApp />
  </React.StrictMode>,
)
