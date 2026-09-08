import React from 'react'
import { createRoot } from 'react-dom/client'
import { init } from '@noriginmedia/norigin-spatial-navigation'
import { App } from './App'
import './styles.css'

// Real keyboard arrows/enter also drive focus (handy on a desktop/WebKit).
init({ debug: false, visualDebug: false })

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
