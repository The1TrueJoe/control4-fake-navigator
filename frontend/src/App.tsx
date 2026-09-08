import { useEffect, useRef, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Project, NavigatorState, ServerMsg, Room, Device, Source, Menu, CommandMsg } from './types'
import { menuFor, deviceKind, sourceKind } from './types'
import { handleC4Key } from './nav'
import { Tile, Section, Clock } from './ui'
import {
  ExperienceIcon, DeviceIcon, SourceIcon, DoorOpen, Star, Volume1, Volume2, VolumeX, Power,
  ChevronLeft, SkipBack, Play, Pause, SkipForward, Stop,
} from './icons'

const MENUS: Menu[] = ['Watch', 'Listen', 'Lighting', 'Comfort', 'Security', 'Shades', 'Cameras']
const isAV = (m: Menu) => m === 'Watch' || m === 'Listen'

// Transport buttons, shown when the selected source lists them in TRANSPORTS_SUPPORTED.
const TRANSPORTS = [
  { key: 'SCAN_REV', cmd: 'SCAN_REV', Icon: SkipBack },
  { key: 'PLAY', cmd: 'PLAY', Icon: Play },
  { key: 'PAUSE', cmd: 'PAUSE', Icon: Pause },
  { key: 'STOP', cmd: 'STOP', Icon: Stop },
  { key: 'SCAN_FWD', cmd: 'SCAN_FWD', Icon: SkipForward },
] as const

