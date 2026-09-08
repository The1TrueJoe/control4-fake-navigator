// Bridges Control4 remote nav events to Norigin spatial navigation.
import { navigateByDirection, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation'

const enterHandlers = new Map<string, () => void>()
export function registerEnter(key: string, fn: () => void) { enterHandlers.set(key, fn) }
export function unregisterEnter(key: string) { enterHandlers.delete(key) }
function pressEnter() { const k = getCurrentFocusKey(); if (k) enterHandlers.get(k)?.() }

// Map a C4 nav key (from the driver relay) onto focus movement / activation.
export function handleC4Key(key: string, onBack: () => void) {
  switch (key) {
    case 'UP': navigateByDirection('up', {}); break
    case 'DOWN': navigateByDirection('down', {}); break
    case 'LEFT': navigateByDirection('left', {}); break
    case 'RIGHT': navigateByDirection('right', {}); break
    case 'ENTER': pressEnter(); break
    case 'BACK': case 'CANCEL': onBack(); break
    default: break
  }
}
