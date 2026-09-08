import { useEffect, useRef, useState } from 'react'
import { setFocus } from '@noriginmedia/norigin-spatial-navigation'
import type { Project, NavigatorState, ServerMsg, Room, Device, Source, Menu, CommandMsg } from './types'
import { menuFor, deviceKind } from './types'
import { handleC4Key } from './nav'
import { Tile, Section, Clock, cx } from './ui'
import {
  ExperienceIcon, DeviceIcon, SourceIcon, C4Icon, DoorOpen, Volume1, Volume2, VolumeX, Power,
  ChevronLeft, SkipBack, Play, Pause, SkipForward, Stop, PanelLeft,
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

// A selected/now-playing id, resolved across the room's sources + devices.
function itemOf(room: Room | undefined, id: number | null | undefined) {
  if (!room || id == null) return undefined
  const s = [...(room.watch ?? []), ...(room.listen ?? [])].find((x) => x.id === id)
  if (s) return { name: s.name, icon: s.icon }
  const d = room.devices[id]
  return d ? { name: d.name, icon: d.icon } : undefined
}

export function App() {
  const [project, setProject] = useState<Project>({ rooms: {}, devices: {} })
  const [nav, setNav] = useState<NavigatorState>({ online: false })
  const [ack, setAck] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu>('Watch')
  const [openId, setOpenId] = useState<number | null>(null)
  const [navOpen, setNavOpen] = useState(true) // room drawer (TV-style; hidden once in a room)
  const [osdHidden, setOsdHidden] = useState(false) // OSD dismissed after selecting a source

  const wsRef = useRef<WebSocket | null>(null)
  const send = (m: CommandMsg) => wsRef.current?.send(JSON.stringify(m))
  const cmd = (item: number, command: string, params?: Record<string, unknown>) =>
    send({ type: 'command', item, command, params: params ?? {} })

  const rooms = Object.values(project.rooms).sort((a, b) => a.name.localeCompare(b.name))
  const room: Room | undefined = roomId != null ? project.rooms[roomId] : rooms[0]
  const openDev = room && openId != null ? room.devices[openId] : undefined

  // Refs so the once-created WebSocket handler sees current UI state.
  const osdRef = useRef(osdHidden); osdRef.current = osdHidden
  const navOpenRef = useRef(navOpen); navOpenRef.current = navOpen
  const backRef = useRef<() => void>(() => {})
  backRef.current = () => {
    if (osdHidden) return
    if (openId != null) { setOpenId(null); setTimeout(() => setFocus('devices'), 0) }
    else if (!navOpen) revealRooms()
    else setNavOpen(false)
  }
  const leftEdgeRef = useRef<() => void>(() => {})
  leftEdgeRef.current = () => { if (!navOpen) revealRooms() }

  useEffect(() => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url)
    wsRef.current = ws
    ws.onmessage = (e) => {
      const m: ServerMsg = JSON.parse(e.data)
      if (m.type === 'snapshot') { setProject(m.project); setNav(m.nav) }
      else if (m.type === 'nav') setNav(m.nav)
      else if (m.type === 'command_ack') {
        setAck(m.ok ? `${m.command}` : `${m.command} failed`)
        setTimeout(() => setAck(null), 2200)
      } else if (m.type === 'event') {
        const ev = m.event
        if (ev.kind === 'enter_navigation' && ev.room != null) {
          // C4 button: bring the OSD up for that room's sources.
          setOsdHidden(false); setNavOpen(false); setRoomId(ev.room); setOpenId(null)
          setTimeout(() => setFocus('menus'), 0)
        } else if (ev.kind === 'nav' && ev.key) {
          if (osdRef.current) { setOsdHidden(false); setTimeout(() => setFocus('menus'), 0) }
          else handleC4Key(ev.key, () => backRef.current(), () => leftEdgeRef.current())
        }
      }
    }
    return () => ws.close()
  }, [])

  const revealRooms = () => { setNavOpen(true); setTimeout(() => setFocus('rooms'), 0) }
  const openRoom = (id: number) => {
    setRoomId(id); setOpenId(null); setNavOpen(false); setOsdHidden(false)
    setTimeout(() => setFocus('menus'), 0)
  }
  // Selecting a Watch/Listen source routes the room to it, then dismisses the OSD —
  // the TV is now showing that source, so there's nothing for us to draw.
  const selectSource = (r: Room, s: Source) => {
    cmd(r.id, menu === 'Listen' ? 'SELECT_AUDIO_DEVICE' : 'SELECT_VIDEO_DEVICE', { deviceid: s.id })
    setOsdHidden(true)
  }
  const openDevice = (d: Device) => { setOpenId(d.id); setTimeout(() => setFocus('panel'), 0) }
  const showOsd = () => { setOsdHidden(false); setTimeout(() => setFocus('menus'), 0) }

  const navRoomName = nav.navigating_room != null ? project.rooms[nav.navigating_room]?.name : undefined

  // Only show experience tabs the room actually has (no Shades tab without shades).
  const menuHasContent = (m: Menu) =>
    m === 'Watch' ? (room?.watch?.length ?? 0) > 0
    : m === 'Listen' ? (room?.listen?.length ?? 0) > 0
    : room ? Object.values(room.devices).some((d) => menuFor(d.proxy) === m) : false
  const availableMenus = MENUS.filter(menuHasContent)
  useEffect(() => {
    if (availableMenus.length && !availableMenus.includes(menu)) setMenu(availableMenus[0])
  }, [roomId, availableMenus.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  // Current menu contents: sources for Watch/Listen, proxy devices otherwise.
  const sources: Source[] = room ? (menu === 'Watch' ? room.watch ?? [] : menu === 'Listen' ? room.listen ?? [] : []) : []
  const menuDevices = room && !isAV(menu) ? Object.values(room.devices).filter((d) => menuFor(d.proxy) === menu) : []
  const count = isAV(menu) ? sources.length : menuDevices.length

  const activeId = room ? (menu === 'Listen' ? room.current_audio_device : menu === 'Watch' ? room.current_video_device : null) ?? null : null
  const npId = room ? room.now_playing.source_device ?? room.current_video_device ?? room.current_audio_device ?? null : null
  const npItem = itemOf(room, npId)
  const npName = npItem?.name

  // rooms grouped by floor for the drawer
  const floors: Record<string, Room[]> = {}
  for (const r of rooms) (floors[r.floor || 'Rooms'] ||= []).push(r)

  // OSD dismissed: the TV is showing the selected source — draw nothing but a way back.
  if (osdHidden) {
    return (
      <button className="osd-off" onClick={showOsd}>
        <span className="osd-hint">Source active — tap or press a key for the menu</span>
      </button>
    )
  }

  return (
    <div className={cx('app', navOpen && 'nav-open')}>
      <div className="scrim" />
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      <aside className="sidebar">
        <div className="brand"><span className="brand-name">Navigator</span></div>
        <Section className="rooms" focusKey="rooms">
          {Object.entries(floors).map(([floor, frooms]) => (
            <div className="floor-group" key={floor}>
              <div className="floor-label">{floor}</div>
              {frooms.map((r) => (
                <Tile key={r.id} className="room" icon={<DoorOpen size={20} strokeWidth={1.75} />}
                  label={r.name} active={room?.id === r.id} onEnter={() => openRoom(r.id)} />
              ))}
            </div>
          ))}
          {rooms.length === 0 && <div className="empty">connecting…</div>}
        </Section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="title">
            <button className="rooms-btn" onClick={revealRooms} title="Rooms" aria-label="Rooms">
              <PanelLeft size={22} />
            </button>
            <div>
              <h1>{room?.name ?? 'Control4 Navigator'}</h1>
              <div className="subtitle">{room ? `${count} ${menu}` : ''}</div>
            </div>
          </div>
          <div className="topright">
            {navRoomName && <span className="pill nav">{navRoomName}</span>}
            {ack && <span className="pill ack">{ack}</span>}
            <Clock />
          </div>
        </header>

        <Section className="tabs" focusKey="menus">
          {availableMenus.map((m) => (
            <Tile key={m} className="tab" icon={<ExperienceIcon menu={m} size={22} />} label={m}
              active={m === menu} onEnter={() => { setMenu(m); setOpenId(null) }} />
          ))}
        </Section>

        {openDev ? (
          <ControlPanel dev={openDev} cmd={cmd} onBack={() => backRef.current()} />
        ) : (
          <Section className="grid" focusKey="devices">
            {isAV(menu)
              ? sources.map((s) => (
                  <Tile key={s.id} className="src" icon={<C4Icon path={s.icon} fallback={<SourceIcon kind={s.kind} size={46} />} />}
                    label={s.name} active={activeId === s.id} onEnter={() => selectSource(room!, s)} />
                ))
              : menuDevices.map((d) => (
                  <Tile key={d.id} className="src" icon={<C4Icon path={d.icon} fallback={<DeviceIcon proxy={d.proxy} size={46} />} />}
                    label={d.name} onEnter={() => openDevice(d)} />
                ))}
            {count === 0 && <div className="empty">Nothing under {menu} in this room.</div>}
          </Section>
        )}
      </main>

      {room && (() => {
        const np = room.now_playing
        const playing = npName != null
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
              {playing && (np.art_url || npItem?.icon) && (
                <img className="np-art" alt="" src={np.art_url || `/c4icon/${npItem!.icon}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              )}
              <div>
                <div className="np-eyebrow">{playing ? 'Now Playing' : 'Room'}</div>
                <div className="np-title">{playing ? np.title || npName : room.name}</div>
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
        <div className="panel-title"><DeviceIcon proxy={dev.proxy} size={28} /> {dev.name}</div>
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
    </div>
  )
}
