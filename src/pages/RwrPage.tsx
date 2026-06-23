import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface RaceActive {
  id: string
  name: string
  event_date: string | null
  distance_km: number | null
  target_finish: string | null
  status: string
}

interface ProgramWeekActive {
  week_number: number
  focus: string | null
  phase: string | null
  date_start: string | null
  date_end: string | null
  rwr_run_sec: number | null
  rwr_walk_sec: number | null
}

interface EwsLatest {
  composite_score: number | null
  fatigue: number | null
}

interface RefRow {
  id: string
  pace_label: string
  run_sec: number
  walk_sec: number
  aplikasi: string | null
  is_default: boolean | null
  sort_order: number | null
}

interface HistoryRow {
  id: string
  calc_date: string
  mode: string
  label: string | null
  distance_km: number | null
  run_sec: number | null
  walk_sec: number | null
  run_pace_sec: number | null
  walk_pace_sec: number | null
  blended_pace_sec: number | null
  proj_finish_sec: number | null
  target_finish_sec: number | null
  notes: string | null
}

interface Segment {
  id: number
  distKm: string
  runSec: string
  walkSec: string
  runPace: string
  walkPace: string
}

// ─────────────────────────────────────────────
// ALGORITHMS
// ─────────────────────────────────────────────

function parsePace(str: string): number | null {
  if (!str) return null
  const parts = str.trim().split(':')
  if (parts.length === 2) {
    const m = parseFloat(parts[0]), s = parseFloat(parts[1])
    if (isNaN(m) || isNaN(s)) return null
    return m * 60 + s
  }
  return null
}

