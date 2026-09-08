import { useEffect, useRef, useState } from 'react'
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation'
import type { Project, NavigatorState, ServerMsg, Room, Device, Menu } from './types'
import { menuFor, proxyName } from './types'
import { handleC4Key, registerEnter, unregisterEnter } from './nav'

const MENUS: Menu[] = ['Watch', 'Listen', 'Lighting', 'Comfort', 'Security', 'Shades', 'Cameras']

function Tile({
  label,
  sub,
  active,
  onEnter,
}: {
  label: string
  sub?: string
  active?: boolean
  onEnter: () => void
}) {
  const { ref, focused, focusKey } = useFocusable({ onEnterPress: onEnter })
  useEffect(() => {
    registerEnter(focusKey, onEnter)
    return () => unregisterEnter(focusKey)
  }, [focusKey, onEnter])
  return (
    <div ref={ref} className={`tile${focused ? ' focused' : ''}${active ? ' active' : ''}`}>
      <div className="tile-label">{label}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  )
}

function Section({ className, focusKey, children }: { className: string; focusKey?: string; children: React.ReactNode }) {
  const { ref, focusKey: fk } = useFocusable({
    trackChildren: true,
    saveLastFocusedChild: true,
    focusKey,
  })
  return (
    <FocusContext.Provider value={fk}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  )
}

export function App() {
  const [project, setProject] = useState<Project>({ rooms: {}, devices: {} })
  const [nav, setNav] = useState<NavigatorState>({ online: false })
  const [connected, setConnected] = useState(false)
  const [mode, setMode] = useState<'rooms' | 'room'>('rooms')
  const [roomId, setRoomId] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu>('Watch')

  // Back handler kept in a ref so the ws closure always calls the current one.
  const backRef = useRef<() => void>(() => {})
  backRef.current = () => {
    if (mode === 'room') {
      setMode('rooms')
      setTimeout(() => setFocus('rooms'), 0)
    }
  }

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      const m: ServerMsg = JSON.parse(e.data)
      if (m.type === 'snapshot') {
        setProject(m.project)
        setNav(m.nav)
      } else if (m.type === 'nav') {
        setNav(m.nav)
      } else if (m.type === 'event') {
        const ev = m.event
        if (ev.kind === 'nav' && ev.key) {
          handleC4Key(ev.key, () => backRef.current())
        } else if (ev.kind === 'enter_navigation' && ev.room != null) {
          // Room-aware: follow the room the remote is controlling.
          setRoomId(ev.room)
          setMode('room')
          setTimeout(() => setFocus('devices'), 0)
        }
      }
    }
    return () => ws.close()
  }, [])

  const rooms = Object.values(project.rooms)
  const room: Room | undefined = roomId != null ? project.rooms[roomId] : undefined
  const navRoomName = nav.navigating_room != null ? project.rooms[nav.navigating_room]?.name : undefined

  const openRoom = (id: number) => {
    setRoomId(id)
    setMode('room')
    setTimeout(() => setFocus('devices'), 0)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">openHC Navigator</div>
        <div className="status">
          <span className={connected ? 'dot ok' : 'dot bad'} /> {connected ? 'linked' : 'offline'}
          {nav.online && <span className="pill">driver online</span>}
          {navRoomName && <span className="pill nav">navigating: {navRoomName}</span>}
          {room && <span className="pill">{room.name}{room.power_on ? ' · on' : ''}{room.volume != null ? ` · vol ${room.volume}` : ''}</span>}
        </div>
      </header>

      {mode === 'rooms' && (
        <main className="view">
          <h1>Rooms</h1>
          <Section className="grid" focusKey="rooms">
            {rooms.length === 0 && <div className="empty">No rooms yet — set C4_HOST/C4_TOKEN on the backend.</div>}
            {rooms.map((r) => (
              <Tile key={r.id} label={r.name} sub={r.floor ?? undefined} onEnter={() => openRoom(r.id)} />
            ))}
          </Section>
        </main>
      )}

      {mode === 'room' && room && (
        <main className="view">
          <h1>{room.name}</h1>
          <Section className="tabs" focusKey="menus">
            {MENUS.map((m) => (
              <Tile key={m} label={m} active={m === menu} onEnter={() => setMenu(m)} />
            ))}
          </Section>
          <Section className="grid" focusKey="devices">
            {devicesIn(room, menu).map((d) => (
              <Tile
                key={d.id}
                label={d.name}
                sub={proxyName(d.proxy)}
                active={room.now_playing.source_device === d.id}
                onEnter={() => {/* TODO: SELECT_SOURCE via reverse channel */}}
              />
            ))}
            {devicesIn(room, menu).length === 0 && <div className="empty">Nothing under {menu} here.</div>}
          </Section>
        </main>
      )}
    </div>
  )
}

function devicesIn(room: Room, menu: Menu): Device[] {
  return Object.values(room.devices).filter((d) => menuFor(d.proxy) === menu)
}