// Name of a selected/now-playing id, resolved across the room's sources + devices.
function nameOf(room: Room | undefined, id: number | null | undefined): string | undefined {
  if (!room || id == null) return undefined
  const s = [...(room.watch ?? []), ...(room.listen ?? [])].find((x) => x.id === id)
  return s?.name ?? room.devices[id]?.name
}

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
      if (m.type === 'snapshot') { setProject(m.project); setNav(m.nav) }
      else if (m.type === 'nav') setNav(m.nav)
      else if (m.type === 'command_ack') {
        setAck(m.ok ? `${m.command}` : `${m.command} failed`)
        setTimeout(() => setAck(null), 2200)
      } else if (m.type === 'event') {
        const ev = m.event
        if (ev.kind === 'nav' && ev.key) handleC4Key(ev.key, () => backRef.current())
        else if (ev.kind === 'enter_navigation' && ev.room != null) {
          setRoomId(ev.room); setOpenId(null); setTimeout(() => setFocus('devices'), 0)
        }
      }
    }
    return () => ws.close()
  }, [])

  const openRoom = (id: number) => { setRoomId(id); setOpenId(null); setTimeout(() => setFocus('devices'), 0) }

  // Selecting a Watch/Listen source routes the room to it (the select IS the action).
  const selectSource = (r: Room, s: Source) =>
    cmd(r.id, menu === 'Listen' ? 'SELECT_AUDIO_DEVICE' : 'SELECT_VIDEO_DEVICE', { deviceid: s.id })
  // Opening a controllable device (lights/shades/locks/…) shows its control panel.
  const openDevice = (d: Device) => { setOpenId(d.id); setTimeout(() => setFocus('panel'), 0) }

  const navRoomName = nav.navigating_room != null ? project.rooms[nav.navigating_room]?.name : undefined

  // Current menu contents: sources for Watch/Listen, proxy devices otherwise.
  const sources: Source[] = room ? (menu === 'Watch' ? room.watch ?? [] : menu === 'Listen' ? room.listen ?? [] : []) : []
  const menuDevices = room && !isAV(menu) ? Object.values(room.devices).filter((d) => menuFor(d.proxy) === menu) : []
  const favSet = new Set(room?.favorites ?? [])
  const favSources = sources.filter((s) => favSet.has(s.id))
  const count = isAV(menu) ? sources.length : menuDevices.length
  const noun = isAV(menu) ? `source${count === 1 ? '' : 's'}` : `device${count === 1 ? '' : 's'}`

  // Currently-selected source id for this menu (for the active highlight + now playing).
  const activeId = room ? (menu === 'Listen' ? room.current_audio_device : menu === 'Watch' ? room.current_video_device : null) ?? null : null
  const npId = room ? room.now_playing.source_device ?? room.current_video_device ?? room.current_audio_device ?? null : null
  const npName = nameOf(room, npId)

  // rooms grouped by floor for the sidebar
  const floors: Record<string, Room[]> = {}
  for (const r of rooms) (floors[r.floor || 'Rooms'] ||= []).push(r)

  return (
    <div className="app">
      <div className="scrim" />
      <aside className="sidebar">
        <div className="brand">Navigator</div>
        <Section className="rooms" focusKey="rooms">
          {Object.entries(floors).map(([floor, frooms]) => (
            <div className="floor-group" key={floor}>
              <div className="floor-label">{floor}</div>
              {frooms.map((r) => (
                <Tile
                  key={r.id}
                  className="room"
                  icon={<DoorOpen size={20} strokeWidth={1.75} />}
                  label={r.name}
                  active={room?.id === r.id}
                  onEnter={() => openRoom(r.id)}
                />
              ))}
            </div>
          ))}
          {rooms.length === 0 && <div className="empty">connecting…</div>}
        </Section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="title">
            <h1>{room?.name ?? 'Control4 Navigator'}</h1>
            <div className="subtitle">{room ? `${count} ${menu} ${noun}` : ''}</div>
          </div>
          <div className="topright">
            {navRoomName && <span className="pill nav">{navRoomName}</span>}
            {ack && <span className="pill ack">{ack}</span>}
            <span className={`pill ${connected ? 'ok' : 'bad'}`}>{connected ? 'Linked' : 'Offline'}</span>
            <Clock />
          </div>
        </header>

        <Section className="tabs" focusKey="menus">
          {MENUS.map((m) => (
            <Tile key={m} className="tab" icon={<ExperienceIcon menu={m} size={22} />} label={m}
              active={m === menu} onEnter={() => { setMenu(m); setOpenId(null) }} />
          ))}
        </Section>

        {openDev ? (
          <ControlPanel dev={openDev} cmd={cmd} onBack={() => backRef.current()} />
        ) : (
          <div className="content">
            {favSources.length > 0 && (
              <section className="fav">
                <div className="section-label"><Star size={16} strokeWidth={2} /> Favorites</div>
                <Section className="grid" focusKey="favorites">
                  {favSources.map((s) => (
                    <Tile key={`f${s.id}`} icon={<SourceIcon kind={s.kind} />} label={s.name}
                      sub={sourceKind(s.kind)} active={activeId === s.id} onEnter={() => selectSource(room!, s)} />
                  ))}
                </Section>
              </section>
            )}
            <section>
              {favSources.length > 0 && <div className="section-label">{isAV(menu) ? `All ${menu}` : menu}</div>}
              <Section className="grid" focusKey="devices">
                {isAV(menu)
                  ? sources.map((s) => (
                      <Tile key={s.id} icon={<SourceIcon kind={s.kind} />} label={s.name}
                        sub={sourceKind(s.kind)} active={activeId === s.id} onEnter={() => selectSource(room!, s)} />
                    ))
                  : menuDevices.map((d) => (
                      <Tile key={d.id} icon={<DeviceIcon proxy={d.proxy} />} label={d.name}
                        sub={deviceKind(d.proxy)} onEnter={() => openDevice(d)} />
                    ))}
                {count === 0 && <div className="empty">Nothing under {menu} in this room.</div>}
              </Section>
            </section>
          </div>
        )}
      </main>

      {room && (() => {
        const np = room.now_playing
        const playing = npName != null
        const title = np.title || npName || room.name
        const sub: string[] = []
        if (np.artist) sub.push(np.artist)
        else if (np.app) sub.push(np.app)
        sub.push(room.name)
        if (np.state) sub.push(np.state)
        if (room.volume != null && room.volume >= 0) sub.push(`Vol ${room.volume}`)
        if (room.is_muted) sub.push('Muted')
        const tset = new Set(np.transports ?? [])
        const transports = TRANSPORTS.filter((t) => tset.has(t.key))
        return (
          <footer className="nowplaying">
            <div className="np-info">
              {np.art_url && <img className="np-art" src={np.art_url} alt="" />}
              <div>
                <div className="np-eyebrow">{playing ? 'Now Playing' : 'Room'}</div>
                <div className="np-title">{playing ? title : room.name}</div>
                <div className="np-sub">{playing ? sub.join(' · ') : room.power_on ? 'On' : 'Off'}</div>
              </div>
            </div>
            <Section className="np-controls" focusKey="controls">
              {playing && np.source_device != null && transports.map((t) => (
                <Tile key={t.key} className="ctl" icon={<t.Icon size={22} />}
                  onEnter={() => cmd(np.source_device!, t.cmd)} />
              ))}
              <Tile className="ctl" icon={<Volume1 size={22} />} onEnter={() => cmd(room.id, 'PULSE_VOL_DOWN')} />
              <Tile className="ctl" icon={room.is_muted ? <VolumeX size={22} /> : <Volume2 size={22} />} onEnter={() => cmd(room.id, 'MUTE_TOGGLE')} />
              <Tile className="ctl" icon={<Volume2 size={22} />} onEnter={() => cmd(room.id, 'PULSE_VOL_UP')} />
              <Tile className="ctl off" icon={<Power size={22} />} label="Off" onEnter={() => cmd(room.id, 'ROOM_OFF')} />
            </Section>
          </footer>
        )
      })()}
    </div>
  )
}