function secToMMSS(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function secToMMSSd(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${m}:${parseFloat(s) < 10 ? '0' : ''}${s}`
}

function secToHMMSS(sec: number): string {
  sec = Math.round(sec)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Mode A: Rasio (detik) + Walk Pace + Target Waktu → Run Pace + Overall Pace
 * Formula: invRunPace = (1/overallPace - walkFrac/walkPace) / runFrac
 */
function calcModeA(
  runSec: number, walkSec: number,
  walkPaceSec: number, targetSec: number, distKm: number
): {
  runPaceSec: number; overallPaceSec: number; projFinishSec: number
  runMeter: number; walkMeter: number; runPct: number
  totalCycles: number; totalRunMin: number; totalWalkMin: number
} | { error: string } {
  if (!runSec || !walkSec || !walkPaceSec || !targetSec || !distKm)
    return { error: 'Lengkapi semua input.' }
  const overallPaceSec = targetSec / distKm
  const cycleSec = runSec + walkSec
  const runFrac = runSec / cycleSec
  const walkFrac = walkSec / cycleSec
  const invRunPace = (1 / overallPaceSec - walkFrac / walkPaceSec) / runFrac
  if (invRunPace <= 0)
    return { error: 'Kombinasi rasio & pace walk tidak bisa mencapai target. Coba percepat pace walk atau perbesar run interval.' }
  const runPaceSec = 1 / invRunPace
  if (runPaceSec >= walkPaceSec)
    return { error: 'Run pace lebih lambat dari walk pace. Periksa input.' }
  const runMeter = Math.round((runSec / runPaceSec) * 1000)
  const walkMeter = Math.round((walkSec / walkPaceSec) * 1000)
  const totalCycles = Math.ceil(distKm * 1000 / (runMeter + walkMeter))
  const totalRunMin = (targetSec / 60) * runFrac
  const totalWalkMin = (targetSec / 60) * walkFrac
  return {
    runPaceSec, overallPaceSec, projFinishSec: targetSec,
    runMeter, walkMeter, runPct: runFrac * 100,
    totalCycles, totalRunMin, totalWalkMin,
  }
}

/**
 * Mode B: Run Pace + Walk Pace + Rasio → Projected Finish (Galloway Harmonic Mean)
 * distPerCycle = runSec/runPaceSec + walkSec/walkPaceSec (dalam km)
 * projFinish = (dist / distPerCycle) × cycleSec
 */
function calcModeB(
  runPaceSec: number, walkPaceSec: number,
  runSec: number, walkSec: number, distKm: number
): {
  blendedPaceSec: number; projFinishSec: number
  runMeter: number; walkMeter: number; runPct: number
  totalCycles: number; totalRunMin: number; totalWalkMin: number
} | { error: string } {
  if (!runPaceSec || !walkPaceSec || !runSec || !walkSec || !distKm)
    return { error: 'Lengkapi semua input.' }
  if (runPaceSec >= walkPaceSec)
    return { error: 'Pace Run harus lebih cepat dari pace Walk.' }
  const distPerCycle = runSec / runPaceSec + walkSec / walkPaceSec // km
  const cycleSec = runSec + walkSec
  const projFinishSec = (distKm / distPerCycle) * cycleSec
  const blendedPaceSec = projFinishSec / distKm
  const runFrac = runSec / cycleSec
  const walkFrac = walkSec / cycleSec
  const runMeter = Math.round((runSec / runPaceSec) * 1000)
  const walkMeter = Math.round((walkSec / walkPaceSec) * 1000)
  const totalCycles = Math.round(distKm / distPerCycle)
  const totalRunMin = (projFinishSec / 60) * runFrac
  const totalWalkMin = (projFinishSec / 60) * walkFrac
  return {
    blendedPaceSec, projFinishSec,
    runMeter, walkMeter, runPct: runFrac * 100,
    totalCycles, totalRunMin, totalWalkMin,
  }
}

/**
 * Mode C: Multi-segment — hitung per segmen lalu gabungkan
 */
function calcModeC(segments: Segment[]): {
  totalFinishSec: number; overallPaceSec: number
  segResults: { distKm: number; finishSec: number; blendedPaceSec: number }[]
} | { error: string } {
  const results: { distKm: number; finishSec: number; blendedPaceSec: number }[] = []
  for (const seg of segments) {
    const dist = parseFloat(seg.distKm)
    const runS = parseFloat(seg.runSec)
    const walkS = parseFloat(seg.walkSec)
    const runP = parsePace(seg.runPace)
    const walkP = parsePace(seg.walkPace)
    if (!dist || !runS || !walkS || !runP || !walkP)
      return { error: `Segmen ${seg.id}: lengkapi semua field.` }
    if (runP >= walkP)
      return { error: `Segmen ${seg.id}: run pace harus lebih cepat dari walk pace.` }
    const r = calcModeB(runP, walkP, runS, walkS, dist)
    if ('error' in r) return { error: `Segmen ${seg.id}: ${r.error}` }
    results.push({ distKm: dist, finishSec: r.projFinishSec, blendedPaceSec: r.blendedPaceSec })
  }
  const totalDist = results.reduce((a, r) => a + r.distKm, 0)
  const totalFinishSec = results.reduce((a, r) => a + r.finishSec, 0)
  return { totalFinishSec, overallPaceSec: totalFinishSec / totalDist, segResults: results }
}

// ─────────────────────────────────────────────
// DEFAULT REF ROWS (Galloway 2015)
// ─────────────────────────────────────────────
const DEFAULT_REF_ROWS: Omit<RefRow, 'id'>[] = [
  { pace_label: '6:00/km', run_sec: 90, walk_sec: 30, aplikasi: 'Race Pace kompetitif', is_default: false, sort_order: 0 },
  { pace_label: '6:30/km', run_sec: 75, walk_sec: 30, aplikasi: 'Sub-LT, Race Pace W10+', is_default: false, sort_order: 1 },
  { pace_label: '7:00/km', run_sec: 60, walk_sec: 30, aplikasi: 'DEFAULT Base-Build', is_default: true, sort_order: 2 },
  { pace_label: '7:30/km', run_sec: 60, walk_sec: 30, aplikasi: 'Easy run W1–W3', is_default: false, sort_order: 3 },
  { pace_label: '8:00/km', run_sec: 30, walk_sec: 30, aplikasi: 'Recovery sangat ringan', is_default: false, sort_order: 4 },
]

// ─────────────────────────────────────────────
// WBGT Helper
// ─────────────────────────────────────────────
function calcWBGT(temp: number, rh: number): number {
  const e = (rh / 100) * 6.105 * Math.exp(17.27 * temp / (237.3 + temp))
  return parseFloat((0.567 * temp + 0.393 * e + 3.94).toFixed(1))
}

function heatRatioAdj(wbgt: number): { adj: number; msg: string; color: string } {
  if (wbgt >= 32) return { adj: -2, msg: `WBGT ${wbgt}°C — Ekstrem. Kurangi ratio 2 level.`, color: '#dc2626' }
  if (wbgt >= 28) return { adj: -1, msg: `WBGT ${wbgt}°C — Panas. Kurangi ratio 1 level.`, color: '#f97316' }
  if (wbgt >= 23) return { adj: -1, msg: `WBGT ${wbgt}°C — Moderat. Pertimbangkan kurangi 1 level.`, color: '#f59e0b' }
  return { adj: 0, msg: `WBGT ${wbgt}°C — Kondisi baik. Ratio tidak perlu disesuaikan.`, color: '#10b981' }
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────
export default function RwrPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  // DB state
  const [raceActive, setRaceActive]     = useState<RaceActive | null>(null)
  const [currentWeek, setCurrentWeek]   = useState<ProgramWeekActive | null>(null)
  const [ewsLatest, setEwsLatest]       = useState<EwsLatest | null>(null)
  const [refRows, setRefRows]           = useState<RefRow[]>([])
  const [history, setHistory]           = useState<HistoryRow[]>([])
  const [rwrNote, setRwrNote]           = useState('')
  const [canEdit, setCanEdit]           = useState(false)
  const [loading, setLoading]           = useState(true)
  const [toast, setToast]               = useState('')
  const myIdRef                         = useRef<string | null>(null)

  // Tab
  const [activeTab, setActiveTab] = useState<'modeA' | 'modeB' | 'modeC' | 'fatigue' | 'ref' | 'history'>('modeA')

  // Mode A state
  const [mA, setMA] = useState({ runSec: '60', walkSec: '30', walkPace: '8:00', targetTime: '', dist: '21.1' })
  const [mARes, setMARes] = useState<ReturnType<typeof calcModeA> | null>(null)
  const [mAHeat, setMAHeat] = useState(false)
  const [mAWx, setMAWx] = useState<{ wbgt: number; adj: number; msg: string; color: string } | null>(null)
  const [mALabel, setMALabel] = useState('Latihan')
  const [mASaving, setMASaving] = useState(false)

  // Mode B state
  const [mB, setMB] = useState({ runPace: '', walkPace: '8:00', runSec: '60', walkSec: '30', dist: '21.1', targetTime: '' })
  const [mBRes, setMBRes] = useState<ReturnType<typeof calcModeB> | null>(null)
  const [mBHeat, setMBHeat] = useState(false)
  const [mBWx, setMBWx] = useState<{ wbgt: number; adj: number; msg: string; color: string } | null>(null)
  const [mBLabel, setMBLabel] = useState('Latihan')
  const [mBSaving, setMBSaving] = useState(false)

  // Mode C state
  const [segments, setSegments] = useState<Segment[]>([
    { id: 1, distKm: '10', runSec: '60', walkSec: '30', runPace: '', walkPace: '8:00' },
    { id: 2, distKm: '11.1', runSec: '75', walkSec: '30', runPace: '', walkPace: '8:00' },
  ])
  const [mCRes, setMCRes] = useState<ReturnType<typeof calcModeC> | null>(null)
  const [mCLabel, setMCLabel] = useState('Race')
  const [mCSaving, setMCSaving] = useState(false)

  // Fatigue adjuster
  const [faEWS, setFaEWS]     = useState('')
  const [faRPE, setFaRPE]     = useState('')
  const [faBase, setFaBase]   = useState('')

  // Ref editor
  const [editRefId, setEditRefId]   = useState<string | null>(null)
  const [editRefForm, setEditRefForm] = useState<Partial<RefRow>>({})
  const [refSaving, setRefSaving]   = useState(false)

  // Notes
  const [editNote, setEditNote]   = useState(false)
  const [noteContent, setNoteContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!athleteId) return
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId) return
      myIdRef.current = myId as string

      const { data: isCoach } = await supabase.rpc('has_role', { role_name: 'coach' })
      const { data: isAdmin } = await supabase.rpc('has_role', { role_name: 'admin' })
      setCanEdit(!!(isCoach || isAdmin))

      // Race A aktif terdekat
      const { data: races } = await supabase.from('races')
        .select('id, name, event_date, distance_km, target_finish, status')
        .eq('athlete_id', athleteId).eq('status', 'A')
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date', { ascending: true }).limit(1)
      if (races && races.length > 0) {
        const r = races[0] as RaceActive
        setRaceActive(r)
        // Pre-fill dist dari race
        if (r.distance_km) {
          setMA(p => ({ ...p, dist: r.distance_km!.toString() }))
          setMB(p => ({ ...p, dist: r.distance_km!.toString() }))
        }
        // Pre-fill target dari race
        if (r.target_finish) {
          setMA(p => ({ ...p, targetTime: r.target_finish! }))
          setMB(p => ({ ...p, targetTime: r.target_finish! }))
        }
      }

      // Program week aktif saat ini
      const today = new Date().toISOString().split('T')[0]
      const { data: weeks } = await supabase.from('program_weeks')
        .select('week_number, focus, phase, date_start, date_end')
        .eq('athlete_id', athleteId)
        .lte('date_start', today).gte('date_end', today).limit(1)
      if (weeks && weeks.length > 0) {
        // Ambil rwr dari program_sessions minggu ini
        const w = weeks[0]
        const { data: sessions } = await supabase.from('program_sessions')
          .select('rwr_run_sec, rwr_walk_sec')
          .eq('athlete_id', athleteId)
          .not('rwr_run_sec', 'is', null).limit(1)
        setCurrentWeek({
          ...w,
          rwr_run_sec: (sessions?.[0]?.rwr_run_sec) ?? null,
          rwr_walk_sec: (sessions?.[0]?.rwr_walk_sec) ?? null,
        } as ProgramWeekActive)
      }

      // EWS terbaru
      const { data: ews } = await supabase.from('ews_entries')
        .select('composite_score, fatigue')
        .eq('athlete_id', athleteId)
        .order('entry_date', { ascending: false }).limit(1)
      if (ews && ews.length > 0) {
        setEwsLatest({ composite_score: ews[0].composite_score, fatigue: ews[0].fatigue })
        setFaEWS(ews[0].composite_score?.toString() ?? '')
      }

      // Ref rows
      const { data: refs } = await (supabase as any).from('rwr_ref_rows')
        .select('*').eq('athlete_id', athleteId).order('sort_order', { ascending: true })
      setRefRows((refs ?? []) as RefRow[])
      if (refs && refs.length > 0) {
        const def = refs.find((r: RefRow) => r.is_default)
        if (def) setFaBase(`${def.run_sec}:${def.walk_sec}`)
      }

      // History
      const { data: hist } = await (supabase as any).from('rwr_history')
        .select('*').eq('athlete_id', athleteId)
        .order('created_at', { ascending: false }).limit(50)
      setHistory((hist ?? []) as HistoryRow[])

      // Notes
      const { data: note } = await (supabase as any).from('rwr_notes')
        .select('content').eq('athlete_id', athleteId).single()
      if (note?.content) setRwrNote(note.content)

    } finally { setLoading(false) }
  }, [athleteId])

  useEffect(() => { loadAll() }, [loadAll])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  // ── Heat Mode fetch ───────────────────────────────────────────────────────
  async function fetchHeat(mode: 'A' | 'B') {
    const { data: as_ } = await supabase.from('athlete_settings')
      .select('domisili').eq('athlete_id', athleteId!).single()
    if (!as_?.domisili) { showToast('Isi domisili di Profil terlebih dahulu.'); return }
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(as_.domisili)}&count=1&format=json`)
      const geo = await geoRes.json()
      if (!geo.results?.length) { showToast('Kota tidak ditemukan.'); return }
      const { latitude, longitude } = geo.results[0]
      const wxRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`)
      const wx = await wxRes.json()
      const temp = wx.current.temperature_2m
      const rh = wx.current.relative_humidity_2m
      const wbgt = calcWBGT(temp, rh)
      const adj = heatRatioAdj(wbgt)
      if (mode === 'A') setMAWx({ wbgt, ...adj })
      else setMBWx({ wbgt, ...adj })
    } catch { showToast('Gagal mengambil data cuaca.') }
  }

  useEffect(() => { if (mAHeat) fetchHeat('A'); else setMAWx(null) }, [mAHeat])
  useEffect(() => { if (mBHeat) fetchHeat('B'); else setMBWx(null) }, [mBHeat])

  // ── Save history ──────────────────────────────────────────────────────────
  async function saveHistory(payload: Omit<HistoryRow, 'id' | 'calc_date'>) {
    if (!myIdRef.current) return
    await (supabase as any).from('rwr_history').insert({ ...payload, athlete_id: myIdRef.current })
    await loadAll()
    showToast('Kalkulasi disimpan ke riwayat.')
  }

  // ── Ref row CRUD ──────────────────────────────────────────────────────────
  async function initDefaultRef() {
    if (!myIdRef.current) return
    await (supabase as any).from('rwr_ref_rows').insert(
      DEFAULT_REF_ROWS.map((r, i) => ({ ...r, athlete_id: myIdRef.current!, sort_order: i }))
    )
    await loadAll()
    showToast('Tabel referensi diinisialisasi dari default Galloway.')
  }

  async function saveRefRow() {
    if (!myIdRef.current || !editRefForm.pace_label) return
    setRefSaving(true)
    if (editRefId === 'new') {
      const maxOrder = Math.max(0, ...refRows.map(r => r.sort_order ?? 0))
      await (supabase as any).from('rwr_ref_rows').insert({
        athlete_id: myIdRef.current,
        pace_label: editRefForm.pace_label,
        run_sec: editRefForm.run_sec ?? 60,
        walk_sec: editRefForm.walk_sec ?? 30,
        aplikasi: editRefForm.aplikasi ?? null,
        is_default: false,
        sort_order: maxOrder + 1,
      })
    } else if (editRefId) {
      await (supabase as any).from('rwr_ref_rows').update({
        pace_label: editRefForm.pace_label,
        run_sec: editRefForm.run_sec,
        walk_sec: editRefForm.walk_sec,
        aplikasi: editRefForm.aplikasi,
      }).eq('id', editRefId)
    }
    setRefSaving(false); setEditRefId(null)
    await loadAll(); showToast('Baris disimpan.')
  }

  async function deleteRefRow(id: string) {
    if (!confirm('Hapus baris ini?')) return
    await (supabase as any).from('rwr_ref_rows').delete().eq('id', id)
    await loadAll(); showToast('Baris dihapus.')
  }

  async function toggleDefault(id: string) {
    await (supabase as any).from('rwr_ref_rows').update({ is_default: false }).eq('athlete_id', myIdRef.current!)
    await (supabase as any).from('rwr_ref_rows').update({ is_default: true }).eq('id', id)
    await loadAll()
  }

  async function resetRef() {
    if (!confirm('Reset ke default Galloway? Semua baris kustom akan hilang.')) return
    if (!myIdRef.current) return
    await (supabase as any).from('rwr_ref_rows').delete().eq('athlete_id', myIdRef.current)
    await initDefaultRef()
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  async function saveNote() {
    if (!myIdRef.current) return
    setNoteSaving(true)
    const existing = rwrNote
    if (existing) {
      await (supabase as any).from('rwr_notes').update({ content: noteContent, updated_at: new Date().toISOString() })
        .eq('athlete_id', myIdRef.current)
    } else {
      await (supabase as any).from('rwr_notes').insert({ athlete_id: myIdRef.current, content: noteContent })
    }
    setNoteSaving(false); setEditNote(false)
    setRwrNote(noteContent); showToast('Catatan disimpan.')
  }

  // ── Fatigue Adjuster ──────────────────────────────────────────────────────
  function calcFatigue() {
    const ewsScore = parseFloat(faEWS)
    const rpe = parseFloat(faRPE)
    const displayRows = refRows.length > 0 ? refRows : DEFAULT_REF_ROWS.map((r, i) => ({ ...r, id: `d${i}` }))
    const baseIdx = displayRows.findIndex(r => `${r.run_sec}:${r.walk_sec}` === faBase)
    if (baseIdx < 0 || (isNaN(ewsScore) && isNaN(rpe))) return null

    let adj = 0
    const reasons: string[] = []
    if (!isNaN(ewsScore)) {
      if (ewsScore >= 45) { adj -= 1; reasons.push(`EWS ${ewsScore.toFixed(0)} — kelelahan tinggi`) }
      else if (ewsScore <= 15) { adj += 1; reasons.push(`EWS ${ewsScore.toFixed(0)} — kondisi prima`) }
      else reasons.push(`EWS ${ewsScore.toFixed(0)} — kondisi normal`)
    }
    if (!isNaN(rpe)) {
      if (rpe >= 8) { adj -= 1; reasons.push(`RPE kemarin ${rpe} — butuh lebih banyak recovery`) }
      else if (rpe <= 4) { adj += 1; reasons.push(`RPE kemarin ${rpe} — fresh`) }
    }
    adj = Math.max(-2, Math.min(1, adj))
    const recIdx = Math.max(0, Math.min(displayRows.length - 1, baseIdx + adj))
    const rec = displayRows[recIdx]
    const msg = adj < 0 ? 'Turunkan ratio — tubuh perlu lebih banyak walk break'
      : adj > 0 ? 'Naikkan ratio — kondisi prima, bisa push sedikit'
      : 'Pertahankan ratio — kondisi seimbang'
    const color = adj < 0 ? '#d97706' : adj > 0 ? '#059669' : '#4f46e5'
    return { rec, adj, msg, reasons, color }
  }

  const faResult = calcFatigue()
  const displayRefRows = refRows.length > 0 ? refRows : DEFAULT_REF_ROWS.map((r, i) => ({ ...r, id: `d${i}` }))

  // ── Styles ────────────────────────────────────────────────────────────────
  const sectionCls = 'bg-white rounded-xl shadow-sm p-5'
  const headerCls  = 'font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4'
  const labelCls   = 'block text-xs font-medium text-gray-500 uppercase mb-1'
  const valueCls   = 'text-sm font-bold text-gray-800'
  const inputCls   = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300'
  const cardCls    = 'bg-gray-50 rounded-lg p-3'

  if (loading) return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      <p className="text-gray-400 text-sm">Memuat RWR Calculator...</p>
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg">{toast}</div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="font-gsans text-2xl text-gray-900">RWR Calculator</h1>
        <p className="text-sm text-gray-500 mt-1">Run-Walk-Run pace & projected finish (Galloway)</p>
      </div>

      {/* ── Race-Aware Context Panel ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Race A */}
        <div className={`${sectionCls} border-l-4 border-indigo-500`}>
          <p className="text-xs font-medium text-indigo-600 uppercase mb-2">Race A Aktif</p>
          {raceActive ? (
            <div className="flex flex-wrap gap-4">
              <div>
                <p className={labelCls}>Nama Race</p>
                <p className={valueCls}>{raceActive.name}</p>
              </div>
              <div>
                <p className={labelCls}>Tanggal</p>
                <p className={valueCls}>
                  {raceActive.event_date
                    ? new Date(raceActive.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </p>
              </div>
              <div>
                <p className={labelCls}>Jarak</p>
                <p className={valueCls}>{raceActive.distance_km ? `${raceActive.distance_km} km` : '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Target Finish</p>
                <p className="text-sm font-bold text-indigo-700">{raceActive.target_finish ?? '—'}</p>
              </div>
              {raceActive.event_date && (
                <div>
                  <p className={labelCls}>Sisa Hari</p>
                  <p className="text-sm font-bold text-amber-600">
                    {Math.ceil((new Date(raceActive.event_date).getTime() - new Date().getTime()) / 86400000)} hari
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Tidak ada Race A aktif. Daftarkan race di menu Races.</p>
          )}
        </div>

        {/* Program Week + EWS */}
        <div className={`${sectionCls} border-l-4 border-emerald-400`}>
          <p className="text-xs font-medium text-emerald-600 uppercase mb-2">Program Minggu Ini</p>
          {currentWeek ? (
            <div className="flex flex-wrap gap-4">
              <div>
                <p className={labelCls}>Minggu</p>
                <p className={valueCls}>W{currentWeek.week_number} — {currentWeek.phase ?? '—'}</p>
              </div>
              <div>
                <p className={labelCls}>Fokus</p>
                <p className={valueCls}>{currentWeek.focus ?? '—'}</p>
              </div>
              {currentWeek.rwr_run_sec && currentWeek.rwr_walk_sec && (
                <div>
                  <p className={labelCls}>RWR Minggu Ini</p>
                  <p className="text-sm font-bold text-emerald-700">{currentWeek.rwr_run_sec}:{currentWeek.rwr_walk_sec} det</p>
                </div>
              )}
              {ewsLatest?.composite_score !== null && ewsLatest?.composite_score !== undefined && (
                <div>
                  <p className={labelCls}>EWS Score</p>
                  <p className={`text-sm font-bold ${(ewsLatest.composite_score ?? 0) >= 45 ? 'text-red-500' : (ewsLatest.composite_score ?? 0) <= 15 ? 'text-green-600' : 'text-amber-600'}`}>
                    {ewsLatest.composite_score}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Tidak ada program aktif minggu ini.</p>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'modeA', label: 'Mode A — Rasio → Pace' },
          { key: 'modeB', label: 'Mode B — Pace → Finish' },
          { key: 'modeC', label: 'Mode C — Multi-Segment' },
          { key: 'fatigue', label: 'Fatigue Adjuster' },
          { key: 'ref', label: 'Referensi' },
          { key: 'history', label: 'Riwayat' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════ MODE A ══════════════ */}
      {activeTab === 'modeA' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Mode A — Input Rasio → Output Run Pace & Finish</h2>
          <p className="text-xs text-gray-400 mb-4">
            Input: rasio RWR + walk pace + target waktu → Kalkulasi: run pace yang dibutuhkan untuk mencapai target.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div>
              <label className={labelCls}>Run Interval (detik)</label>
              <input type="number" value={mA.runSec} onChange={e => setMA(p => ({ ...p, runSec: e.target.value }))} className={inputCls} placeholder="60" />
            </div>
            <div>
              <label className={labelCls}>Walk Interval (detik)</label>
              <input type="number" value={mA.walkSec} onChange={e => setMA(p => ({ ...p, walkSec: e.target.value }))} className={inputCls} placeholder="30" />
            </div>
            <div>
              <label className={labelCls}>Walk Pace (/km)</label>
              <input type="text" value={mA.walkPace} onChange={e => setMA(p => ({ ...p, walkPace: e.target.value }))} className={inputCls} placeholder="8:00" />
            </div>
            <div>
              <label className={labelCls}>Target Waktu (H:MM:SS)</label>
              <input type="text" value={mA.targetTime} onChange={e => setMA(p => ({ ...p, targetTime: e.target.value }))} className={inputCls} placeholder="2:15:00" />
            </div>
            <div>
              <label className={labelCls}>Jarak (km)</label>
              <input type="number" step="0.1" value={mA.dist} onChange={e => setMA(p => ({ ...p, dist: e.target.value }))} className={inputCls} placeholder="21.1" />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={mAHeat} onChange={e => setMAHeat(e.target.checked)} className="rounded" />
                Heat Mode
              </label>
            </div>
          </div>

          {mAWx && (
            <div className="mb-4 p-3 rounded-lg text-xs font-medium" style={{ background: mAWx.color + '15', color: mAWx.color, border: `1px solid ${mAWx.color}30` }}>
              🌡 {mAWx.msg}
              {mAWx.adj < 0 && refRows.length > 0 && (
                <span className="ml-2">→ Pertimbangkan turun ke ratio lebih konservatif.</span>
              )}
            </div>
          )}

          <button
            onClick={() => {
              const walkP = parsePace(mA.walkPace)
              const targetS = parsePace(mA.targetTime) ?? ((() => {
                const p = mA.targetTime.split(':').map(Number)
                return p.length === 3 ? p[0]*3600 + p[1]*60 + p[2] : null
              })())
              if (!walkP || !targetS) { showToast('Format pace atau waktu tidak valid.'); return }
              const res = calcModeA(parseFloat(mA.runSec), parseFloat(mA.walkSec), walkP, targetS, parseFloat(mA.dist))
              setMARes(res)
            }}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors mb-5">
            Hitung
          </button>

          {mARes && !('error' in mARes) && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className={labelCls}>Run Pace yang Dibutuhkan</p>
                  <p className="text-2xl font-bold text-indigo-700">{secToMMSSd(mARes.runPaceSec)}<span className="text-sm font-normal">/km</span></p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Overall Pace</p>
                  <p className="text-xl font-bold text-gray-800">{secToMMSS(mARes.overallPaceSec)}<span className="text-sm font-normal">/km</span></p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Proj. Finish</p>
                  <p className="text-xl font-bold text-gray-800">{secToHMMSS(mARes.projFinishSec)}</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Cycles</p>
                  <p className={valueCls}>{mARes.totalCycles}×</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Rasio (meter)</p>
                  <p className={valueCls}>{mARes.runMeter}:{mARes.walkMeter} m</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Lari</p>
                  <p className={valueCls}>{secToHMMSS(mARes.totalRunMin * 60)}</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Jalan</p>
                  <p className={valueCls}>{secToHMMSS(mARes.totalWalkMin * 60)}</p>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Run {mARes.runPct.toFixed(1)}%</span>
                  <span>Walk {(100 - mARes.runPct).toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${mARes.runPct}%` }} />
                </div>
              </div>
              {mARes.runPaceSec < 300 && (
                <div className="p-3 bg-red-50 rounded-lg text-xs text-red-700 mb-3">⚠ Pace run sangat cepat (&lt;5:00/km). Pertimbangkan memperbesar interval atau percepat walk pace.</div>
              )}
              {mARes.runPaceSec > 600 && (
                <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-700 mb-3">💡 Pace run relatif lambat (&gt;10:00/km). Cocok untuk recovery atau LR awal program.</div>
              )}
              <div className="flex items-center gap-3">
                <select value={mALabel} onChange={e => setMALabel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option>Latihan</option><option>Race</option><option>Time Trial</option>
                </select>
                <button onClick={async () => {
                  setMASaving(true)
                  if (!('error' in mARes)) {
                    const wp = parsePace(mA.walkPace)
                    const ts = parsePace(mA.targetTime) ?? ((() => { const p = mA.targetTime.split(':').map(Number); return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : null })())
                    await saveHistory({
                      mode: 'A', label: mALabel,
                      distance_km: parseFloat(mA.dist),
                      run_sec: parseFloat(mA.runSec), walk_sec: parseFloat(mA.walkSec),
                      run_pace_sec: mARes.runPaceSec, walk_pace_sec: wp,
                      blended_pace_sec: mARes.overallPaceSec,
                      proj_finish_sec: Math.round(mARes.projFinishSec),
                      target_finish_sec: ts, notes: null,
                    })
                  }
                  setMASaving(false)
                }} disabled={mASaving}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  {mASaving ? 'Menyimpan...' : '💾 Simpan ke Riwayat'}
                </button>
              </div>
            </>
          )}
          {mARes && 'error' in mARes && (
            <div className="p-3 bg-red-50 rounded-lg text-sm text-red-600">{mARes.error}</div>
          )}
        </div>
      )}

      {/* ══════════════ MODE B ══════════════ */}
      {activeTab === 'modeB' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Mode B — Input Pace + Rasio → Projected Finish</h2>
          <p className="text-xs text-gray-400 mb-4">
            Formula Galloway harmonic mean: distPerCycle = runSec/runPace + walkSec/walkPace (km).
            Target waktu bersifat benchmark — bukan constraint.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div>
              <label className={labelCls}>Run Pace (/km)</label>
              <input type="text" value={mB.runPace} onChange={e => setMB(p => ({ ...p, runPace: e.target.value }))} className={inputCls} placeholder="6:00" />
            </div>
            <div>
              <label className={labelCls}>Walk Pace (/km)</label>
              <input type="text" value={mB.walkPace} onChange={e => setMB(p => ({ ...p, walkPace: e.target.value }))} className={inputCls} placeholder="8:00" />
            </div>
            <div>
              <label className={labelCls}>Run Interval (detik)</label>
              <input type="number" value={mB.runSec} onChange={e => setMB(p => ({ ...p, runSec: e.target.value }))} className={inputCls} placeholder="60" />
            </div>
            <div>
              <label className={labelCls}>Walk Interval (detik)</label>
              <input type="number" value={mB.walkSec} onChange={e => setMB(p => ({ ...p, walkSec: e.target.value }))} className={inputCls} placeholder="30" />
            </div>
            <div>
              <label className={labelCls}>Jarak (km)</label>
              <input type="number" step="0.1" value={mB.dist} onChange={e => setMB(p => ({ ...p, dist: e.target.value }))} className={inputCls} placeholder="21.1" />
            </div>
            <div>
              <label className={labelCls}>Target Waktu (benchmark)</label>
              <input type="text" value={mB.targetTime} onChange={e => setMB(p => ({ ...p, targetTime: e.target.value }))} className={inputCls} placeholder="2:15:00" />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input type="checkbox" checked={mBHeat} onChange={e => setMBHeat(e.target.checked)} className="rounded" />
                Heat Mode
              </label>
            </div>
          </div>

          {mBWx && (
            <div className="mb-4 p-3 rounded-lg text-xs font-medium" style={{ background: mBWx.color + '15', color: mBWx.color, border: `1px solid ${mBWx.color}30` }}>
              🌡 {mBWx.msg}
            </div>
          )}

          <button
            onClick={() => {
              const runP = parsePace(mB.runPace)
              const walkP = parsePace(mB.walkPace)
              if (!runP || !walkP) { showToast('Format pace tidak valid. Gunakan M:SS'); return }
              const res = calcModeB(runP, walkP, parseFloat(mB.runSec), parseFloat(mB.walkSec), parseFloat(mB.dist))
              setMBRes(res)
            }}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors mb-5">
            Hitung
          </button>

          {mBRes && !('error' in mBRes) && (
            <>
              {/* vs Target */}
              {(() => {
                const ts = mB.targetTime ? (() => { const p = mB.targetTime.split(':').map(Number); return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1] })() : null
                const diff = ts ? mBRes.projFinishSec - ts : null
                return diff !== null ? (
                  <div className={`mb-4 p-3 rounded-lg text-sm font-medium ${diff <= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                    {diff <= 0
                      ? `✓ Proyeksi ${secToHMMSS(Math.abs(diff))} lebih cepat dari target — ada ruang untuk strategi konservatif.`
                      : `⚠ Proyeksi ${secToHMMSS(diff)} lebih lambat dari target — percepat run pace atau perbesar run interval.`}
                  </div>
                ) : null
              })()}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className={labelCls}>Projected Finish</p>
                  <p className="text-2xl font-bold text-indigo-700">{secToHMMSS(mBRes.projFinishSec)}</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Blended Pace</p>
                  <p className="text-xl font-bold text-gray-800">{secToMMSS(mBRes.blendedPaceSec)}<span className="text-sm font-normal">/km</span></p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Rasio (meter)</p>
                  <p className={valueCls}>{mBRes.runMeter}:{mBRes.walkMeter} m</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Cycles</p>
                  <p className={valueCls}>{mBRes.totalCycles}×</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Lari</p>
                  <p className={valueCls}>{secToHMMSS(mBRes.totalRunMin * 60)}</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Jalan</p>
                  <p className={valueCls}>{secToHMMSS(mBRes.totalWalkMin * 60)}</p>
                </div>
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Run {mBRes.runPct.toFixed(1)}%</span>
                  <span>Walk {(100 - mBRes.runPct).toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${mBRes.runPct}%` }} />
                </div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700 mb-4">
                💡 Tip: Gunakan nilai pace presisi ({secToMMSSd(parsePace(mB.runPace) ?? 0)}) saat input ke Mode A untuk konsistensi.
              </div>
              <div className="flex items-center gap-3">
                <select value={mBLabel} onChange={e => setMBLabel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option>Latihan</option><option>Race</option><option>Time Trial</option>
                </select>
                <button onClick={async () => {
                  setMBSaving(true)
                  if (!('error' in mBRes)) {
                    const rp = parsePace(mB.runPace), wp = parsePace(mB.walkPace)
                    const ts = mB.targetTime ? (() => { const p = mB.targetTime.split(':').map(Number); return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1] })() : null
                    await saveHistory({
                      mode: 'B', label: mBLabel,
                      distance_km: parseFloat(mB.dist),
                      run_sec: parseFloat(mB.runSec), walk_sec: parseFloat(mB.walkSec),
                      run_pace_sec: rp, walk_pace_sec: wp,
                      blended_pace_sec: mBRes.blendedPaceSec,
                      proj_finish_sec: Math.round(mBRes.projFinishSec),
                      target_finish_sec: ts, notes: null,
                    })
                  }
                  setMBSaving(false)
                }} disabled={mBSaving}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  {mBSaving ? 'Menyimpan...' : '💾 Simpan ke Riwayat'}
                </button>
              </div>
            </>
          )}
          {mBRes && 'error' in mBRes && (
            <div className="p-3 bg-red-50 rounded-lg text-sm text-red-600">{mBRes.error}</div>
          )}
        </div>
      )}

      {/* ══════════════ MODE C ══════════════ */}
      {activeTab === 'modeC' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Mode C — Multi-Segment Strategy</h2>
          <p className="text-xs text-gray-400 mb-4">
            Bagi race menjadi beberapa segmen dengan rasio berbeda. Sistem menghitung finish time gabungan.
          </p>

          <div className="space-y-4 mb-5">
            {segments.map((seg, idx) => (
              <div key={seg.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-sm font-semibold text-indigo-700">Segmen {idx + 1}</p>
                  {segments.length > 1 && (
                    <button onClick={() => setSegments(s => s.filter(x => x.id !== seg.id))}
                      className="text-xs text-red-400 hover:text-red-600 border border-red-200 px-2 py-1 rounded-lg">Hapus</button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div>
                    <label className={labelCls}>Jarak (km)</label>
                    <input type="number" step="0.1" value={seg.distKm}
                      onChange={e => setSegments(s => s.map(x => x.id === seg.id ? { ...x, distKm: e.target.value } : x))}
                      className={inputCls} placeholder="10" />
                  </div>
                  <div>
                    <label className={labelCls}>Run Interval (det)</label>
                    <input type="number" value={seg.runSec}
                      onChange={e => setSegments(s => s.map(x => x.id === seg.id ? { ...x, runSec: e.target.value } : x))}
                      className={inputCls} placeholder="60" />
                  </div>
                  <div>
                    <label className={labelCls}>Walk Interval (det)</label>
                    <input type="number" value={seg.walkSec}
                      onChange={e => setSegments(s => s.map(x => x.id === seg.id ? { ...x, walkSec: e.target.value } : x))}
                      className={inputCls} placeholder="30" />
                  </div>
                  <div>
                    <label className={labelCls}>Run Pace (/km)</label>
                    <input type="text" value={seg.runPace}
                      onChange={e => setSegments(s => s.map(x => x.id === seg.id ? { ...x, runPace: e.target.value } : x))}
                      className={inputCls} placeholder="6:00" />
                  </div>
                  <div>
                    <label className={labelCls}>Walk Pace (/km)</label>
                    <input type="text" value={seg.walkPace}
                      onChange={e => setSegments(s => s.map(x => x.id === seg.id ? { ...x, walkPace: e.target.value } : x))}
                      className={inputCls} placeholder="8:00" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mb-5">
            <button onClick={() => setSegments(s => [...s, { id: Date.now(), distKm: '', runSec: '60', walkSec: '30', runPace: '', walkPace: '8:00' }])}
              className="px-4 py-2 border border-indigo-300 text-indigo-600 text-sm rounded-lg hover:bg-indigo-50 transition-colors">
              + Tambah Segmen
            </button>
            <button onClick={() => setMCRes(calcModeC(segments))}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Hitung
            </button>
          </div>

          {mCRes && !('error' in mCRes) && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-indigo-50 rounded-lg p-3">
                  <p className={labelCls}>Total Finish Time</p>
                  <p className="text-2xl font-bold text-indigo-700">{secToHMMSS(mCRes.totalFinishSec)}</p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Overall Pace</p>
                  <p className="text-xl font-bold text-gray-800">{secToMMSS(mCRes.overallPaceSec)}<span className="text-sm font-normal">/km</span></p>
                </div>
                <div className={cardCls}>
                  <p className={labelCls}>Total Jarak</p>
                  <p className={valueCls}>{mCRes.segResults.reduce((a, r) => a + r.distKm, 0).toFixed(1)} km</p>
                </div>
              </div>
              <div className="space-y-2 mb-4">
                {mCRes.segResults.map((r, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg text-sm">
                    <span className="font-medium text-gray-600 w-20">Segmen {i + 1}</span>
                    <span className="text-gray-500">{r.distKm} km</span>
                    <span className="text-indigo-600 font-medium">{secToMMSS(r.blendedPaceSec)}/km</span>
                    <span className="text-gray-700 font-semibold">{secToHMMSS(r.finishSec)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <select value={mCLabel} onChange={e => setMCLabel(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option>Race</option><option>Latihan</option><option>Time Trial</option>
                </select>
                <button onClick={async () => {
                  setMCSaving(true)
                  if (!('error' in mCRes)) {
                    const totalDist = mCRes.segResults.reduce((a, r) => a + r.distKm, 0)
                    await saveHistory({
                      mode: 'C', label: mCLabel,
                      distance_km: totalDist,
                      run_sec: null, walk_sec: null,
                      run_pace_sec: null, walk_pace_sec: null,
                      blended_pace_sec: mCRes.overallPaceSec,
                      proj_finish_sec: Math.round(mCRes.totalFinishSec),
                      target_finish_sec: null,
                      notes: `${segments.length} segmen`,
                    })
                  }
                  setMCSaving(false)
                }} disabled={mCSaving}
                  className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  {mCSaving ? 'Menyimpan...' : '💾 Simpan ke Riwayat'}
                </button>
              </div>
            </>
          )}
          {mCRes && 'error' in mCRes && (
            <div className="p-3 bg-red-50 rounded-lg text-sm text-red-600">{mCRes.error}</div>
          )}
        </div>
      )}

      {/* ══════════════ FATIGUE ADJUSTER ══════════════ */}
      {activeTab === 'fatigue' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Fatigue Adjuster</h2>
          <p className="text-xs text-gray-400 mb-4">
            Rekomendasi penyesuaian ratio RWR berdasarkan kondisi fisik terkini.
            EWS score auto-pull dari data terbaru.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
            <div>
              <label className={labelCls}>EWS Score (auto dari data terbaru)</label>
              <input type="number" step="0.1" value={faEWS} onChange={e => setFaEWS(e.target.value)}
                className={inputCls} placeholder="0–100" />
              {ewsLatest?.composite_score !== null && ewsLatest?.composite_score !== undefined && (
                <p className="text-xs text-gray-400 mt-1">Data terbaru: {ewsLatest.composite_score}</p>
              )}
            </div>
            <div>
              <label className={labelCls}>RPE Sesi Kemarin (1–10)</label>
              <input type="number" min="1" max="10" value={faRPE} onChange={e => setFaRPE(e.target.value)}
                className={inputCls} placeholder="6" />
            </div>
            <div>
              <label className={labelCls}>Ratio Dasar</label>
              <select value={faBase} onChange={e => setFaBase(e.target.value)} className={inputCls}>
                <option value="">Pilih ratio dasar...</option>
                {displayRefRows.map(r => (
                  <option key={r.id} value={`${r.run_sec}:${r.walk_sec}`}>
                    {r.run_sec}:{r.walk_sec} — {r.pace_label}{r.is_default ? ' ★' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {faResult ? (
            <div className="p-4 rounded-xl" style={{ background: faResult.color + '12', border: `1px solid ${faResult.color}30` }}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{faResult.adj < 0 ? '⬇' : faResult.adj > 0 ? '⬆' : '↔'}</span>
                <p className="text-base font-bold" style={{ color: faResult.color }}>{faResult.msg}</p>
              </div>
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Rekomendasi Ratio</p>
                <p className="text-3xl font-bold" style={{ color: faResult.color }}>
                  {faResult.rec.run_sec}:{faResult.rec.walk_sec}
                  <span className="text-sm font-normal text-gray-500 ml-2">det — {faResult.rec.pace_label} · {faResult.rec.aplikasi}</span>
                </p>
              </div>
              <p className="text-xs text-gray-500">{faResult.reasons.join(' · ')}</p>
            </div>
          ) : (
            <div className="p-4 bg-gray-50 rounded-xl text-xs text-gray-400">
              Pilih ratio dasar dan isi minimal EWS atau RPE untuk melihat rekomendasi.
            </div>
          )}
        </div>
      )}

      {/* ══════════════ REFERENSI ══════════════ */}
      {activeTab === 'ref' && (
        <div className="space-y-5">
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={headerCls + ' mb-0 border-0 pb-0'}>Tabel Referensi RWR</h2>
              <div className="flex gap-2">
                {refRows.length === 0 && (
                  <button onClick={initDefaultRef}
                    className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                    Inisialisasi Default
                  </button>
                )}
                {canEdit && refRows.length > 0 && (
                  <>
                    <button onClick={() => { setEditRefId('new'); setEditRefForm({ run_sec: 60, walk_sec: 30 }) }}
                      className="text-xs px-3 py-1.5 border border-indigo-400 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
                      + Tambah Baris
                    </button>
                    <button onClick={resetRef}
                      className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                      Reset Default
                    </button>
                  </>
                )}
              </div>
            </div>

            {editRefId === 'new' && (
              <div className="mb-4 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                <p className="text-xs font-medium text-indigo-700 mb-3 uppercase">Tambah Baris Baru</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className={labelCls}>Pace Label</label>
                    <input type="text" value={editRefForm.pace_label ?? ''} onChange={e => setEditRefForm(p => ({ ...p, pace_label: e.target.value }))} className={inputCls} placeholder="7:00/km" />
                  </div>
                  <div>
                    <label className={labelCls}>Run (det)</label>
                    <input type="number" value={editRefForm.run_sec ?? 60} onChange={e => setEditRefForm(p => ({ ...p, run_sec: parseInt(e.target.value) }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Walk (det)</label>
                    <input type="number" value={editRefForm.walk_sec ?? 30} onChange={e => setEditRefForm(p => ({ ...p, walk_sec: parseInt(e.target.value) }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Aplikasi</label>
                    <input type="text" value={editRefForm.aplikasi ?? ''} onChange={e => setEditRefForm(p => ({ ...p, aplikasi: e.target.value }))} className={inputCls} placeholder="Keterangan..." />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveRefRow} disabled={refSaving} className="px-4 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                    {refSaving ? '...' : 'Simpan'}
                  </button>
                  <button onClick={() => setEditRefId(null)} className="px-4 py-1.5 border border-gray-300 text-gray-500 text-xs rounded-lg hover:bg-gray-50">Batal</button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Pace', 'Run (det)', 'Walk (det)', 'Rasio', 'Aplikasi', ''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 uppercase pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRefRows.map(r => (
                    editRefId === r.id ? (
                      <tr key={r.id} className="border-b border-indigo-50 bg-indigo-50">
                        <td className="py-2 pr-3"><input type="text" value={editRefForm.pace_label ?? ''} onChange={e => setEditRefForm(p => ({ ...p, pace_label: e.target.value }))} className={inputCls} /></td>
                        <td className="py-2 pr-3"><input type="number" value={editRefForm.run_sec ?? 60} onChange={e => setEditRefForm(p => ({ ...p, run_sec: parseInt(e.target.value) }))} className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></td>
                        <td className="py-2 pr-3"><input type="number" value={editRefForm.walk_sec ?? 30} onChange={e => setEditRefForm(p => ({ ...p, walk_sec: parseInt(e.target.value) }))} className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></td>
                        <td className="py-2 pr-3 text-gray-500">{editRefForm.run_sec}:{editRefForm.walk_sec}</td>
                        <td className="py-2 pr-3"><input type="text" value={editRefForm.aplikasi ?? ''} onChange={e => setEditRefForm(p => ({ ...p, aplikasi: e.target.value }))} className={inputCls} /></td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <button onClick={saveRefRow} disabled={refSaving} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg">{refSaving ? '...' : '✓'}</button>
                            <button onClick={() => setEditRefId(null)} className="text-xs px-2 py-1 border border-gray-300 text-gray-500 rounded-lg">✕</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${r.is_default ? 'bg-amber-50' : ''}`}>
                        <td className="py-2.5 pr-4">
                          <span className={`text-sm ${r.is_default ? 'font-bold text-amber-700' : 'text-gray-700'}`}>{r.pace_label}</span>
                          {r.is_default && <span className="ml-1 text-xs text-amber-500">★ DEFAULT</span>}
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-gray-700">{r.run_sec}</td>
                        <td className="py-2.5 pr-4 font-mono text-gray-700">{r.walk_sec}</td>
                        <td className="py-2.5 pr-4 font-bold text-indigo-600">{r.run_sec}:{r.walk_sec}</td>
                        <td className="py-2.5 pr-4 text-gray-500 text-xs">{r.aplikasi ?? '—'}</td>
                        <td className="py-2.5">
                          {canEdit && !r.id.startsWith('d') && (
                            <div className="flex gap-1">
                              <button onClick={() => { setEditRefId(r.id); setEditRefForm({ ...r }) }}
                                className="text-xs px-2 py-1 border border-indigo-200 text-indigo-500 rounded-lg hover:bg-indigo-50">Edit</button>
                              <button onClick={() => toggleDefault(r.id)}
                                className={`text-xs px-2 py-1 border rounded-lg ${r.is_default ? 'border-amber-300 text-amber-600 bg-amber-50' : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}>★</button>
                              <button onClick={() => deleteRefRow(r.id)}
                                className="text-xs px-2 py-1 border border-red-200 text-red-400 rounded-lg hover:bg-red-50">Hapus</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-3">Sumber: Jeff Galloway Run-Walk-Run Method (2015). ★ = ratio DEFAULT untuk Fatigue Adjuster.</p>
          </div>

          {/* RWR Training Progression */}
          {currentWeek && (
            <div className={sectionCls}>
              <h2 className={headerCls}>RWR Training Progression</h2>
              <div className="p-4 bg-emerald-50 rounded-xl">
                <p className="text-xs font-medium text-emerald-700 uppercase mb-2">Minggu Aktif: W{currentWeek.week_number} — {currentWeek.phase}</p>
                <p className="text-sm text-gray-700 mb-2">{currentWeek.focus}</p>
                {currentWeek.rwr_run_sec && currentWeek.rwr_walk_sec ? (
                  <div className="flex items-center gap-3">
                    <div>
                      <p className={labelCls}>Ratio Coach Minggu Ini</p>
                      <p className="text-2xl font-bold text-emerald-700">{currentWeek.rwr_run_sec}:{currentWeek.rwr_walk_sec} <span className="text-sm font-normal">det</span></p>
                    </div>
                    <button onClick={() => {
                      setMB(p => ({ ...p, runSec: currentWeek.rwr_run_sec!.toString(), walkSec: currentWeek.rwr_walk_sec!.toString() }))
                      setActiveTab('modeB')
                      showToast('Ratio dari program di-apply ke Mode B.')
                    }} className="px-3 py-1.5 text-xs border border-emerald-400 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors">
                      Apply ke Mode B →
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">Coach belum set ratio RWR untuk minggu ini di Program.</p>
                )}
                <p className="text-xs text-gray-400 mt-2">Read-only — ratio diset oleh coach di menu Program.</p>
              </div>
            </div>
          )}

          {/* Catatan Strategi */}
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={headerCls + ' mb-0 border-0 pb-0'}>Catatan Strategi RWR</h2>
              {canEdit && (
                <button onClick={() => { setNoteContent(rwrNote); setEditNote(!editNote) }}
                  className="text-xs px-3 py-1 border border-indigo-400 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors">
                  {editNote ? 'Batal' : 'Edit'}
                </button>
              )}
            </div>
            {editNote ? (
              <div className="space-y-3">
                <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} rows={8}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button onClick={saveNote} disabled={noteSaving}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {noteSaving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            ) : (
              <div className="text-sm text-gray-700 whitespace-pre-wrap">
                {rwrNote || <span className="text-gray-400 italic">Belum ada catatan strategi. Klik Edit untuk menambahkan.</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ RIWAYAT ══════════════ */}
      {activeTab === 'history' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Riwayat Kalkulasi</h2>
          {history.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">Belum ada riwayat. Simpan kalkulasi dari Mode A, B, atau C.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Tanggal','Mode','Label','Jarak','Rasio','Run Pace','Blended Pace','Proj. Finish','vs Target','Catatan',''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 uppercase pb-2 pr-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => {
                    const diff = h.proj_finish_sec && h.target_finish_sec ? h.proj_finish_sec - h.target_finish_sec : null
                    return (
                      <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(h.calc_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">Mode {h.mode}</span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-600">{h.label ?? '—'}</td>
                        <td className="py-2 pr-3 text-xs">{h.distance_km ? `${h.distance_km} km` : '—'}</td>
                        <td className="py-2 pr-3 text-xs font-mono">
                          {h.run_sec && h.walk_sec ? `${h.run_sec}:${h.walk_sec}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">{h.run_pace_sec ? `${secToMMSS(h.run_pace_sec)}/km` : '—'}</td>
                        <td className="py-2 pr-3 text-xs font-medium text-indigo-600">
                          {h.blended_pace_sec ? `${secToMMSS(h.blended_pace_sec)}/km` : '—'}
                        </td>
                        <td className="py-2 pr-3 font-bold text-gray-800">
                          {h.proj_finish_sec ? secToHMMSS(h.proj_finish_sec) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {diff !== null ? (
                            <span className={diff <= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
                              {diff <= 0 ? '-' : '+'}{secToHMMSS(Math.abs(diff))}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-400">{h.notes ?? ''}</td>
                        <td className="py-2">
                          <button onClick={async () => {
                            if (!confirm('Hapus riwayat ini?')) return
                            await (supabase as any).from('rwr_history').delete().eq('id', h.id)
                            await loadAll()
                            showToast('Riwayat dihapus.')
                          }} className="border border-red-200 text-red-400 text-xs px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                            Hapus
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
