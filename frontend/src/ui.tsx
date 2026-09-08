import { useEffect } from 'react'
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation'
import { registerEnter, unregisterEnter } from './nav'

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ')

/** A focusable tile that also works with the mouse (hover focuses, click activates). */
export function Tile({
  label,
  sub,
  icon,
  active,
  className,
  onEnter,
}: {
  label?: string
  sub?: string
  icon?: React.ReactNode
  active?: boolean
  className?: string
  onEnter: () => void
}) {
  const { ref, focused, focusKey, focusSelf } = useFocusable({ onEnterPress: onEnter })
  useEffect(() => {
    registerEnter(focusKey, onEnter)
    return () => unregisterEnter(focusKey)
  }, [focusKey, onEnter])
  return (
    <div
      ref={ref}
      className={cx('tile', className, focused && 'focused', active && 'active')}
      onMouseEnter={() => focusSelf()}
      onClick={onEnter}
      role="button"
      tabIndex={-1}
    >
      {icon && <div className="tile-icon">{icon}</div>}
      {label && <div className="tile-label">{label}</div>}
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}

/** A focus container (row/grid/rail). Norigin tracks children + restores focus. */
export function Section({
  className,
  focusKey,
  children,
}: {
  className: string
  focusKey?: string
  children: React.ReactNode
}) {
  const { ref, focusKey: fk } = useFocusable({ trackChildren: true, saveLastFocusedChild: true, focusKey })
  return (
    <FocusContext.Provider value={fk}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  )
}

export function Clock() {
  const [now, setNow] = useStateNow()
  const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const d = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return (
    <div className="clock">
      <div className="clock-time">{t}</div>
      <div className="clock-date">{d}</div>
    </div>
  )
}

import { useState } from 'react'
function useStateNow(): [Date, (d: Date) => void] {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  return [now, setNow]
}
