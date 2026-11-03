import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useAtlasStore } from './state/store'
import { getStructure } from './data/load'

import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/panels.css'
import './styles/viewer.css'
import './styles/plates.css'

// Deep link used by the CT Anatomy module: ?select=<record id> opens that record.
const deepLink = new URLSearchParams(window.location.search).get('select')
if (deepLink && getStructure(deepLink)) useAtlasStore.getState().selectStructure(deepLink)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
