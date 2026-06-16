import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'

// ─── Types ───────────────────────────────────────────────────
interface Settings {
  lthr: number | null
  resting_hr: number | null
  max_hr: number | null
}

// ─── HR Zone Calculation (Joe Friel LTHR) ────────────────────
interface HrZone {
  zone: string
  name: string
  min: number
  max: number
  color: string
}

function calcHrZones(lthr: number): HrZone[] {
  return [
    { zone: 'Z1', name: 'Recovery',      min: 0,              max: Math.round(lthr * 0.81),  color: 'bg-blue-100 text-blue-700' },
    { zone: 'Z2', name: 'Aerobic',       min: Math.round(lthr * 0.81) + 1, max: Math.round(lthr * 0.89),  color: 'bg-green-100 text-green-700' },
    { zone: 'Z3', name: 'Tempo',         min: Math.round(lthr * 0.89) + 1, max: Math.round(lthr * 0.93),  color: 'bg-yellow-100 text-yellow-700' },
    { zone: 'Z4', name: 'SubThreshold',  min: Math.round(lthr * 0.93) + 1, max: Math.round(lthr * 0.99),  color: 'bg-orange-100 text-orange-700' },
    { zone: 'Z5a', name: 'SuperThreshold', min: Math.round(lthr * 0.99) + 1, max: Math.round(lthr * 1.02), color: 'bg-red-100 text-red-700' },
    { zone: 'Z5b', name: 'Aerobic Capacity', min: Math.round(lthr * 1.02) + 1, max: Math.round(lthr * 1.06), color: 'bg-red-200 text-red-800' },
    { zone: 'Z5c', name: 'Anaerobic',    min: Math.round(lthr * 1.06) + 1, max: 999,          color: 'bg-red-300 text-red-900' },
  ]
}

// ─── Pace Zone Calculation (Jack Daniels VDOT) ───────────────
interface PaceZone {
  zone: string
  name: string
  paceRange: string
  effort: string
  color: string
}

// VO2 at velocity v (m/min)
function vo2AtV(v: number): number {
  return -4.60 + 0.182258 * v + 0.000104 * v * v
}

// Find velocity (m/min) at given % of VDOT
function velocityAtPct(vdot: number, pct: number): number {
  const target = vdot * pct
  let lo = 50, hi = 700
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    vo2AtV(mid) < target ? lo = mid : hi = mid
  }
  return (lo + hi) / 2
}

function secPerKmToStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function paceStr(vPerMin: number): string {
  return secPerKmToStr(1000 / vPerMin * 60)
}

function calcPaceZones(vdot: number, heatAdj: number = 0): PaceZone[] {
  const adj = (base: number) => base + heatAdj

  const easyLo  = velocityAtPct(vdot, 0.59)
  const easyHi  = velocityAtPct(vdot, 0.74)
  const mLo     = velocityAtPct(vdot, 0.75)
  const mHi     = velocityAtPct(vdot, 0.84)
  const tV      = velocityAtPct(vdot, 0.88)
  const iV      = velocityAtPct(vdot, 0.98)
  const rV      = velocityAtPct(vdot, 1.05)

  return [
    {
      zone: 'E',
      name: 'Easy / Long Run',
      paceRange: `${secPerKmToStr(adj(1000 / easyHi * 60))} – ${secPerKmToStr(adj(1000 / easyLo * 60))}`,
      effort: '59–74% VDOT · Z1–Z2 HR',
      color: 'bg-blue-50 border-blue-200 text-blue-800',
    },
    {
      zone: 'M',
      name: 'Marathon Pace',
      paceRange: `${secPerKmToStr(adj(1000 / mHi * 60))} – ${secPerKmToStr(adj(1000 / mLo * 60))}`,
      effort: '75–84% VDOT · Z3 HR',
      color: 'bg-green-50 border-green-200 text-green-800',
    },
    {
      zone: 'T',
      name: 'Threshold / Tempo',
      paceRange: paceStr(tV),
      effort: '88% VDOT · Z4 HR',
      color: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    },
    {
      zone: 'I',
      name: 'Interval',
      paceRange: paceStr(iV),
      effort: '98% VDOT · Z5a HR',
      color: 'bg-orange-50 border-orange-200 text-orange-800',
    },
    {
      zone: 'R',
      name: 'Repetition',
      paceRange: paceStr(rV),
      effort: '105% VDOT · Z5b–Z5c HR',
      color: 'bg-red-50 border-red-200 text-red-800',
    },
  ]
}

