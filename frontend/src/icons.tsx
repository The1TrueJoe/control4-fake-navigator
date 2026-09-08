// Lucide icons — no emoji anywhere in the UI.
import {
  Tv, Music, Lightbulb, Thermometer, ShieldCheck, Blinds, Video,
  PlayCircle, Disc, Satellite, AppWindow, Speaker, Radio, Router,
  Lock, Fan, Waves, Tablet, Cpu, Phone, Gamepad2, Square,
  Cable, MonitorPlay, ListMusic,
  DoorOpen, Star, Volume1, Volume2, VolumeX, Power, ChevronLeft,
  SkipBack, Play, Pause, SkipForward, Square as Stop, Plus, Minus,
  type LucideIcon,
} from 'lucide-react'
import type { Menu, ProxyKind } from './types'
import { proxyName } from './types'

type IconCmp = LucideIcon

const EXP: Partial<Record<Menu, IconCmp>> = {
  Watch: Tv, Listen: Music, Lighting: Lightbulb, Comfort: Thermometer,
  Security: ShieldCheck, Shades: Blinds, Cameras: Video,
}
export function ExperienceIcon({ menu, size = 24 }: { menu: Menu; size?: number }) {
  const I = EXP[menu] ?? Square
  return <I size={size} strokeWidth={1.75} />
}

const PROXY: Record<string, IconCmp> = {
  tv: Tv, cable: Tv, rf_cable: Tv, satellite: Satellite, dvd: Disc,
  media_player: PlayCircle, media_service: AppWindow, receiver: Speaker,
  amplifier: Speaker, avswitch: Router, av_switch: Router, tuner: Radio,
  light: Lightbulb, light_v2: Lightbulb, thermostat: Thermometer, lock: Lock,
  blind: Blinds, camera: Video, fan: Fan, pool: Waves, uidevice: Tablet,
  ui_device: Tablet, controller: Cpu, intercomproxy: Phone, control4_sr250: Gamepad2,
}
export function DeviceIcon({ proxy, size = 26 }: { proxy: ProxyKind; size?: number }) {
  const I = PROXY[proxyName(proxy)] ?? Square
  return <I size={size} strokeWidth={1.6} />
}

// Icon for a Control4 media-source `kind` string (Watch/Listen tiles).
const SRC: Record<string, IconCmp> = {
  RF_MINI_APP: AppWindow, HDMI: MonitorPlay, COMPONENT: Cable, STEREO: Radio,
  VIDEO_SELECTION: Tv, AUDIO_SELECTION: Speaker, DIGITAL_AUDIO_SERVER: Music,
  DIGITAL_AUDIO_CLIENT: Speaker, SPECIAL_AUDIO: ListMusic, RF_FM: Radio,
  RF_AM: Radio, UIButton: MonitorPlay,
}
export function SourceIcon({ kind, size = 26 }: { kind: string; size?: number }) {
  const I = SRC[kind] ?? PlayCircle
  return <I size={size} strokeWidth={1.6} />
}

export {
  DoorOpen, Star, Volume1, Volume2, VolumeX, Power, ChevronLeft,
  SkipBack, Play, Pause, SkipForward, Stop, Plus, Minus,
}
