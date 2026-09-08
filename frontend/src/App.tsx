import { useEffect, useRef, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Project, NavigatorState, ServerMsg, Room, Device, Menu, CommandMsg } from './types'
import { menuFor, proxyName } from './types'
import { handleC4Key } from './nav'
import { Tile, Section, Clock, Glyph, cx } from './ui'

const MENUS: Menu[] = ['Watch', 'Listen', 'Lighting', 'Comfort', 'Security', 'Shades', 'Cameras']

export function App() {
  const [project, setProject] = useState<Project>({ rooms: {}, devices: {} })
  const [nav, setNav] = useState<NavigatorState>({ online: false })
  const [connected, setConnected] = useState(false)
  const [ack, setAck] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu>('Watch')
  const [openId, setOpenId] = useState<number | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const send = (m: CommandMsg) => wsRef.current?.send(JSON.stringify(m))
  const cmd = (item: number, command: string, params?: Record<string, unknown>) =>
    send({ type: 'command', item, command, params: params ?? {} })

  const rooms = Object.values(project.rooms).sort((a, b) => a.name.localeCompare(b.name))
  const room: Room | undefined = roomId != null ? project.rooms[roomId] : rooms[0]
  const openDev = room && openId != null ? room.devices[openId] : undefined

  // Back: close a device panel, else no-op (sidebar stays).
  const backRef = useRef<() => void>(() => {})
  backRef.current = () => {
    if (openId != null) {
      setOpenId(null)
      setTimeout(() => setFocus('devices'), 0)
    }
  }

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      const m: ServerMsg = JSON.parse(e.data)
      if (m.type === 'snapshot') {
        setProject(m.project)
        setNav(m.nav)
      } else if (m.type === 'nav') {
        setNav(m.nav)
      } else if (m.type === 'command_ack') {
        setAck(m.ok ? `✓ ${m.command}` : `✗ ${m.command}`)
        setTimeout(() => setAck(null), 2200)
      } else if (m.type === 'event') {
        const ev = m.event
        if (ev.kind === 'nav' && ev.key) handleC4Key(ev.key, () => backRef.current())
        else if (ev.kind === 'enter_navigation' && ev.room != null) {
          setRoomId(ev.room)
          setOpenId(null)
          setTimeout(() => setFocus('devices'), 0)
        }
      }
    }
    return () => ws.close()
  }, [])

  const openRoom = (id: number) => {
    setRoomId(id)
    setOpenId(null)
    setTimeout(() => setFocus('devices'), 0)
  }
  const activate = (r: Room, d: Device) => {
    const m = menuFor(d.proxy)
    if (m === 'Watch' || m === 'Listen') {
      cmd(r.id, m === 'Listen' ? 'SELECT_AUDIO_DEVICE' : 'SELECT_VIDEO_DEVICE', { deviceid: d.id })
    }
    setOpenId(d.id)
    setTimeout(() => setFocus('panel'), 0)
  }

  const navRoomName = nav.navigating_room != null ? project.rooms[nav.navigating_room]?.name : undefined
  const devices = room ? Object.values(room.devices).filter((d) => menuFor(d.proxy) === menu) : []

  return (
    <div className="app">
      <div className="scrim" />
      <aside className="sidebar">
        <div className="brand">openHC</div>
        <Section className="rooms" focusKey="rooms">
          {rooms.map((r) => (
            <Tile
              key={r.id}
              className="room"
              icon={Glyph.room}
              label={r.name}
              sub={r.floor ?? undefined}
              active={room?.id === r.id}
              onEnter={() => openRoom(r.id)}
            />
          ))}
          {rooms.length === 0 && <div className="empty">connecting…</div>}
        </Section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="title">
            <h1>{room?.name ?? 'openHC Navigator'}</h1>
            <div className="subtitle">{room ? `${devices.length} in ${menu}` : ''}</div>
          </div>
          <div className="topright">
            {navRoomName && <span className="pill nav">◉ {navRoomName}</span>}
            {ack && <span className="pill ack">{ack}</span>}
            <span className={cx('pill', connected ? 'ok' : 'bad')}>{connected ? 'linked' : 'offline'}</span>
            <Clock />
          </div>
        </header>

        <Section className="tabs" focusKey="menus">
          {MENUS.map((m) => (
            <Tile key={m} className="tab" icon={Glyph[m]} label={m} active={m === menu} onEnter={() => { setMenu(m); setOpenId(null) }} />
          ))}
        </Section>

        {openDev ? (
          <ControlPanel room={room!} dev={openDev} cmd={cmd} onBack={() => backRef.current()} />
        ) : (
          <Section className="grid" focusKey="devices">
            {devices.map((d) => (
              <Tile
                key={d.id}
                label={d.name}
                sub={proxyName(d.proxy)}
                active={room!.now_playing.source_device === d.id}
                onEnter={() => activate(room!, d)}
              />
            ))}
            {devices.length === 0 && <div className="empty">Nothing under {menu} in this room.</div>}
          </Section>
        )}
      </main>

      {room && (
        <footer className="nowplaying">
          <div className="np-info">
            <div className="np-label">{room.name}</div>
            <div className="np-sub">
              {room.power_on ? 'On' : 'Off'}
              {room.now_playing.source_device != null && room.devices[room.now_playing.source_device]
                ? ` · ${room.devices[room.now_playing.source_device].name}`
                : ''}
              {room.volume != null ? ` · Vol ${room.volume}` : ''}
              {room.is_muted ? ' · Muted' : ''}
            </div>
          </div>
          <Section className="np-controls" focusKey="controls">
            <Tile className="ctl" label={Glyph.volDown as string} onEnter={() => cmd(room.id, 'PULSE_VOL_DOWN')} />
            <Tile className="ctl" label={room.is_muted ? '🔈' : (Glyph.mute as string)} onEnter={() => cmd(room.id, 'MUTE_TOGGLE')} />
            <Tile className="ctl" label={Glyph.volUp as string} onEnter={() => cmd(room.id, 'PULSE_VOL_UP')} />
            <Tile className="ctl off" label="Off" onEnter={() => cmd(room.id, 'ROOM_OFF')} />
          </Section>
        </footer>
      )}
    </div>
  )
}

