// Mirrors the backend ServerMsg + control4-navigator-sink-lib model JSON.

export type ProxyKind = string | { other: string }

export interface Device {
  id: number
  name: string
  proxy: ProxyKind
  room_id?: number | null
  props: Record<string, string>
}

export interface NowPlaying {
  title?: string | null
  artist?: string | null
  album?: string | null
  art_url?: string | null
  source_device?: number | null
  app?: string | null
  state?: string | null
  transports?: string[]
}

// A selectable Watch/Listen source (from /rooms/:id/media) — not 1:1 with a proxy.
export interface Source {
  id: number
  name: string
  kind: string // HDMI, RF_MINI_APP, STEREO, DIGITAL_AUDIO_SERVER, COMPONENT, ...
  audio_video: boolean
}

export interface Room {
  id: number
  name: string
  floor?: string | null
  devices: Record<string, Device>
  watch?: Source[]
  listen?: Source[]
  current_video_device?: number | null
  current_audio_device?: number | null
  volume?: number | null
  is_muted: boolean
  power_on: boolean
  now_playing: NowPlaying
  favorites?: number[]
}

export interface Project {
  name?: string | null
  rooms: Record<string, Room>
  devices: Record<string, Device>
}

export interface NavigatorState {
  navigating_room?: number | null
  last_key?: string | null
  online: boolean
  brightness?: number | null
  status?: string | null
}

export interface EventDto {
  kind: string
  key?: string | null
  room?: number | null
  command?: string | null
}

export type ServerMsg =
  | { type: 'snapshot'; project: Project; nav: NavigatorState }
  | { type: 'event'; event: EventDto }
  | { type: 'nav'; nav: NavigatorState }
  | { type: 'command_ack'; ok: boolean; item: number; command: string; error?: string | null }

// Reverse channel: UI -> backend -> Control4.
export interface CommandMsg {
  type: 'command'
  item: number
  command: string
  params?: Record<string, unknown>
}

export function proxyName(p: ProxyKind): string {
  return typeof p === 'string' ? p : p.other
}

// Friendly, human label for a proxy (subtitle in the UI — never the raw driver id).
const KIND: Record<string, string> = {
  tv: 'TV', cable: 'Cable', rf_cable: 'Cable', satellite: 'Satellite', dvd: 'Player',
  media_player: 'Source', media_service: 'App', receiver: 'Receiver',
  amplifier: 'Amplifier', avswitch: 'Switch', av_switch: 'Switch', tuner: 'Tuner',
  light: 'Light', light_v2: 'Light', thermostat: 'Thermostat', lock: 'Lock',
  blind: 'Shade', camera: 'Camera', fan: 'Fan', pool: 'Pool',
  uidevice: 'Touchscreen', ui_device: 'Touchscreen', controller: 'Controller',
  intercomproxy: 'Intercom', control4_sr250: 'Remote',
}
export function deviceKind(p: ProxyKind): string {
  const n = proxyName(p)
  return KIND[n] ?? n.replace(/_/g, ' ')
}

// Friendly label for a Control4 media-source `kind` string.
const SRC_KIND: Record<string, string> = {
  RF_MINI_APP: 'App', HDMI: 'HDMI', COMPONENT: 'Input', STEREO: 'Stereo',
  VIDEO_SELECTION: 'TV', AUDIO_SELECTION: 'Audio', DIGITAL_AUDIO_SERVER: 'Streaming',
  DIGITAL_AUDIO_CLIENT: 'Audio', SPECIAL_AUDIO: 'Audio', RF_FM: 'FM Radio',
  RF_AM: 'AM Radio', UIButton: 'Input',
}
export function sourceKind(kind: string): string {
  return SRC_KIND[kind] ?? kind.replace(/_/g, ' ').toLowerCase()
}

// Which navigator menu a proxy belongs under (mirrors lib menu_for_proxy).
export type Menu = 'Watch' | 'Listen' | 'Lighting' | 'Comfort' | 'Security' | 'Shades' | 'Cameras' | 'Other'
export function menuFor(p: ProxyKind): Menu {
  switch (proxyName(p)) {
    case 'tv': case 'dvd': case 'cable': case 'satellite': case 'avswitch': return 'Watch'
    case 'receiver': case 'amplifier': case 'media_service': return 'Listen'
    case 'light': return 'Lighting'
    case 'thermostat': case 'fan': case 'pool': return 'Comfort'
    case 'security': case 'lock': return 'Security'
    case 'blind': return 'Shades'
    case 'camera': return 'Cameras'
    default: return 'Other'
  }
}
