import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

// ─── VCR Pace Formula ────────────────────────────────────────────────────────
// VCR (Velocity at Critical Race) = distance_m / finish_time_sec dari TT 30 menit
// Pace zona = 1000 / (vcr × pct) / 60 → detik/km
function vcrToPaceSec(vcr: number, pct: number): number {
  return Math.round(1000 / (vcr * pct))
}
function fmtSec(sec: number | null): string {
  if (!sec || isNaN(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
function parsePaceInput(str: string): number | null {
  // Terima format "M:SS" atau "MM:SS"
  const match = str.trim().match(/^(\d+):(\d{2})$/)
  if (!match) return null
  return parseInt(match[1]) * 60 + parseInt(match[2])
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
  key: string; name: string
  pctVcrLo: number; pctVcrHi: number   // % dari VCR (anchor = Aerobic Power 100%)
  pctLthrLo: number; pctLthrHi: number
  color: string; bgColor: string
  rpe: string; desc: string; usage: string; ref: string
}

// % VCR dari tabel lapangan (Aulia et al.) — anchor 100% = Aerobic Power (TT 30 menit)
// Sumber: analisis tabel Pace Chart Training HM, divalidasi vs literatur Billat 2001,
//         Midgley et al. 2007, Seiler & Tønnessen 2009
const PACE_ZONES: PaceZone[] = [
  { key: 'recovery',       name: 'Recovery Run',                    pctVcrLo: 0.64, pctVcrHi: 0.68, pctLthrLo: 0,   pctLthrHi: 75,  color: '#6b7280', bgColor: '#f9fafb', rpe: '1–2',  desc: 'Active recovery, capillary bed development',         usage: 'Warm-up, cool-down, recovery day',                ref: '64–68% VCR' },
  { key: 'longrun',        name: 'Long Run',                        pctVcrLo: 0.69, pctVcrHi: 0.71, pctLthrLo: 75,  pctLthrHi: 80,  color: '#10b981', bgColor: '#f0fdf4', rpe: '3–4',  desc: 'Mitochondrial biogenesis, fat oxidation',             usage: 'Long run (90–180 mnt), RWR sesi panjang',         ref: '69–71% VCR' },
  { key: 'easy',           name: 'Easy Run',                        pctVcrLo: 0.74, pctVcrHi: 0.76, pctLthrLo: 80,  pctLthrHi: 89,  color: '#22c55e', bgColor: '#f0fdf4', rpe: '4–5',  desc: 'Aerobic base, meningkatkan stroke volume',             usage: 'Easy run harian, sesi konservatif',                ref: '74–76% VCR' },
  { key: 'moderate',       name: 'Moderate / MD-1',                 pctVcrLo: 0.83, pctVcrHi: 0.85, pctLthrLo: 83,  pctLthrHi: 87,  color: '#f59e0b', bgColor: '#fffbeb', rpe: '5–6',  desc: 'Aerobic threshold bawah, race-simulation HM/FM',      usage: 'Marathon-pace run, medium-long run finish miles',   ref: '83–85% VCR' },
  { key: 'tempo',          name: 'Tempo',                           pctVcrLo: 0.88, pctVcrHi: 0.90, pctLthrLo: 88,  pctLthrHi: 90,  color: '#f97316', bgColor: '#fff7ed', rpe: '6–7',  desc: 'Lactate steady-state, aerobic threshold (AeT)',        usage: 'Tempo run 20–30 mnt, cruise interval',             ref: '88–90% VCR' },
  { key: 'threshold',      name: 'Threshold',                       pctVcrLo: 0.92, pctVcrHi: 0.94, pctLthrLo: 91,  pctLthrHi: 94,  color: '#ef4444', bgColor: '#fef2f2', rpe: '7–8',  desc: 'Lactate threshold (LT), anaerobic threshold',          usage: 'LT interval, sub-threshold reps 10–15 mnt',        ref: '92–94% VCR' },
  { key: 'suprathreshold', name: 'Aerobic Power / Supra-Threshold', pctVcrLo: 1.00, pctVcrHi: 1.02, pctLthrLo: 95,  pctLthrHi: 99,  color: '#8b5cf6', bgColor: '#f5f3ff', rpe: '8–9',  desc: 'Anchor VCR 100% — pace TT 30 menit',                usage: '5K pace reps, supra-threshold interval',            ref: '100–102% VCR — ANCHOR' },
  { key: 'vo2max',         name: 'VO₂Max / Interval',            pctVcrLo: 1.03, pctVcrHi: 1.05, pctLthrLo: 100, pctLthrHi: 106, color: '#6366f1', bgColor: '#eef2ff', rpe: '9',         desc: 'VO₂max improvement, cardiac output maksimal',       usage: 'Track interval 3–5 mnt, 1200m/1600m reps',         ref: '103–105% VCR' },
  { key: 'anaerob',        name: 'Anaerob / Sprint',                pctVcrLo: 1.09, pctVcrHi: 1.15, pctLthrLo: 106, pctLthrHi: 999, color: '#dc2626', bgColor: '#fef2f2', rpe: '9–10', desc: 'Neuromuscular power, anaerobic capacity',              usage: 'Strides, 200–400m reps, sprint finish',             ref: '109–115% VCR' },
]

// ─── HR Zones (Joe Friel 7-zone — Run) ───────────────────────────────────────
// Sumber: Joe Friel, TrainingPeaks "Quick Guide to Setting Zones"
interface HrZone {
  id: string; name: string; pctLo: number; pctHi: number
  rpe: string; desc: string; app: string; color: string
}
const HR_ZONES: HrZone[] = [
  { id: 'z1',  name: 'Z1 — Recovery',        pctLo: 0,   pctHi: 84,  rpe: '1–2',  desc: 'Active recovery, capillary development',        app: 'Warm-up, cool-down, easy recovery day',      color: '#9ca3af' },
  { id: 'z2',  name: 'Z2 — Aerobic',         pctLo: 85,  pctHi: 89,  rpe: '3–4',  desc: 'Aerobic base, mitochondrial biogenesis',         app: 'Easy run, long run (dominan)',               color: '#22c55e' },
  { id: 'z3',  name: 'Z3 — Tempo',           pctLo: 90,  pctHi: 94,  rpe: '5–6',  desc: 'Aerobic threshold (AeT), lactate steady-state',  app: 'Tempo run, LR finish miles',                 color: '#84cc16' },
  { id: 'z4',  name: 'Z4 — Sub-Threshold',   pctLo: 95,  pctHi: 99,  rpe: '6–7',  desc: 'Lactate clearance, anaerobic threshold zone',    app: 'Cruise intervals, sub-LT reps',              color: '#f59e0b' },
  { id: 'z5a', name: 'Z5a — Superthreshold', pctLo: 100, pctHi: 102, rpe: '8',    desc: 'Just above LTHR, anaerobic onset',               app: 'Short threshold intervals, 10K pace',        color: '#f97316' },
  { id: 'z5b', name: 'Z5b — Aerobic Power',  pctLo: 103, pctHi: 106, rpe: '9',    desc: 'VO₂max stimulus, high aerobic power',            app: 'Track intervals 3–5 mnt, 5K pace',           color: '#ef4444' },
  { id: 'z5c', name: 'Z5c — Anaerobic',      pctLo: 107, pctHi: 999, rpe: '9–10', desc: 'Anaerobic capacity, neuromuscular power',        app: 'Strides, 200–400m sprint, VO₂ short reps',  color: '#8b5cf6' },
]

// ─── Types ────────────────────────────────────────────────────────────────────
interface AthleteInfo {
  id: string; lthr: number | null; vcr: number | null  // m/s dari TT 30 menit
  maxhr: number | null; rhr: number | null; domisili: string | null
}
interface PaceZoneAdj {
  id: string; zone_key: string
  pct_override: number | null  // Lo offset detik
  notes: string | null; adjusted_at: string
}
interface TtHistoryRow {
  id: string; tt_date: string; vdot: number | null
  lthr_calculated: number | null; tt_type: string | null
  distance_km: number | null; finish_time_sec: number | null
}
interface WeatherCache {
  wbgt: number; temp: number; humidity: number; fetched_at: number
}
// Inline edit state per zona: { loSec, hiSec } sebagai string input
interface EditState {
  loInput: string; hiInput: string; saving: boolean; error: string
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PaceZonesPage() {
  const [athleteInfo, setAthleteInfo] = useState<AthleteInfo | null>(null)
  const [myRoles, setMyRoles]         = useState<string[]>([])
  const [adjustments, setAdjustments] = useState<PaceZoneAdj[]>([])
  const [ttHistory, setTtHistory]     = useState<TtHistoryRow[]>([])
  const [heatMode, setHeatMode]       = useState(false)
  const [weather, setWeather]         = useState<WeatherCache | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [weatherError, setWeatherError]     = useState('')
  const [loading, setLoading]         = useState(true)
  // Inline edit: key = zone_key
  const [editMap, setEditMap]         = useState<Record<string, EditState>>({})
  const [activeEdit, setActiveEdit]   = useState<string | null>(null)

  const cancelledRef = useRef(false)
  const myIdRef      = useRef<string | null>(null)

  const isCoachOrAdmin = myRoles.includes('coach') || myRoles.includes('admin')

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    cancelledRef.current = false
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return
      myIdRef.current = myId as string

      // Roles — dua query terpisah
      const { data: arData } = await supabase
        .from('athlete_roles').select('role_id').eq('athlete_id', myId as string)
      if (!cancelledRef.current && arData && (arData as any[]).length > 0) {
        const roleIds = (arData as any[]).map((r: any) => r.role_id)
        const { data: rData } = await supabase.from('roles').select('name').in('id', roleIds)
        if (!cancelledRef.current && rData) {
          setMyRoles((rData as any[]).map((r: any) => r.name).filter(Boolean))
        }
      }

      // Athlete settings
      const { data: settings } = await supabase
        .from('athlete_settings').select('max_hr, resting_hr, domisili')
        .eq('athlete_id', myId as string).single()

      // TT history
      const { data: latestTT } = await supabase
        .from('tt_history').select('id, tt_date, vdot, lthr_calculated, tt_type, distance_km, finish_time_sec')
        .eq('athlete_id', myId as string).order('tt_date', { ascending: false }).limit(10)

      if (!cancelledRef.current) {
        const rows = (latestTT ?? []) as any[]
        // VCR: dari TT terbaru yang punya distance_km dan finish_time_sec
        // VCR (m/s) = distance_m / finish_time_sec
        const latestWithData = rows.find(t => t.distance_km != null && t.finish_time_sec != null)
        const vcr = latestWithData
          ? Math.round((latestWithData.distance_km * 1000 / latestWithData.finish_time_sec) * 1000) / 1000
          : null
        // LTHR: dari TT manapun yang punya lthr_calculated
        const withLthr = rows.find(t => t.lthr_calculated != null)
        setAthleteInfo({
          id: myId as string,
          lthr: withLthr?.lthr_calculated ?? null,
          vcr,
          maxhr: (settings as any)?.max_hr ?? null,
          rhr: (settings as any)?.resting_hr ?? null,
          domisili: (settings as any)?.domisili ?? null,
        })
        setTtHistory(rows as TtHistoryRow[])
      }

      // Pace zone adjustments
      const { data: adjData } = await supabase
        .from('pace_zone_adjustments')
        .select('id, zone_key, pct_override, notes, adjusted_at')
        .eq('athlete_id', myId as string)
        .order('adjusted_at', { ascending: false })
      if (!cancelledRef.current && adjData) {
        setAdjustments(adjData as any[])
      }

    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => { cancelledRef.current = true }
  }, [loadData])

  // ── Weather ────────────────────────────────────────────────────────────────
  async function fetchWeather() {
    const domisili = athleteInfo?.domisili
    if (!domisili) {
      console.warn('[PaceIQ] Domisili belum diset di Profil — Heat Mode tidak dapat fetch cuaca')
      return
    }

    const cacheKey = `paceiq_weather_wbgt_${domisili.toLowerCase().replace(/\s+/g, '_')}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed: WeatherCache = JSON.parse(cached)
        if (Date.now() - parsed.fetched_at < 30 * 60 * 1000) {
          setWeather(parsed)
          return
        }
      } catch { localStorage.removeItem(cacheKey) }
    }

    setWeatherLoading(true)
    try {
      // Step 1: Geocode nama kota dari domisili via Open-Meteo Geocoding API
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(domisili)}&count=1&language=id&format=json`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!geoRes.ok) throw new Error(`Geocoding error: ${geoRes.status}`)
      const geoData = await geoRes.json()
      const loc = geoData.results?.[0]
      if (!loc) throw new Error(`Kota "${domisili}" tidak ditemukan`)

      const lat = loc.latitude
      const lon = loc.longitude
      const cityName = loc.name

      // Step 2: Fetch cuaca dari koordinat kota
      const wxRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&wind_speed_unit=ms&timezone=auto`,
        { signal: AbortSignal.timeout(8000) }
      )
      if (!wxRes.ok) throw new Error(`Weather error: ${wxRes.status}`)
      const wx = await wxRes.json()

      const temp = wx.current?.temperature_2m ?? 30
      const rh   = wx.current?.relative_humidity_2m ?? 70
      const ws   = wx.current?.wind_speed_10m ?? 2

      // WBGT Simplified (Liljegren approximation)
      const Tw = temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
             + Math.atan(temp + rh) - Math.atan(rh - 1.676331)
             + 0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) - 4.686035
      const wbgt = Math.round((0.7 * Tw + 0.2 * temp + 0.1 * (temp - ws * 0.5)) * 10) / 10

      const data: WeatherCache = { wbgt, temp, humidity: rh, fetched_at: Date.now() }
      localStorage.setItem(cacheKey, JSON.stringify(data))
      setWeather(data)
      console.info(`[PaceIQ] Weather fetched for ${cityName}: WBGT ${wbgt}°C, Temp ${temp}°C, RH ${rh}%`)
    } catch (err) {
      console.error('[PaceIQ] fetchWeather error:', err)
      setWeatherError(String(err))
    } finally {
      setWeatherLoading(false)
    }
  }

  useEffect(() => {
    if (heatMode && !weather && athleteInfo) fetchWeather()
    if (!heatMode) { setWeather(null); setWeatherError('') }
  }, [heatMode, athleteInfo])

  // ── Pace calculation ──────────────────────────────────────────────────────
  function calcZonePaces(vcr: number) {
    // VCR dalam m/s, pace = 1000 / (vcr * pct) detik/km
    return PACE_ZONES.map(z => ({
      loSec: vcrToPaceSec(vcr, z.pctVcrLo),
      hiSec: vcrToPaceSec(vcr, z.pctVcrHi)
    }))
  }

  function getAdj(zoneKey: string): PaceZoneAdj | null {
    return adjustments.find(a => a.zone_key === zoneKey) ?? null
  }

  // ── Inline edit handlers ──────────────────────────────────────────────────
  function startEdit(zoneKey: string, defaultLoSec: number, defaultHiSec: number) {
    const adj = getAdj(zoneKey)
    // Jika ada adj, tampilkan pace adjusted sebagai initial value
    const loSec = adj ? defaultLoSec + (adj.pct_override ?? 0) : defaultLoSec
    const hiSec = adj ? defaultHiSec + (adj.pct_override ?? 0) : defaultHiSec
    setEditMap(m => ({
      ...m,
      [zoneKey]: { loInput: fmtSec(loSec), hiInput: fmtSec(hiSec), saving: false, error: '' }
    }))
    setActiveEdit(zoneKey)
  }

  function cancelEdit() {
    setActiveEdit(null)
  }

  async function saveEdit(zoneKey: string, defaultLoSec: number, defaultHiSec: number) {
    const state = editMap[zoneKey]
    if (!state || !myIdRef.current) return

    const newLo = parsePaceInput(state.loInput)
    const newHi = parsePaceInput(state.hiInput)

    if (!newLo || !newHi) {
      setEditMap(m => ({ ...m, [zoneKey]: { ...m[zoneKey], error: 'Format pace tidak valid. Gunakan M:SS (contoh: 8:30)' } }))
      return
    }
    if (newLo <= newHi) {
      setEditMap(m => ({ ...m, [zoneKey]: { ...m[zoneKey], error: 'Pace Lo harus lebih lambat (angka lebih besar) dari Hi' } }))
      return
    }

    setEditMap(m => ({ ...m, [zoneKey]: { ...m[zoneKey], saving: true, error: '' } }))

    // Simpan offset sebagai rata-rata selisih Lo dan Hi dari default
    const loOffset = newLo - defaultLoSec
    const hiOffset = newHi - defaultHiSec
    const avgOffset = Math.round((loOffset + hiOffset) / 2)

    const existing = getAdj(zoneKey)
    try {
      if (existing) {
        await supabase.from('pace_zone_adjustments')
          .update({ pct_override: avgOffset, adjusted_at: new Date().toISOString(),
                    adjusted_by_athlete_id: myIdRef.current } as any)
          .eq('id', existing.id)
      } else {
        await supabase.from('pace_zone_adjustments')
          .insert({ athlete_id: myIdRef.current, zone_key: zoneKey,
                    pct_override: avgOffset, adjusted_by_athlete_id: myIdRef.current } as any)
      }
      await loadData()
      setActiveEdit(null)
    } catch {
      setEditMap(m => ({ ...m, [zoneKey]: { ...m[zoneKey], saving: false, error: 'Gagal menyimpan' } }))
    }
  }

  async function resetAdj(zoneKey: string) {
    const existing = getAdj(zoneKey)
    if (!existing) return
    await supabase.from('pace_zone_adjustments').delete().eq('id', existing.id)
    await loadData()
    setActiveEdit(null)
  }

  // ── HR zone helpers ────────────────────────────────────────────────────────
  function calcHrRange(z: HrZone, lthr: number): string {
    if (z.pctLo === 0) return `< ${Math.round(lthr * 0.85)} bpm`
    if (z.pctHi === 999) return `≥ ${Math.round(lthr * z.pctLo / 100)} bpm`
    return `${Math.round(lthr * z.pctLo / 100)}–${Math.round(lthr * z.pctHi / 100)} bpm`
  }
  function calcPctStr(z: HrZone): string {
    if (z.pctLo === 0) return '< 85% LTHR'
    if (z.pctHi === 999) return `> ${z.pctLo - 1}% LTHR`
    return `${z.pctLo}–${z.pctHi}% LTHR`
  }
  function currentZoneId(lthr: number, rhr: number): string {
    const estHR = Math.round(rhr * 1.15)
    for (const z of HR_ZONES) {
      const lo = z.pctLo === 0 ? 0 : Math.round(lthr * z.pctLo / 100)
      const hi = z.pctHi === 999 ? 9999 : Math.round(lthr * z.pctHi / 100)
      if (estHR >= lo && estHR <= hi) return z.id
    }
    return 'z1'
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = [...ttHistory].reverse().map(t => ({
    date: t.tt_date?.slice(0, 10) ?? '',
    vdot: t.vdot ? Math.round(t.vdot * 100) / 100 : null,
    lthr: t.lthr_calculated, label: t.tt_type ?? ''
  }))

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat data zona...</div>
  }

  const lthr      = athleteInfo?.lthr ?? null
  const vcr       = athleteInfo?.vcr ?? null
  const maxhr     = athleteInfo?.maxhr ?? (lthr ? Math.round(lthr / 0.88) : null)
  const rhr       = athleteInfo?.rhr ?? 55
  const zonePaces = vcr ? calcZonePaces(vcr) : null
  const wbgt      = weather?.wbgt ?? null
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
          {lthr && <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-indigo-200">❤️ LTHR: {lthr} bpm</span>}
          {maxhr && <span className="inline-flex items-center gap-1.5 bg-gray-50 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-full border border-gray-200">↑ MaxHR: {maxhr} bpm</span>}
          {vcr && <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-emerald-200">⚡ VCR: {vcr} m/s</span>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={() => setHeatMode(m => !m)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${heatMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400 hover:text-amber-600'}`}>
            🌡️ Heat Mode {heatMode ? 'ON' : 'OFF'}
            {heatMode && wbgt != null && <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${wbgtBadge?.cls}`}>WBGT {wbgt}°C — {athleteInfo?.domisili}</span>}
            {heatMode && weatherLoading && <span className="text-xs opacity-70">Mengambil cuaca {athleteInfo?.domisili}...</span>}
          </button>
          {heatMode && weatherError && (
            <span className="text-xs text-red-500">
              {weatherError.includes('tidak ditemukan')
                ? `Kota "${athleteInfo?.domisili}" tidak ditemukan. Update domisili di Profil.`
                : !athleteInfo?.domisili
                ? 'Set domisili di menu Profil untuk mengaktifkan Heat Mode.'
                : 'Gagal mengambil data cuaca. Cek koneksi internet.'}
            </span>
          )}
        </div>
      </div>

      {(!lthr || !vcr) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
          ⚠️ {!lthr && !vcr ? 'LTHR dan VCR belum tersedia.' : !lthr ? 'LTHR belum tersedia.' : 'VCR belum tersedia (perlu TT 30 menit).'}
          {' '}Tambahkan Time Trial 30 menit di menu <strong>Profil</strong> untuk mengaktifkan kalkulasi zona.
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 1 — HR ZONES                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
          HR Zones — Joe Friel 7-Zone (Running)
        </h2>
        {lthr ? (
          <>
            <div className="flex rounded-lg overflow-hidden h-8 mb-4">
              {HR_ZONES.map(z => (
                <div key={z.id} className="flex-1 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: z.color }}>
                  {z.id.toUpperCase()}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {HR_ZONES.map(z => {
                const isActive = currentZoneId(lthr, rhr) === z.id
                return (
                  <div key={z.id} className={`relative rounded-lg border-2 p-3 ${isActive ? 'shadow-md' : 'border-gray-200'}`}
                    style={{ borderColor: isActive ? z.color : undefined, backgroundColor: isActive ? z.color + '10' : '#fafafa' }}>
                    {isActive && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-white border text-xs font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap"
                        style={{ color: z.color, borderColor: z.color }}>📍 Zona Saat Ini</div>
                    )}
                    <div className="text-xs font-bold mb-1" style={{ color: z.color }}>{z.name}</div>
                    <div className="text-lg font-bold text-gray-800">{calcHrRange(z, lthr)}</div>
                    <div className="text-xs text-gray-400 mb-1">{calcPctStr(z)} · RPE {z.rpe}</div>
                    <div className="text-xs text-gray-500">{z.desc}</div>
                    <div className="text-xs text-gray-400 mt-1 italic">{z.app}</div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              * "Zona Saat Ini" diestimasi dari HRrest × 1.15 ({Math.round(rhr * 1.15)} bpm).
              Sumber: Joe Friel, <em>Quick Guide to Setting Zones</em> — TrainingPeaks.
              Z5 dibagi 3 sub-zona: 5a (100–102%), 5b (103–106%), 5c (&gt;106%) LTHR.
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
          <h2 className="font-gsans text-xl text-indigo-700 uppercase">Pace Chart — 9 Training Zones</h2>
          {vcr && <span className="text-xs text-gray-400">% VCR (Critical Race Velocity) · Anchor 100% = {fmtSec(vcrToPaceSec(vcr, 1.0))} min/km · VCR {vcr} m/s</span>}
        </div>

        {isCoachOrAdmin && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 mb-4 text-xs text-indigo-600 flex items-center gap-2">
            ✏️ Klik ikon pensil pada baris zona untuk melakukan adjustment pace manual. Pace default dihitung dari VCR athlete.
          </div>
        )}

        {vcr && lthr ? (
          <>
            {heatMode && wbgt != null && wbgt >= 28 && (
              <div className={`rounded-lg px-4 py-2 mb-4 text-sm font-medium flex items-center gap-2 ${wbgt >= 35 ? 'bg-red-100 text-red-700' : wbgt >= 32 ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                🌡️ WBGT {wbgt}°C — {wbgt >= 35 ? 'EXTREME: Tunda sesi kualitas.' : wbgt >= 32 ? 'HIGH RISK: Tambahkan 30–60 detik/km.' : 'CAUTION: Tambahkan 10–25 detik/km.'}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase w-6">No.</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Zona</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">% VCR</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">HR Range</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">RPE</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 uppercase">Pace (min/km)</th>
                    {heatMode && wbgt != null && (
                      <th className="text-center px-3 py-2 text-xs font-medium text-amber-600 uppercase">Heat Adj.</th>
                    )}
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Penggunaan</th>
                    {isCoachOrAdmin && <th className="w-8"></th>}
                  </tr>
                </thead>
                <tbody>
                  {PACE_ZONES.map((z, i) => {
                    const defaultPaces = zonePaces![i]
                    const adj         = getAdj(z.key)
                    const adjOffset   = adj?.pct_override ?? 0
                    const heatOff     = heatMode && wbgt != null ? heatPenalty(wbgt, i) : 0
                    const dispLoSec   = defaultPaces.loSec + adjOffset + heatOff
                    const dispHiSec   = defaultPaces.hiSec + adjOffset + heatOff
                    const hasAdj      = adjOffset !== 0
                    const hrLo = z.pctLthrLo === 0 ? null : Math.round(lthr * z.pctLthrLo / 100)
                    const hrHi = z.pctLthrHi === 999 ? null : Math.round(lthr * z.pctLthrHi / 100)
                    const hrStr = hrLo == null ? `< ${Math.round(lthr * 0.75)} bpm`
                      : hrHi == null ? `≥ ${hrLo} bpm` : `${hrLo}–${hrHi} bpm`

                    const isEditing = activeEdit === z.key
                    const editState = editMap[z.key]

                    // Preview saat edit
                    let previewText = ''
                    if (isEditing && editState) {
                      const newLo = parsePaceInput(editState.loInput)
                      const newHi = parsePaceInput(editState.hiInput)
                      if (newLo && newHi) {
                        const loOff = newLo - defaultPaces.loSec
                        const hiOff = newHi - defaultPaces.hiSec
                        const avgOff = Math.round((loOff + hiOff) / 2)
                        const pctOff = Math.round((avgOff / ((defaultPaces.loSec + defaultPaces.hiSec) / 2)) * 100)
                        const sign = avgOff >= 0 ? '+' : ''
                        previewText = `${sign}${avgOff}s avg · ${sign}${pctOff}% dari default VCR`
                      }
                    }

                    return (
                      <tr key={z.key} className={`border-b border-gray-100 transition-colors ${isEditing ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-3 py-3 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: z.color }} />
                            <div>
                              <div className="text-sm font-bold text-gray-800">{z.name}</div>
                              <div className="text-xs text-gray-400">{z.ref}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-xs font-medium text-gray-600">
                          {Math.round(z.pctVcrLo * 100)}–{Math.round(z.pctVcrHi * 100)}%
                        </td>
                        <td className="px-3 py-3 text-center text-xs text-gray-600">{hrStr}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: z.bgColor, color: z.color }}>{z.rpe}</span>
                        </td>

                        {/* ── Pace cell — normal atau edit mode ── */}
                        <td className="px-3 py-3 text-center min-w-[180px]">
                          {isEditing ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1 justify-center">
                                <input
                                  className="w-16 border border-indigo-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-500"
                                  value={editState.loInput}
                                  onChange={e => setEditMap(m => ({ ...m, [z.key]: { ...m[z.key], loInput: e.target.value, error: '' } }))}
                                  placeholder={fmtSec(defaultPaces.loSec)}
                                />
                                <span className="text-gray-400 text-xs">–</span>
                                <input
                                  className="w-16 border border-indigo-300 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-indigo-500"
                                  value={editState.hiInput}
                                  onChange={e => setEditMap(m => ({ ...m, [z.key]: { ...m[z.key], hiInput: e.target.value, error: '' } }))}
                                  placeholder={fmtSec(defaultPaces.hiSec)}
                                />
                              </div>
                              {previewText && (
                                <div className="text-xs text-indigo-500 font-medium">{previewText}</div>
                              )}
                              {editState.error && (
                                <div className="text-xs text-red-500">{editState.error}</div>
                              )}
                              <div className="text-xs text-gray-400">
                                Default VCR: {fmtPaceRange(defaultPaces.loSec, defaultPaces.hiSec)}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className={`font-bold text-sm ${hasAdj ? 'text-indigo-700' : 'text-gray-800'}`}>
                                {fmtPaceRange(dispLoSec, dispHiSec)}
                              </div>
                              {hasAdj && (
                                <div className="flex items-center justify-center gap-1 mt-0.5">
                                  <span className="text-xs bg-indigo-100 text-indigo-600 font-semibold px-1.5 py-0.5 rounded-full">adj</span>
                                  <span className="text-xs text-indigo-500">{adjOffset > 0 ? '+' : ''}{adjOffset}s</span>
                                </div>
                              )}
                              {heatOff > 0 && <div className="text-xs text-amber-500 font-medium mt-0.5">+{heatOff}s 🌡️</div>}
                            </div>
                          )}
                        </td>

                        {heatMode && wbgt != null && (
                          <td className="px-3 py-3 text-center text-xs text-amber-600 font-medium">
                            {heatOff > 0 ? `+${heatOff}s` : '—'}
                          </td>
                        )}
                        <td className="px-3 py-3 text-xs text-gray-500">{z.usage}</td>

                        {/* ── Edit / Save / Cancel / Reset buttons ── */}
                        {isCoachOrAdmin && (
                          <td className="px-2 py-3 text-right">
                            {isEditing ? (
                              <div className="flex flex-col gap-1 items-end">
                                <button
                                  onClick={() => saveEdit(z.key, defaultPaces.loSec, defaultPaces.hiSec)}
                                  disabled={editState.saving}
                                  className="text-xs bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 disabled:opacity-40 whitespace-nowrap"
                                >
                                  {editState.saving ? '...' : 'Simpan'}
                                </button>
                                {hasAdj && (
                                  <button onClick={() => resetAdj(z.key)}
                                    className="text-xs text-red-500 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50 whitespace-nowrap">
                                    Reset
                                  </button>
                                )}
                                <button onClick={cancelEdit}
                                  className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap">
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEdit(z.key, defaultPaces.loSec, defaultPaces.hiSec)}
                                className="text-gray-300 hover:text-indigo-500 transition-colors p-1 rounded"
                                title="Edit pace zona ini"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
                                </svg>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex rounded-lg overflow-hidden h-5 mt-4 gap-px">
              {PACE_ZONES.map(z => <div key={z.key} className="flex-1" style={{ backgroundColor: z.color }} title={z.name} />)}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>← Lambat (Recovery)</span><span>Cepat (Anaerob) →</span>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">VCR dan LTHR belum tersedia. Tambahkan Time Trial 30 menit di menu Profil.</p>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI 3 — PACE HISTORY CHART                                        */}
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
                <Tooltip formatter={(val: any) => [String(val), 'VDOT']} labelFormatter={(l: any) => `Tanggal: ${l}`} contentStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="vdot" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 4, fill: '#4f46e5' }} name="VDOT" connectNulls />
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
                    const v = (t.distance_km != null && t.finish_time_sec != null) ? Math.round((t.distance_km * 1000 / t.finish_time_sec) * 1000) / 1000 : null
                    const easySec  = v ? vcrToPaceSec(v, 0.75) : null
                    const tempoSec = v ? vcrToPaceSec(v, 0.89) : null
                    return (
                      <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-700">{t.tt_date?.slice(0, 10)}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{t.tt_type ?? '—'}</td>
                        <td className="px-3 py-2 text-center font-bold text-indigo-700">{t.vdot ?? '—'}</td>
                        <td className="px-3 py-2 text-center text-gray-600">{t.lthr_calculated ? `${t.lthr_calculated} bpm` : '—'}</td>
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
          <p className="text-sm text-gray-400">Belum ada riwayat Time Trial. Tambahkan TT di menu Profil.</p>
        )}
      </div>

    </div>
  )
}