function ControlPanel({
  dev, cmd, onBack,
}: {
  dev: Device
  cmd: (item: number, command: string, params?: Record<string, unknown>) => void
  onBack: () => void
}) {
  const m = menuFor(dev.proxy)
  return (
    <div className="panel">
      <Section className="panel-actions" focusKey="panel">
        <Tile className="ctl" icon={<ChevronLeft size={22} />} label="Back" onEnter={onBack} />
        <div className="panel-title"><DeviceIcon proxy={dev.proxy} size={28} /> {dev.name}<span className="panel-proxy">{deviceKind(dev.proxy)}</span></div>
        {(m === 'Watch' || m === 'Listen') && (
          <>
            <Tile className="ctl" icon={<SkipBack size={22} />} onEnter={() => cmd(dev.id, 'SKIP_REV')} />
            <Tile className="ctl" icon={<Play size={22} />} onEnter={() => cmd(dev.id, 'PLAY')} />
            <Tile className="ctl" icon={<Pause size={22} />} onEnter={() => cmd(dev.id, 'PAUSE')} />
            <Tile className="ctl" icon={<SkipForward size={22} />} onEnter={() => cmd(dev.id, 'SKIP_FWD')} />
            <Tile className="ctl" icon={<Stop size={22} />} onEnter={() => cmd(dev.id, 'STOP')} />
          </>
        )}
        {m === 'Lighting' && (
          <>
            <Tile className="ctl" label="On" onEnter={() => cmd(dev.id, 'ON')} />
            <Tile className="ctl" label="Off" onEnter={() => cmd(dev.id, 'OFF')} />
          </>
        )}
        {m === 'Shades' && (
          <>
            <Tile className="ctl" label="Open" onEnter={() => cmd(dev.id, 'OPEN')} />
            <Tile className="ctl" label="Close" onEnter={() => cmd(dev.id, 'CLOSE')} />
          </>
        )}
        {m === 'Security' && (
          <>
            <Tile className="ctl" label="Lock" onEnter={() => cmd(dev.id, 'LOCK')} />
            <Tile className="ctl" label="Unlock" onEnter={() => cmd(dev.id, 'UNLOCK')} />
          </>
        )}
      </Section>
      <p className="panel-note">Commands go to Control4 via the REST API; some proxy commands vary by driver.</p>
    </div>
  )
}
