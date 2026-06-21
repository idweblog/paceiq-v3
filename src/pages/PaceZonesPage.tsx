import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

// ─── Jack Daniels Formula (dari v2.11) ───────────────────────────────────────
function vfromVDOT(vdot: number, pct: number): number {
  const a = 0.000104, b = 0.182258, c = -(4.60 + vdot * pct)
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
}
function vtoPaceSec(v: number): number {
  return Math.round((1000 / v) * 60)
}
function fmtSec(sec: number | null): string {
  if (!sec || isNaN(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function fmtPaceRange(loSec: number, hiSec: number): string {
  return `${fmtSec(loSec)} – ${fmtSec(hiSec)}`
}

// Heat penalty dari v2.11
function heatPenalty(wbgt: number, zoneIdx: number): number {
  if (!wbgt || wbgt < 23) return 0
  const multipliers = [1.2, 1.1, 1.0, 0.9, 0.7, 0.6, 0.55, 0.5, 0.4]
  const mult = multipliers[zoneIdx] ?? 1.0
  let base = 0
  if (wbgt < 28) base = Math.round((wbgt - 23) * 4)
  else if (wbgt < 32) base = Math.round(20 + (wbgt - 28) * 8)
  else base = Math.round(52 + (wbgt - 32) * 12)
  return Math.round(base * mult)
}

// ─── 9 Zona Pace Definition ──────────────────────────────────────────────────
interface PaceZone {
  key: string
  name: string
  pctVo2Lo: number
  pctVo2Hi: number
  pctLthrLo: number
  pctLthrHi: number
  color: string
  bgColor: string
  rpe: string
  desc: string
  usage: string
  danielsRef: string
}

const PACE_ZONES: PaceZone[] = [
  {
    key: 'recovery',
    name: 'Recovery Run',
    pctVo2Lo: 0.55, pctVo2Hi: 0.60,
    pctLthrLo: 0,   pctLthrHi: 75,
    color: '#6b7280', bgColor: '#f9fafb',
    rpe: '1–2',
    desc: 'Active recovery, capillary bed development',
    usage: 'Warm-up, cool-down, recovery day',
    danielsRef: 'Daniels E (bawah) — <75% LTHR'
  },
  {
    key: 'longrun',
    name: 'Long Run',
    pctVo2Lo: 0.62, pctVo2Hi: 0.65,
    pctLthrLo: 75,  pctLthrHi: 80,
    color: '#10b981', bgColor: '#f0fdf4',
    rpe: '3–4',
    desc: 'Mitochondrial biogenesis, fat oxidation, aerobic base',
    usage: 'Long run (90–180 mnt), RWR sesi panjang',
    danielsRef: 'Daniels E (tengah) — 75–80% LTHR'
  },
  {
    key: 'easy',
    name: 'Easy Run',
    pctVo2Lo: 0.65, pctVo2Hi: 0.74,
    pctLthrLo: 80,  pctLthrHi: 89,
    color: '#22c55e', bgColor: '#f0fdf4',
    rpe: '4–5',
    desc: 'Aerobic base, meningkatkan stroke volume',
    usage: 'Easy run harian, sesi konservatif',
    danielsRef: 'Daniels E (atas) — 80–89% LTHR'
  },
  {
    key: 'moderate',
    name: 'Moderate / MD-1',
    pctVo2Lo: 0.75, pctVo2Hi: 0.84,
    pctLthrLo: 83,  pctLthrHi: 87,
    color: '#f59e0b', bgColor: '#fffbeb',
    rpe: '5–6',
    desc: 'Aerobic threshold bawah, race-simulation HM/FM',
    usage: 'Marathon-pace run, medium-long run finish miles',
    danielsRef: 'Daniels M — 75–84% VO₂max'
  },
  {
    key: 'tempo',
    name: 'Tempo',
    pctVo2Lo: 0.83, pctVo2Hi: 0.88,
    pctLthrLo: 88,  pctLthrHi: 90,
    color: '#f97316', bgColor: '#fff7ed',
    rpe: '6–7',
    desc: 'Lactate steady-state, aerobic threshold (AeT)',
    usage: 'Tempo run 20–30 mnt, cruise interval',
    danielsRef: 'Daniels T (bawah) — 83–88% VO₂max'
  },
  {
    key: 'threshold',
    name: 'Threshold',
    pctVo2Lo: 0.88, pctVo2Hi: 0.92,
    pctLthrLo: 91,  pctLthrHi: 94,
    color: '#ef4444', bgColor: '#fef2f2',
    rpe: '7–8',
    desc: 'Lactate threshold (LT), anaerobic threshold',
    usage: 'LT interval, sub-threshold reps 10–15 mnt',
    danielsRef: 'Daniels T (atas) / Friel Z4 — 88–92% VO₂max'
  },
  {
    key: 'suprathreshold',
    name: 'Aerobic Power / Supra-Threshold',
    pctVo2Lo: 0.92, pctVo2Hi: 0.97,
    pctLthrLo: 95,  pctLthrHi: 99,
    color: '#8b5cf6', bgColor: '#f5f3ff',
    rpe: '8–9',
    desc: 'Antara threshold dan VO₂max, high aerobic power',
    usage: '5K pace reps, supra-threshold interval',
    danielsRef: 'Antara Daniels T–I — 92–97% VO₂max'
  },
  {
    key: 'vo2max',
    name: 'VO₂Max / Interval',
    pctVo2Lo: 0.97, pctVo2Hi: 1.00,
    pctLthrLo: 100, pctLthrHi: 106,
    color: '#6366f1', bgColor: '#eef2ff',
    rpe: '9',
    desc: 'VO₂max improvement, cardiac output maksimal',
    usage: 'Track interval 3–5 mnt, 1200m/1600m reps',
    danielsRef: 'Daniels I — 95–100% VO₂max'
  },
  {
    key: 'anaerob',
    name: 'Anaerob / Sprint',
    pctVo2Lo: 1.00, pctVo2Hi: 1.10,
    pctLthrLo: 106, pctLthrHi: 999,
    color: '#dc2626', bgColor: '#fef2f2',
    rpe: '9–10',
    desc: 'Neuromuscular power, anaerobic capacity',
    usage: 'Strides, 200–400m reps, sprint finish',
    danielsRef: 'Daniels R — >100% VO₂max'
  }
]

// ─── HR Zones (Joe Friel 5-zone) ─────────────────────────────────────────────
interface HrZone {
  id: string; name: string; pctLo: number; pctHi: number
  rpe: string; desc: string; app: string; color: string
}
const HR_ZONES: HrZone[] = [
  { id: 'z1', name: 'Z1 — Recovery',  pctLo: 0,   pctHi: 84,  rpe: '1–3', desc: 'Active recovery, capillary development',        app: 'Warm-up, Cool-down, Recovery run',   color: '#6b7280' },
  { id: 'z2', name: 'Z2 — Aerobic',   pctLo: 85,  pctHi: 89,  rpe: '4–5', desc: 'Mitochondrial biogenesis, fat oxidation',       app: 'Easy run, Long Run (dominant)',      color: '#22c55e' },
  { id: 'z3', name: 'Z3 — Tempo',     pctLo: 90,  pctHi: 94,  rpe: '6–7', desc: 'Aerobic threshold (AeT), lactate steady-state', app: 'Tempo run, LR finish miles',         color: '#f59e0b' },
  { id: 'z4', name: 'Z4 — Sub-LT',    pctLo: 95,  pctHi: 99,  rpe: '7–8', desc: 'Lactate clearance, anaerobic threshold',        app: 'Cruise intervals, Sub-LT reps',      color: '#ef4444' },
  { id: 'z5', name: 'Z5 — VO₂max+',  pctLo: 100, pctHi: 106, rpe: '9–10',desc: 'VO₂max improvement, neuromuscular power',       app: 'Track work, strides, VO2 intervals', color: '#8b5cf6' },
]

// ─── Types ────────────────────────────────────────────────────────────────────
interface AthleteInfo {
  id: string
  lthr: number | null
  vdot: number | null
  maxhr: number | null
  rhr: number | null
}

interface PaceZoneAdjustment {
  id: string
  zone_key: string
  pct_override: number | null  // dipakai sebagai offset detik (integer)
  notes: string | null
  adjusted_at: string
  adjuster_name: string | null
}

interface TtHistoryRow {
  id: string
  tt_date: string
  vdot: number | null
  lthr_calculated: number | null
  tt_type: string | null
}

interface WeatherCache {
  wbgt: number
  temp: number
  humidity: number
  fetched_at: number
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PaceZonesPage() {
  const [athleteInfo, setAthleteInfo]   = useState<AthleteInfo | null>(null)
  const [myRoles, setMyRoles]           = useState<string[]>([])
  const [adjustments, setAdjustments]   = useState<PaceZoneAdjustment[]>([])
  const [ttHistory, setTtHistory]       = useState<TtHistoryRow[]>([])
  const [heatMode, setHeatMode]         = useState(false)
  const [weather, setWeather]           = useState<WeatherCache | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [loading, setLoading]           = useState(true)

  const [adjForm, setAdjForm]     = useState<{ zone_key: string; offset_sec: string; notes: string }>({ zone_key: '', offset_sec: '0', notes: '' })
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjMsg, setAdjMsg]       = useState('')

  const [athleteList, setAthleteList]       = useState<{ id: string; name: string }[]>([])
  const [targetAthleteId, setTargetAthleteId] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  const myIdRef      = useRef<string | null>(null)

  const isCoachOrAdmin = myRoles.includes('coach') || myRoles.includes('admin')

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (targetId?: string) => {
    cancelledRef.current = false
    setLoading(true)
    try {
      // 1. Get my athlete ID once
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return
      myIdRef.current = myId as string

      // 2. Roles
      const { data: rolesData } = await supabase
        .from('athlete_roles')
        .select('roles(name)')
        .eq('athlete_id', myId as string)
      if (!cancelledRef.current && rolesData) {
        const roles = (rolesData as any[]).map(r => r.roles?.name).filter(Boolean)
        setMyRoles(roles)
      }

      const effectiveId = targetId ?? (myId as string)

      // 3. Athlete settings
      const { data: settings } = await supabase
        .from('athlete_settings')
        .select('max_hr, resting_hr')
        .eq('athlete_id', effectiveId)
        .single()

      // 4. TT history — ambil semua, pilih terbaik
      const { data: latestTT } = await supabase
        .from('tt_history')
        .select('id, tt_date, vdot, lthr_calculated, tt_type')
        .eq('athlete_id', effectiveId)
        .order('tt_date', { ascending: false })
        .limit(10)

      if (!cancelledRef.current) {
        const rows = (latestTT ?? []) as any[]
        const withLthr = rows.find(t => t.lthr_calculated != null)
        const withVdot = rows.find(t => t.vdot != null)
        const best = withLthr ?? withVdot ?? rows[0] ?? null
        setAthleteInfo({
          id: effectiveId,
          lthr: best?.lthr_calculated ?? null,
          vdot: best?.vdot ?? null,
          maxhr: (settings as any)?.max_hr ?? null,
          rhr: (settings as any)?.resting_hr ?? null,
        })
        setTtHistory(rows as TtHistoryRow[])
      }

      // 5. Pace zone adjustments
      const { data: adjData } = await supabase
        .from('pace_zone_adjustments')
        .select('id, zone_key, pct_override, notes, adjusted_at, adjusted_by_athlete_id')
        .eq('athlete_id', effectiveId)
        .order('adjusted_at', { ascending: false })

      if (!cancelledRef.current && adjData) {
        const rows = adjData as any[]
        const adjusterIds = [...new Set(rows.map(a => a.adjusted_by_athlete_id).filter(Boolean))]
        let nameMap: Record<string, string> = {}
        if (adjusterIds.length) {
          const { data: names } = await supabase
            .from('athletes')
            .select('id, name')
            .in('id', adjusterIds as string[])
          ;(names as any[] ?? []).forEach(n => { nameMap[n.id] = n.name })
        }
        setAdjustments(rows.map(a => ({
          id: a.id,
          zone_key: a.zone_key,
          pct_override: a.pct_override,
          notes: a.notes,
          adjusted_at: a.adjusted_at,
          adjuster_name: nameMap[a.adjusted_by_athlete_id] ?? 'Coach'
        })))
      }


      // 6. Athlete list untuk coach — via group_programs (coach_athlete_id)
      const { data: gpData } = await supabase
        .from("group_programs")
        .select("id")
        .eq("coach_athlete_id", myId as string)

      if (!cancelledRef.current && gpData && (gpData as any[]).length > 0) {
        const programIds = (gpData as any[]).map((g: any) => g.id)
        const { data: memberData } = await supabase
          .from("group_members")
          .select("athlete_id, athletes(id, name)")
          .in("group_id", programIds)
          .eq("status", "active")
        if (!cancelledRef.current && memberData) {
          const seen = new Set<string>()
          const list = (memberData as any[])
            .map((m: any) => m.athletes)
            .filter(Boolean)
            .filter((a: any) => a.id !== myId)
            .filter((a: any) => { if (seen.has(a.id)) return false; seen.add(a.id); return true })
          setAthleteList(list)
        }
      }

    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(targetAthleteId ?? undefined)
    return () => { cancelledRef.current = true }
  }, [targetAthleteId, loadData])

  // ── Weather / WBGT ────────────────────────────────────────────────────────
  async function fetchWeather() {
    const cacheKey = 'paceiq_weather_wbgt'
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const parsed: WeatherCache = JSON.parse(cached)
      if (Date.now() - parsed.fetched_at < 30 * 60 * 1000) {
        setWeather(parsed)
        return
      }
    }
    setWeatherLoading(true)
    try {
      const geo = await fetch('https://ipapi.co/json/').then(r => r.json())
      const lat = geo.latitude ?? -5.14
      const lon = geo.longitude ?? 119.43
      const wx = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=ms`
      ).then(r => r.json())
      const temp = wx.current?.temperature_2m ?? 30
      const rh   = wx.current?.relative_humidity_2m ?? 70
      const ws   = wx.current?.wind_speed_10m ?? 2
      const Tw = temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
             + Math.atan(temp + rh)
             - Math.atan(rh - 1.676331)
             + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh)
             - 4.686035
      const wbgt = Math.round((0.7 * Tw + 0.2 * temp + 0.1 * (temp - ws * 0.5)) * 10) / 10
      const data: WeatherCache = { wbgt, temp, humidity: rh, fetched_at: Date.now() }
      localStorage.setItem(cacheKey, JSON.stringify(data))
      setWeather(data)
    } catch {
      // silently fail
    } finally {
      setWeatherLoading(false)
    }
  }

  useEffect(() => {
    if (heatMode && !weather) fetchWeather()
  }, [heatMode])

  // ── Pace calculation ──────────────────────────────────────────────────────
  function calcZonePaces(vdot: number): { loSec: number; hiSec: number }[] {
    return PACE_ZONES.map(z => ({
      loSec: vtoPaceSec(vfromVDOT(vdot, z.pctVo2Lo)),
      hiSec: vtoPaceSec(vfromVDOT(vdot, z.pctVo2Hi))
    }))
  }

  // pct_override dipakai sebagai offset detik (integer positif = lebih lambat)
  function getAdjOffset(zoneKey: string): number {
    const adj = adjustments.find(a => a.zone_key === zoneKey)
    return adj?.pct_override ?? 0
  }

  // ── Coach save adjustment ─────────────────────────────────────────────────
  async function saveAdjustment() {
    if (!adjForm.zone_key || !targetAthleteId || !myIdRef.current) return
    setAdjSaving(true)
    setAdjMsg('')
    try {
      const offset = parseInt(adjForm.offset_sec) || 0
      const existing = adjustments.find(a => a.zone_key === adjForm.zone_key)
      if (existing) {
        await supabase
          .from('pace_zone_adjustments')
          .update({
            pct_override: offset,
            notes: adjForm.notes,
            adjusted_at: new Date().toISOString(),
            adjusted_by_athlete_id: myIdRef.current
          } as any)
          .eq('id', existing.id)
      } else {
        await supabase
          .from('pace_zone_adjustments')
          .insert({
            athlete_id: targetAthleteId,
            zone_key: adjForm.zone_key,
            pct_override: offset,
            notes: adjForm.notes,
            adjusted_by_athlete_id: myIdRef.current
          } as any)
      }
      setAdjMsg('✓ Adjustment tersimpan')
      setAdjForm({ zone_key: '', offset_sec: '0', notes: '' })
      await loadData(targetAthleteId)
    } catch {
      setAdjMsg('✗ Gagal menyimpan')
    } finally {
      setAdjSaving(false)
    }
  }

  async function deleteAdjustment(id: string) {
    await supabase.from('pace_zone_adjustments').delete().eq('id', id)
    await loadData(targetAthleteId ?? undefined)
  }

  // ── HR zone calc ──────────────────────────────────────────────────────────
  function calcHrRange(z: HrZone, lthr: number): string {
    if (z.pctLo === 0) return `< ${Math.round(lthr * 0.85)} bpm`
    if (z.id === 'z5') return `≥ ${lthr} bpm`
    const lo = Math.round(lthr * z.pctLo / 100)
    const hi = Math.round(lthr * z.pctHi / 100)
    return `${lo}–${hi} bpm`
  }

  function currentZoneId(lthr: number, rhr: number): string {
    const estHR = Math.round(rhr * 1.15)
    for (const z of HR_ZONES) {
      const lo = z.pctLo === 0 ? 0 : Math.round(lthr * z.pctLo / 100)
      const hi = z.id === 'z5' ? 9999 : Math.round(lthr * z.pctHi / 100)
      if (estHR >= lo && estHR <= hi) return z.id
    }
    return 'z1'
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = [...ttHistory].reverse().map(t => ({
    date: t.tt_date?.slice(0, 10) ?? '',
    vdot: t.vdot ? Math.round(t.vdot * 100) / 100 : null,
    lthr: t.lthr_calculated,
    label: t.tt_type ?? ''
  }))

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Memuat data zona...
      </div>
    )
  }

  const lthr     = athleteInfo?.lthr ?? null
  const vdot     = athleteInfo?.vdot ?? null
  const maxhr    = athleteInfo?.maxhr ?? (lthr ? Math.round(lthr / 0.88) : null)
  const rhr      = athleteInfo?.rhr ?? 55
  const zonePaces = vdot ? calcZonePaces(vdot) : null

  const wbgt = weather?.wbgt ?? null
  const wbgtBadge = wbgt == null ? null
    : wbgt >= 35 ? { label: 'EXTREME',   cls: 'bg-red-700 text-white' }
    : wbgt >= 32 ? { label: 'HIGH RISK', cls: 'bg-red-500 text-white' }
    : wbgt >= 28 ? { label: 'CAUTION',   cls: 'bg-amber-400 text-white' }
    : { label: 'AMAN', cls: 'bg-green-500 text-white' }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {/* ── Header badges ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {lthr && (
            <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-200">
              ❤️ LTHR: {lthr} bpm
            </span>
          )}
          {maxhr && (
            <span className="inline-flex items-center gap-1.5 bg-gray-50 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200">
              ↑ MaxHR: {maxhr} bpm
            </span>
          )}
          {vdot && (
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-200">
              ⚡ VDOT: {vdot}
            </span>
          )}
        </div>

        {/* Heat Mode Toggle */}
        <button
          onClick={() => setHeatMode(m => !m)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
            heatMode
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400 hover:text-amber-600'
          }`}
        >
          🌡️ Heat Mode {heatMode ? 'ON' : 'OFF'}
          {heatMode && wbgt != null && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${wbgtBadge?.cls}`}>
              WBGT {wbgt}°C
            </span>
          )}
          {heatMode && weatherLoading && <span className="text-xs opacity-70">loading...</span>}
        </button>
      </div>

      {/* ── No data warning ── */}
      {(!lthr || !vdot) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          ⚠️ {!lthr && !vdot ? 'LTHR dan VDOT belum tersedia.' : !lthr ? 'LTHR belum tersedia.' : 'VDOT belum tersedia.'}
          {' '}Tambahkan Time Trial di menu <strong>Profil</strong> untuk mengaktifkan kalkulasi zona.
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 1 — HR ZONES                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
          HR Zones — Joe Friel LTHR Model
        </h2>

        {lthr ? (
          <>
            {/* Visual bar */}
            <div className="flex rounded-lg overflow-hidden h-8 mb-4">
              {HR_ZONES.map(z => (
                <div key={z.id} className="flex-1 flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: z.color }}>
                  {z.id.toUpperCase()}
                </div>
              ))}
            </div>

            {/* Zone cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {HR_ZONES.map(z => {
                const isActive = currentZoneId(lthr, rhr) === z.id
                const hrRange  = calcHrRange(z, lthr)
                const pctStr   = z.pctLo === 0 ? '< 85% LTHR' : z.id === 'z5' ? '≥ 100% LTHR' : `${z.pctLo}–${z.pctHi}% LTHR`
                return (
                  <div key={z.id}
                    className={`relative rounded-lg border-2 p-3 ${isActive ? 'shadow-md' : 'border-gray-200'}`}
                    style={{ borderColor: isActive ? z.color : undefined, backgroundColor: isActive ? z.color + '10' : '#fafafa' }}>
                    {isActive && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white border text-xs font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap"
                        style={{ color: z.color, borderColor: z.color }}>
                        📍 Zona Saat Ini
                      </div>
                    )}
                    <div className="text-xs font-bold mb-1" style={{ color: z.color }}>{z.name}</div>
                    <div className="text-lg font-bold text-gray-800">{hrRange}</div>
                    <div className="text-xs text-gray-400 mb-1">{pctStr} · RPE {z.rpe}</div>
                    <div className="text-xs text-gray-500">{z.desc}</div>
                    <div className="text-xs text-gray-400 mt-1 italic">{z.app}</div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              * "Zona Saat Ini" diestimasi dari HRrest × 1.15 ({Math.round(rhr * 1.15)} bpm).
              Sumber: Joe Friel, <em>The Triathlete's Training Bible</em>.
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">LTHR belum tersedia. Tambahkan Time Trial di menu Profil.</p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 2 — PACE CHART 9 ZONA                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4 border-b border-indigo-100 pb-2">
          <h2 className="font-gsans text-xl text-indigo-700 uppercase">
            Pace Chart — 9 Training Zones
          </h2>
          {vdot && (
            <span className="text-xs text-gray-400">
              Daniels' Running Formula (Ed.3) + Friel LTHR Hybrid · VDOT {vdot}
            </span>
          )}
        </div>

        {vdot && lthr ? (
          <>
            {/* Heat advisory strip */}
            {heatMode && wbgt != null && wbgt >= 28 && (
              <div className={`rounded-lg px-4 py-2 mb-4 text-sm font-medium flex items-center gap-2 ${
                wbgt >= 35 ? 'bg-red-100 text-red-700'
                : wbgt >= 32 ? 'bg-orange-100 text-orange-700'
                : 'bg-amber-100 text-amber-700'
              }`}>
                🌡️ WBGT {wbgt}°C —{' '}
                {wbgt >= 35 ? 'EXTREME: Tunda sesi kualitas. Risiko heat stroke tinggi.'
                : wbgt >= 32 ? 'HIGH RISK: Tambahkan 30–60 detik/km. Pantau HR ketat.'
                : 'CAUTION: Tambahkan 10–25 detik/km. Prioritaskan RPE, biarkan HR naik 1 zona.'}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase w-6">No.</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Zona</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">% VO₂max</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">HR Range</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">RPE</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Pace (min/km)</th>
                    {isCoachOrAdmin && (
                      <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Adj. Coach</th>
                    )}
                    {heatMode && wbgt != null && (
                      <th className="text-center px-3 py-2 text-xs font-medium text-amber-600 uppercase">Heat Adj.</th>
                    )}
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Penggunaan</th>
                  </tr>
                </thead>
                <tbody>
                  {PACE_ZONES.map((z, i) => {
                    const paces     = zonePaces![i]
                    const adjOffset = getAdjOffset(z.key)
                    const heatOff   = heatMode && wbgt != null ? heatPenalty(wbgt, i) : 0
                    const adjLoSec  = paces.loSec + adjOffset + heatOff
                    const adjHiSec  = paces.hiSec + adjOffset + heatOff
                    const hasAdj    = adjOffset !== 0
                    const hrLo = z.pctLthrLo === 0 ? null : Math.round(lthr * z.pctLthrLo / 100)
                    const hrHi = z.pctLthrHi === 999 ? null : Math.round(lthr * z.pctLthrHi / 100)
                    const hrStr = hrLo == null ? `< ${Math.round(lthr * 0.75)} bpm`
                      : hrHi == null ? `≥ ${hrLo} bpm`
                      : `${hrLo}–${hrHi} bpm`
                    return (
                      <tr key={z.key} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-3 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: z.color }} />
                            <div>
                              <div className="text-sm font-bold text-gray-800">{z.name}</div>
                              <div className="text-xs text-gray-400">{z.danielsRef}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-xs font-medium text-gray-600">
                          {Math.round(z.pctVo2Lo * 100)}–{Math.round(z.pctVo2Hi * 100)}%
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-gray-600">{hrStr}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: z.bgColor, color: z.color }}>
                            {z.rpe}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="font-bold text-gray-800 text-sm">
                            {fmtPaceRange(adjLoSec, adjHiSec)}
                          </div>
                          {hasAdj && (
                            <div className="text-xs text-indigo-500 font-medium">
                              {adjOffset > 0 ? `+${adjOffset}s` : `${adjOffset}s`} adj.
                            </div>
                          )}
                          {heatOff > 0 && (
                            <div className="text-xs text-amber-500 font-medium">+{heatOff}s 🌡️</div>
                          )}
                        </td>
                        {isCoachOrAdmin && (
                          <td className="px-3 py-3 text-center text-xs text-indigo-500 font-medium">
                            {hasAdj ? (adjOffset > 0 ? `+${adjOffset}s` : `${adjOffset}s`) : <span className="text-gray-300">—</span>}
                          </td>
                        )}
                        {heatMode && wbgt != null && (
                          <td className="px-3 py-3 text-center text-xs text-amber-600 font-medium">
                            {heatOff > 0 ? `+${heatOff}s` : '—'}
                          </td>
                        )}
                        <td className="px-3 py-3 text-xs text-gray-500">{z.usage}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Visual gradient bar */}
            <div className="flex rounded-lg overflow-hidden h-5 mt-4 gap-px">
              {PACE_ZONES.map(z => (
                <div key={z.key} className="flex-1" style={{ backgroundColor: z.color }} title={z.name} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>← Lambat (Recovery)</span>
              <span>Cepat (Anaerob) →</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            VDOT dan LTHR belum tersedia. Tambahkan Time Trial di menu Profil.
          </p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 3 — COACH ADJUSTMENT (coach/admin only)                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {isCoachOrAdmin && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
            Coach Adjustment
          </h2>

          <div className="mb-5">
            <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Target Athlete</label>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 w-full max-w-xs focus:outline-none focus:border-indigo-400"
              value={targetAthleteId ?? ''}
              onChange={e => setTargetAthleteId(e.target.value || null)}
            >
              <option value="">— Pilih athlete —</option>
              {athleteList.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {targetAthleteId && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Zona</label>
                  <select
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 w-full focus:outline-none focus:border-indigo-400"
                    value={adjForm.zone_key}
                    onChange={e => setAdjForm(f => ({ ...f, zone_key: e.target.value }))}
                  >
                    <option value="">— Pilih zona —</option>
                    {PACE_ZONES.map((z, i) => (
                      <option key={z.key} value={z.key}>{i + 1}. {z.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Offset (detik/km)</label>
                  <input
                    type="number"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 w-full focus:outline-none focus:border-indigo-400"
                    placeholder="+30 atau -15"
                    value={adjForm.offset_sec}
                    onChange={e => setAdjForm(f => ({ ...f, offset_sec: e.target.value }))}
                  />
                  <p className="text-xs text-gray-400 mt-0.5">+ = lebih lambat, − = lebih cepat</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Catatan Coach</label>
                  <input
                    type="text"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 w-full focus:outline-none focus:border-indigo-400"
                    placeholder="Alasan penyesuaian..."
                    value={adjForm.notes}
                    onChange={e => setAdjForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={saveAdjustment}
                  disabled={adjSaving || !adjForm.zone_key}
                  className="px-4 py-2 rounded-lg border-2 border-indigo-600 text-indigo-600 text-sm font-medium hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {adjSaving ? 'Menyimpan...' : 'Simpan Adjustment'}
                </button>
                {adjMsg && <span className="text-sm text-gray-500">{adjMsg}</span>}
              </div>

              {adjustments.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs font-medium text-gray-500 uppercase mb-2">Historis Adjustment</div>
                  <div className="space-y-2">
                    {adjustments.map(a => {
                      const zone   = PACE_ZONES.find(z => z.key === a.zone_key)
                      const offset = a.pct_override ?? 0
                      return (
                        <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: zone?.color ?? '#9ca3af' }} />
                            <div>
                              <span className="text-sm font-bold text-gray-800">{zone?.name ?? a.zone_key}</span>
                              <span className="ml-2 text-xs font-semibold text-indigo-600">
                                {offset > 0 ? '+' : ''}{offset}s/km
                              </span>
                              {a.notes && <span className="ml-2 text-xs text-gray-400 italic">{a.notes}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">
                              {a.adjuster_name} · {a.adjusted_at?.slice(0, 10)}
                            </span>
                            <button
                              onClick={() => deleteAdjustment(a.id)}
                              className="text-xs text-red-500 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
                            >
                              Hapus
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 4 — PACE HISTORY CHART                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
          Pace History — Tren VDOT
        </h2>

        {chartData.length >= 2 ? (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} width={36} />
                <Tooltip
                  formatter={(val: any) => [String(val), 'VDOT']}
                  labelFormatter={(l: any) => `Tanggal: ${l}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Line type="monotone" dataKey="vdot" stroke="#4f46e5" strokeWidth={2.5}
                  dot={{ r: 4, fill: '#4f46e5' }} name="VDOT" connectNulls />
              </LineChart>
            </ResponsiveContainer>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-1.5 text-gray-500 font-medium uppercase">Tanggal</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium uppercase">Tipe TT</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium uppercase">VDOT</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium uppercase">LTHR</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium uppercase">Easy Pace</th>
                    <th className="text-center px-3 py-1.5 text-gray-500 font-medium uppercase">Tempo Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ttHistory].reverse().map(t => {
                    const v        = t.vdot
                    const easySec  = v ? vtoPaceSec(vfromVDOT(v, 0.65)) : null
                    const tempoSec = v ? vtoPaceSec(vfromVDOT(v, 0.86)) : null
                    return (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700">{t.tt_date?.slice(0, 10)}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{t.tt_type ?? '—'}</td>
                        <td className="px-3 py-2 text-center font-bold text-indigo-700">{t.vdot ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600">
                          {t.lthr_calculated ? `${t.lthr_calculated} bpm` : '—'}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600">{fmtSec(easySec)}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{fmtSec(tempoSec)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : chartData.length === 1 ? (
          <div className="text-sm text-gray-400 bg-gray-50 rounded-lg p-4 text-center">
            Baru ada 1 data TT. Chart akan muncul setelah minimal 2 Time Trial tersimpan.
            <div className="mt-2 font-semibold text-gray-600">VDOT saat ini: {chartData[0].vdot}</div>
          </div>
        ) : (
          <p className="text-sm text-gray-400">
            Belum ada riwayat Time Trial. Tambahkan TT di menu Profil.
          </p>
        )}
      </div>

    </div>
  )
}