// ─── Heat Adjustment (simple WBGT-based) ─────────────────────
// +sec per km adjustment per heat level
const HEAT_LEVELS = [
  { label: 'Tidak ada (< 22°C)',  adj: 0 },
  { label: 'Ringan (22–25°C)',    adj: 15 },
  { label: 'Sedang (25–28°C)',    adj: 30 },
  { label: 'Berat (28–32°C)',     adj: 45 },
  { label: 'Ekstrem (> 32°C)',    adj: 60 },
]

// ─── Component ────────────────────────────────────────────────
export default function PaceZonesPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [settings, setSettings] = useState<Settings>({ lthr: null, resting_hr: null, max_hr: null })
  const [latestVdot, setLatestVdot] = useState<number | null>(null)
  const [heatLevel, setHeatLevel] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!athleteId) return
    loadData()
  }, [athleteId])

  async function loadData() {
    setLoading(true)
    await Promise.all([loadSettings(), loadLatestTt()])
    setLoading(false)
  }

  async function loadSettings() {
    if (!athleteId) return
    const { data } = await supabase
      .from('athlete_settings')
      .select('lthr, resting_hr, max_hr')
      .eq('athlete_id', athleteId)
      .maybeSingle()
    if (data) setSettings(data)
  }

  async function loadLatestTt() {
    if (!athleteId) return
    const { data } = await supabase
      .from('tt_history')
      .select('distance_km, finish_time_sec, vdot')
      .eq('athlete_id', athleteId)
      .order('tt_date', { ascending: false })
      .limit(1)
    if (data && data.length > 0 && data[0].vdot) {
      setLatestVdot(data[0].vdot)
    }
  }

  const heatAdj = HEAT_LEVELS[heatLevel].adj
  const hrZones = settings.lthr ? calcHrZones(settings.lthr) : null
  const paceZones = latestVdot ? calcPaceZones(latestVdot, heatAdj) : null

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Pace & HR Zones" subtitle="Zone latihan berdasarkan LTHR dan VDOT" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Pace & HR Zones" subtitle="Zone latihan berdasarkan LTHR dan VDOT" />

      {/* Heat Mode Toggle */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm font-semibold text-gray-700">🌡️ Heat Mode</span>
          <span className="text-xs text-gray-400">Sesuaikan pace untuk kondisi panas</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {HEAT_LEVELS.map((h, i) => (
            <button
              key={i}
              onClick={() => setHeatLevel(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                heatLevel === i
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
        {heatAdj > 0 && (
          <p className="text-xs text-amber-600 mt-2">
            ⚠️ Pace disesuaikan +{heatAdj} detik/km dari zone normal
          </p>
        )}
      </div>

      {/* Pace Zones */}
      <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Pace Zones (Jack Daniels)</h3>
        {latestVdot ? (
          <p className="text-xs text-gray-400 mb-4">Berdasarkan VDOT {latestVdot}</p>
        ) : (
          <p className="text-xs text-amber-600 mb-4">⚠️ Belum ada data TT. Input Time Trial di Profil untuk menghitung pace zones.</p>
        )}
        {paceZones ? (
          <div className="space-y-2">
            {paceZones.map(z => (
              <div key={z.zone} className={`flex items-center justify-between px-4 py-3 rounded-lg border ${z.color}`}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold w-6">{z.zone}</span>
                  <div>
                    <p className="text-sm font-semibold">{z.name}</p>
                    <p className="text-xs opacity-70">{z.effort}</p>
                  </div>
                </div>
                <span className="text-sm font-bold font-mono">{z.paceRange} /km</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {['E','M','T','I','R'].map(z => (
              <div key={z} className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-100 bg-gray-50">
                <span className="text-xs font-bold text-gray-400 w-6">{z}</span>
                <span className="text-sm text-gray-300">—</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* HR Zones */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">HR Zones (Joe Friel)</h3>
        {settings.lthr ? (
          <p className="text-xs text-gray-400 mb-4">Berdasarkan LTHR {settings.lthr} bpm</p>
        ) : (
          <p className="text-xs text-amber-600 mb-4">⚠️ LTHR belum diset. Isi di menu Profil & Analisis.</p>
        )}
        {hrZones ? (
          <div className="space-y-2">
            {hrZones.map(z => (
              <div key={z.zone} className={`flex items-center justify-between px-4 py-3 rounded-lg ${z.color}`}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold w-8">{z.zone}</span>
                  <span className="text-sm font-semibold">{z.name}</span>
                </div>
                <span className="text-sm font-mono font-bold">
                  {z.max === 999 ? `> ${z.min}` : `${z.min} – ${z.max}`} bpm
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {['Z1','Z2','Z3','Z4','Z5a','Z5b','Z5c'].map(z => (
              <div key={z} className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50">
                <span className="text-xs font-bold text-gray-400 w-8">{z}</span>
                <span className="text-sm text-gray-300">—</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}