function ControlPanel({
  room,
  dev,
  cmd,
  onBack,
}: {
  room: Room
  dev: Device
  cmd: (item: number, command: string, params?: Record<string, unknown>) => void
  onBack: () => void
}) {
  const m = menuFor(dev.proxy)
  return (
    <div className="panel">
      <Section className="panel-actions" focusKey="panel">
        <Tile className="ctl" label={`${Glyph.back as string} Back`} onEnter={onBack} />
        <div className="panel-title">{dev.name}<span className="panel-proxy">{proxyName(dev.proxy)}</span></div>
        {m === 'Lighting' && (
          <>
            <Tile className="ctl" label="On" onEnter={() => cmd(dev.id, 'ON')} />
            <Tile className="ctl" label="Off" onEnter={() => cmd(dev.id, 'OFF')} />
            <Tile className="ctl" label="Dim −" onEnter={() => cmd(dev.id, 'BUTTON_ACTION', { BUTTON_ID: 1, ACTION: 2 })} />
            <Tile className="ctl" label="Dim +" onEnter={() => cmd(dev.id, 'BUTTON_ACTION', { BUTTON_ID: 0, ACTION: 2 })} />
          </>
        )}
        {(m === 'Watch' || m === 'Listen') && (
          <>
            <Tile className="ctl" label="⏮" onEnter={() => cmd(dev.id, 'SKIP_REV')} />
            <Tile className="ctl" label="⏯" onEnter={() => cmd(dev.id, 'PLAY')} />
            <Tile className="ctl" label="⏸" onEnter={() => cmd(dev.id, 'PAUSE')} />
            <Tile className="ctl" label="⏭" onEnter={() => cmd(dev.id, 'SKIP_FWD')} />
            <Tile className="ctl" label="⏹" onEnter={() => cmd(dev.id, 'STOP')} />
          </>
        )}
        {m === 'Comfort' && (
          <>
            <Tile className="ctl" label="Cooler" onEnter={() => cmd(dev.id, 'DECREMENT_SETPOINT_COOL')} />
            <Tile className="ctl" label="Warmer" onEnter={() => cmd(dev.id, 'INCREMENT_SETPOINT_HEAT')} />
          </>
        )}
        {m === 'Shades' && (
          <>
            <Tile className="ctl" label="Open" onEnter={() => cmd(dev.id, 'OPEN')} />
            <Tile className="ctl" label="Close" onEnter={() => cmd(dev.id, 'CLOSE')} />
            <Tile className="ctl" label="Stop" onEnter={() => cmd(dev.id, 'STOP')} />
          </>
        )}
        {m === 'Security' && (
          <>
            <Tile className="ctl" label="Lock" onEnter={() => cmd(dev.id, 'LOCK')} />
            <Tile className="ctl" label="Unlock" onEnter={() => cmd(dev.id, 'UNLOCK')} />
          </>
        )}
      </Section>
      <p className="panel-note">
        Commands are sent to this device via the Control4 REST API. Some proxy command
        names/params may vary by driver — tune in <code>ControlPanel</code>.
      </p>
    </div>
  )
}
