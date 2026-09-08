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
}

export interface Room {
  id: number
  name: string
  floor?: string | null
  devices: Record<string, Device>
  current_video_device?: number | null
  current_audio_device?: number | null
  volume?: number | null
  is_muted: boolean
  power_on: boolean
  now_playing: NowPlaying
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

export function proxyName(p: ProxyKind): string {
  return typeof p === 'string' ? p : p.other
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
