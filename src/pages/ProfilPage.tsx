import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

// ─── Types ───────────────────────────────────────────────────────────────────

interface AthleteSettings {
  lthr: number | null
  resting_hr: number | null
  max_hr: number | null
  weight_kg: number | null
  height_cm: number | null
  domisili: string | null
  birth_date: string | null
  cedera: string | null
  start_training_date: string | null
}

interface TtEntry {
  id: string
  tt_date: string
  distance_km: number
  finish_time_sec: number
  tt_type: string | null
  hr_avg: number | null
  hr_partial_avg: number | null
  lthr_calculated: number | null
  vdot: number | null
  notes: string | null
}

interface TrainingSession {
  session_date: string
  session_type: string | null
  pace_avg_min: number | null
  pace_avg_sec: number | null
  hr_avg: number | null
  trimp: number | null
  distance_km: number | null
  duration_sec: number | null
}

interface HrHistoryEntry {
  hr_type: string | null
  hr_value: number
  recorded_date: string
}

// ─── Algorithms ──────────────────────────────────────────────────────────────

function calcVdot(distanceM: number, finishTimeSec: number): number {
  const v = distanceM / finishTimeSec * 60
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
  const pctVo2 = 0.8 + 0.1894393 * Math.exp(-0.012778 * finishTimeSec / 60)
               + 0.2989558 * Math.exp(-0.1932605 * finishTimeSec / 60)
  return parseFloat((vo2 / pctVo2).toFixed(1))
}

function calcLthrFromTT(ttType: string, hrAvg: number | null, hrPartial: number | null): number | null {
  switch (ttType) {
    case '8min':      return hrAvg ? Math.round(hrAvg * 0.952) : null
    case '15min-5k':  return hrPartial ? Math.round(hrPartial * 0.962) : null
    case '15min-10k': return hrPartial ? Math.round(hrPartial * 0.978) : null
    case '20min':     return hrAvg ? Math.round(hrAvg * 0.971) : null
    case '30min':     return hrPartial ? Math.round(hrPartial) : null
    case '45min':     return hrAvg ? Math.round(hrAvg * 0.987) : null
    case '60min':     return hrPartial ? Math.round(hrPartial) : null
    default:          return null
  }
}

function vdotToPaces(vdot: number): Record<string, number> {
  const pcts = [0.55, 0.65, 0.70, 0.75, 0.83, 0.88, 0.92, 0.97, 1.03]
  const result: Record<string, number> = {}
  const keys = ['Recovery','Easy (LR)','Easy Run','Medium 1','Tempo','Threshold','Aerobic Power','Interval','Anaerob End.']
  pcts.forEach((pct, i) => {
    let lo = 80, hi = 700
    for (let j = 0; j < 60; j++) {
      const mid = (lo + hi) / 2
      const vo2atV = -4.60 + 0.182258 * mid + 0.000104 * mid * mid
      if (vo2atV / vdot < pct) lo = mid; else hi = mid
    }
    result[keys[i]] = Math.round(1000 / ((lo + hi) / 2) * 60)
  })
  return result
}

function easyPaceFromVdot(vdot: number): string {
  const paces = vdotToPaces(vdot)
  return secToPace(paces['Easy Run'])
}

function predictTime(knownDistM: number, knownTimeSec: number, targetDistM: number): number {
  return knownTimeSec * Math.pow(targetDistM / knownDistM, 1.06)
}

function magicMilePace(tt: TtEntry): string {
  const mmSec = predictTime(tt.distance_km * 1000, tt.finish_time_sec, 1609.34)
  return secToPace(Math.round(mmSec / 1.60934))
}

function secToPace(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTimeToSec(val: string): number | null {
  const parts = val.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function calcBmi(h: number, w: number) {
  const bmi = w / Math.pow(h / 100, 2)
  const label = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'
  const color = bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444'
  return { bmi: bmi.toFixed(1), label, color }
}

function calcAge(birthDate: string): number {
  const today = new Date(), dob = new Date(birthDate)
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

function calcTrainingAge(startDate: string | null): string {
  if (!startDate) return '—'
  const start = new Date(startDate), now = new Date()
  const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (years === 0) return `${months} Bulan`
  if (months === 0) return `${years} Tahun`
  return `${years} Tahun ${months} Bulan`
}

function getVdotReliability(startDate: string | null) {
  if (!startDate) return { icon: '🔴', label: 'Akurasi ±8%', note: 'Running economy masih berkembang.' }
  const months = (new Date().getFullYear() - new Date(startDate).getFullYear()) * 12 + (new Date().getMonth() - new Date(startDate).getMonth())
  const years = months / 12
  if (years < 2) return { icon: '🔴', label: 'Akurasi ±8%', note: 'Running economy masih berkembang. Potensi aktual bisa 5–10% lebih baik dari VDOT.' }
  if (years < 5) return { icon: '🟡', label: 'Akurasi ±5%', note: 'Running economy cukup stabil. Potensi aktual mungkin 2–5% lebih baik.' }
  return { icon: '🟢', label: 'Akurasi ±3%', note: 'Running economy sudah mature. VDOT mencerminkan potensi realistis.' }
}

function calcEF(sessions: TrainingSession[]) {
  const valid = sessions.filter(s => (s.session_type === 'Easy' || s.session_type === 'LR') && s.pace_avg_min != null && s.hr_avg && s.hr_avg > 0)
  if (!valid.length) return null
  const efs = valid.map(s => {
    const paceSec = (s.pace_avg_min! * 60) + (s.pace_avg_sec ?? 0)
    return paceSec > 0 ? (1000 / paceSec) / s.hr_avg! * 100 : 0
  }).filter(e => e > 0)
  if (!efs.length) return null
  const current = efs[0]
  const color = current >= 1.4 ? '#10b981' : current >= 1.2 ? '#3b82f6' : current >= 1.0 ? '#f59e0b' : '#ef4444'
  const label = current >= 1.4 ? 'Excellent' : current >= 1.2 ? 'Baik' : current >= 1.0 ? 'Cukup' : 'Perlu Ditingkatkan'
  return { current, label, color }
}

function calcPES(sessions: TrainingSession[]) {
  if (sessions.length < 3) return null
  const withPaceHr = sessions.filter(s => s.pace_avg_min != null && s.hr_avg && s.hr_avg > 0)
  if (!withPaceHr.length) return null
  const avgEf = withPaceHr.reduce((acc, s) => {
    const paceSec = (s.pace_avg_min! * 60) + (s.pace_avg_sec ?? 0)
    return acc + (paceSec > 0 ? (1000 / paceSec) / s.hr_avg! * 100 : 0)
  }, 0) / withPaceHr.length
  const phrNorm = Math.min(100, Math.round(avgEf / 1.4 * 100))
  const withTrimp = sessions.filter(s => s.trimp)
  const teNorm = withTrimp.length ? Math.min(100, Math.round(withTrimp.reduce((a, s) => a + s.trimp!, 0) / withTrimp.length / 80 * 100)) : 0
  const rhrNorm = 70
  const z12Norm = Math.min(100, Math.round(sessions.filter(s => s.session_type === 'Easy' || s.session_type === 'LR').length / sessions.length * 100))
  const pes = Math.round(phrNorm * 0.4 + teNorm * 0.25 + rhrNorm * 0.2 + z12Norm * 0.15)
  const color = pes >= 80 ? '#10b981' : pes >= 60 ? '#3b82f6' : pes >= 40 ? '#f59e0b' : '#ef4444'
  const label = pes >= 80 ? 'Excellent' : pes >= 60 ? 'Baik' : pes >= 40 ? 'Cukup' : 'Perlu Ditingkatkan'
  const msg = pes >= 80 ? 'Efisiensi latihan sangat baik.' : pes >= 60 ? 'Latihan cukup efisien.' : 'Fokus pada sesi easy dan konsistensi.'
  return { pes, label, color, msg, phrNorm, teNorm, rhrNorm, z12Norm }
}

function calcHSI(temp: number, rh: number) {
  const e = (rh / 100) * 6.105 * Math.exp(17.27 * temp / (237.3 + temp))
  const wbgt = parseFloat((0.567 * temp + 0.393 * e + 3.94).toFixed(1))
  const hrDrift = wbgt < 20 ? 0 : wbgt < 24 ? 2 : wbgt < 28 ? 5 : wbgt < 32 ? 8 : 12
  const penalties: Record<string, number> = {
    'Easy (Z1-Z2)': wbgt < 20 ? 0 : wbgt < 24 ? 10 : wbgt < 28 ? 20 : wbgt < 32 ? 37 : 50,
    'Tempo (Z3)':   wbgt < 20 ? 0 : wbgt < 24 ? 7  : wbgt < 28 ? 15 : wbgt < 32 ? 29 : 40,
    'Sub-LT (Z4)':  wbgt < 20 ? 0 : wbgt < 24 ? 5  : wbgt < 28 ? 10 : wbgt < 32 ? 20 : 30,
    'Race Pace':    wbgt < 20 ? 0 : wbgt < 24 ? 5  : wbgt < 28 ? 10 : wbgt < 32 ? 20 : 25,
  }
  const risk = wbgt < 20 ? 'Aman' : wbgt < 24 ? 'Rendah' : wbgt < 28 ? 'Sedang — Waspada' : wbgt < 32 ? 'Panas — Kurangi Intensitas' : 'Berbahaya'
  const emoji = wbgt < 20 ? '🟢' : wbgt < 24 ? '🟡' : wbgt < 28 ? '🟠' : wbgt < 32 ? '🔴' : '⛔'
  const cls = wbgt < 20 ? 'safe' : wbgt < 24 ? 'low' : wbgt < 28 ? 'mod' : 'high'
  return { wbgt, hrDrift, penalties, risk, emoji, cls }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TT_TYPES = [
  { value: '8min',      label: '8 Menit',  race: 'Race 5K',         hint: 'LTHR = HR avg × 0.952',            accuracy: 'Akurasi 92% vs MLSS', partialLabel: null },
  { value: '15min-5k',  label: '15 Menit', race: 'Race 5K',         hint: 'LTHR = HR avg menit 4–15 × 0.962', accuracy: 'Akurasi 92% vs MLSS', partialLabel: 'Avg HR Menit 4–15 (bpm)' },
  { value: '15min-10k', label: '15 Menit', race: 'Race 10K',        hint: 'LTHR = HR avg menit 4–15 × 0.978', accuracy: 'Akurasi 92% vs MLSS', partialLabel: 'Avg HR Menit 4–15 (bpm)' },
  { value: '20min',     label: '20 Menit', race: 'Race 10K',        hint: 'LTHR = HR avg × 0.971',            accuracy: 'Akurasi 93% vs MLSS', partialLabel: null },
  { value: '30min',     label: '30 Menit', race: 'Race HM & FM',    hint: 'LTHR = HR avg menit 11–30',        accuracy: 'Akurasi 94% vs MLSS', partialLabel: 'Avg HR Menit 11–30 (bpm)' },
  { value: '45min',     label: '45 Menit', race: 'Race FM & Ultra', hint: 'LTHR = HR avg × 0.987',            accuracy: 'Akurasi 91% vs MLSS', partialLabel: null },
  { value: '60min',     label: '60 Menit', race: 'Race FM & Ultra', hint: 'LTHR = HR avg menit 31–60',        accuracy: 'Akurasi 90% vs MLSS', partialLabel: 'Avg HR Menit 31–60 (bpm)' },
]

const TT_DISTANCES: Record<string, number> = {
  '8min': 0, '20min': 0, '30min': 0, '45min': 0, '60min': 0,
  '5K': 5.0, '10K': 10.0, 'HM': 21.0975, 'FM': 42.195,
}

const RACE_TARGETS = [
  { label: '🏁 Maybank <2:30', target: 9000, color: '#6366f1' },
  { label: '⭐ Pocari <2:15',  target: 8100, color: '#f59e0b' },
]

const emptySettings: AthleteSettings = {
  lthr: null, resting_hr: null, max_hr: null, weight_kg: null,
  height_cm: null, domisili: null, birth_date: null, cedera: null, start_training_date: null,
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProfilPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id
  const cancelledRef = useRef(false)

  const [settings, setSettings] = useState<AthleteSettings>(emptySettings)
  const [ttList, setTtList] = useState<TtEntry[]>([])
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [hrHistory, setHrHistory] = useState<HrHistoryEntry[]>([])
  const [lastLongRun, setLastLongRun] = useState<TrainingSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [showTtForm, setShowTtForm] = useState(false)
  const [ttForm, setTtForm] = useState({
    tt_date: new Date().toISOString().split('T')[0],
    tt_type: '5K', distance_km: '5.0', finish_time: '',
    hr_avg: '', hr_partial_avg: '', notes: '',
  })
  const [ttSaving, setTtSaving] = useState(false)
  const [editTtId, setEditTtId] = useState<string | null>(null)
  const [editTtForm, setEditTtForm] = useState<Record<string, string>>({})
  const [editTtSaving, setEditTtSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hsiState, setHsiState] = useState({ temp: 30.8, rh: 58 })

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [sRes, ttRes, sesRes, hrRes, lrRes] = await Promise.all([
        supabase.from('athlete_settings')
          .select('lthr,resting_hr,max_hr,weight_kg,height_cm,domisili,birth_date,cedera,start_training_date')
          .eq('athlete_id', athleteId as string).maybeSingle(),
        supabase.from('tt_history')
          .select('id,tt_date,distance_km,finish_time_sec,tt_type,hr_avg,hr_partial_avg,lthr_calculated,vdot,notes')
          .eq('athlete_id', athleteId as string).order('tt_date', { ascending: false }),
        supabase.from('training_sessions')
          .select('session_date,session_type,pace_avg_min,pace_avg_sec,hr_avg,trimp,distance_km,duration_sec')
          .eq('athlete_id', athleteId as string).order('session_date', { ascending: false }).limit(90),
        supabase.from('hr_history')
          .select('hr_type,hr_value,recorded_date')
          .eq('athlete_id', athleteId as string).order('recorded_date', { ascending: false }).limit(20),
        supabase.from('training_sessions')
          .select('session_date,session_type,pace_avg_min,pace_avg_sec,hr_avg,trimp,distance_km,duration_sec')
          .eq('athlete_id', athleteId as string)
          .or('distance_km.gte.10,duration_sec.gte.5400')
          .order('session_date', { ascending: false }).limit(1),
      ])
      if (cancelled) return
      if (sRes.data) setSettings(sRes.data as AthleteSettings)
      if (ttRes.data) setTtList(ttRes.data)
      if (sesRes.data) setSessions(sesRes.data)
      if (hrRes.data) setHrHistory(hrRes.data)
      if (lrRes.data && lrRes.data.length > 0) setLastLongRun(lrRes.data[0])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [athleteId])

  // ─── Derived ─────────────────────────────────────────────────────────────

  const latestTt = ttList[0] ?? null
  const vdot = latestTt?.vdot ?? null
  const lthrFromTt = ttList.find(t => t.lthr_calculated != null)?.lthr_calculated ?? null
  const lthrRef = lthrFromTt ?? settings.lthr
  const rhrValues = hrHistory.filter(h => h.hr_type === 'rhr').map(h => h.hr_value)
  const rhrAvg = rhrValues.length ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length) : (settings.resting_hr ?? null)
  const maxHR = settings.max_hr ?? (lthrRef ? Math.round(lthrRef / 0.88) : null)
  const hrr = (lthrRef && rhrAvg && maxHR) ? maxHR - rhrAvg : null
  const age = settings.birth_date ? calcAge(settings.birth_date) : null
  const bmiData = (settings.height_cm && settings.weight_kg) ? calcBmi(settings.height_cm, settings.weight_kg) : null
  const taStr = calcTrainingAge(settings.start_training_date)
  const vdotRel = getVdotReliability(settings.start_training_date)
  const predHmSec = latestTt ? predictTime(latestTt.distance_km * 1000, latestTt.finish_time_sec, 21097.5) : null
  const easyPaceStr = vdot ? easyPaceFromVdot(vdot) : null
  const ef = calcEF(sessions)
  const pes = calcPES(sessions)
  const basePaces = vdot ? vdotToPaces(vdot) : {}
  const hsi = calcHSI(hsiState.temp, hsiState.rh)

  const lrStr = lastLongRun
    ? (() => {
        const dist = lastLongRun.distance_km ? `${lastLongRun.distance_km} km` : '—'
        const pace = lastLongRun.pace_avg_min != null
          ? ` @ ${lastLongRun.pace_avg_min}:${String(lastLongRun.pace_avg_sec ?? 0).padStart(2, '0')}/km`
          : ''
        const date = new Date(lastLongRun.session_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
        return `${dist}${pace} (${date})`
      })()
    : '—'

  const initials = (athlete?.name ?? 'A').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  // TT form: auto-fill distance from tt_type
  function onTtTypeChange(val: string) {
    const dist = TT_DISTANCES[val] ?? 0
    setTtForm(p => ({ ...p, tt_type: val, distance_km: dist > 0 ? dist.toString() : '' }))
  }

  const needsPartial = TT_TYPES.find(t => t.value === ttForm.tt_type)?.partialLabel ?? null

  // ─── Handlers ────────────────────────────────────────────────────────────

  function openEdit() {
    setEditForm({
      name: athlete?.name ?? '',
      whatsapp: (athlete as Record<string, unknown>)?.whatsapp as string ?? '',
      birth_date: settings.birth_date ?? '',
      height_cm: settings.height_cm?.toString() ?? '',
      weight_kg: settings.weight_kg?.toString() ?? '',
      domisili: settings.domisili ?? '',
      cedera: settings.cedera ?? 'Tidak ada',
      start_training_date: settings.start_training_date ?? '',
    })
    setEditMode(true)
    setPwMsg(null)
  }

  async function saveProfile() {
    if (!athleteId) return
    setSaving(true); setError(null)
    const p = editForm

    // Update athletes.name & whatsapp
    const { error: nameErr } = await supabase.from('athletes')
      .update({ name: p.name || athlete?.name, whatsapp: p.whatsapp || null })
      .eq('id', athleteId as string)
    if (nameErr) { setError(nameErr.message); setSaving(false); return }

    // Update athlete_settings
    const payload = {
      athlete_id: athleteId,
      height_cm: p.height_cm ? parseInt(p.height_cm) : null,
      weight_kg: p.weight_kg ? parseFloat(p.weight_kg) : null,
      domisili: p.domisili || null,
      birth_date: p.birth_date || null,
      cedera: p.cedera || 'Tidak ada',
      start_training_date: p.start_training_date || null,
      updated_at: new Date().toISOString(),
    }
    const { error: settErr } = await supabase.from('athlete_settings')
      .upsert(payload, { onConflict: 'athlete_id' })
    setSaving(false)
    if (settErr) { setError(settErr.message); return }
    setEditMode(false)
    // Reload settings
    const { data } = await supabase.from('athlete_settings')
      .select('lthr,resting_hr,max_hr,weight_kg,height_cm,domisili,birth_date,cedera,start_training_date')
      .eq('athlete_id', athleteId as string).maybeSingle()
    if (data) setSettings(data as AthleteSettings)
  }

  async function sendPasswordReset() {
    const email = athlete?.email
    if (!email) return
    setPwLoading(true); setPwMsg(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setPwLoading(false)
    if (err) setPwMsg(`❌ ${err.message}`)
    else setPwMsg('✅ Email reset password telah dikirim. Cek inbox Anda.')
  }

  async function saveTt() {
    if (!athleteId) return
    setError(null)
    const isTimeBased = ['8min','20min','30min','45min','60min'].includes(ttForm.tt_type)
    const finishSec = parseTimeToSec(ttForm.finish_time)
    if (!finishSec) { setError('Format waktu tidak valid. Gunakan MM:SS atau HH:MM:SS.'); return }
    const distKm = isTimeBased
      ? parseFloat(ttForm.distance_km || '0')
      : (TT_DISTANCES[ttForm.tt_type] || parseFloat(ttForm.distance_km))
    const lthrCalc = calcLthrFromTT(
      ttForm.tt_type,
      ttForm.hr_avg ? parseInt(ttForm.hr_avg) : null,
      ttForm.hr_partial_avg ? parseInt(ttForm.hr_partial_avg) : null,
    )
    const vdotVal = distKm > 0 ? calcVdot(distKm * 1000, finishSec) : null
    setTtSaving(true)
    const { error: err } = await supabase.from('tt_history').insert({
      athlete_id: athleteId,
      tt_date: ttForm.tt_date,
      tt_type: ttForm.tt_type,
      distance_km: distKm > 0 ? distKm : 0,
      finish_time_sec: finishSec,
      hr_avg: ttForm.hr_avg ? parseInt(ttForm.hr_avg) : null,
      hr_partial_avg: ttForm.hr_partial_avg ? parseInt(ttForm.hr_partial_avg) : null,
      lthr_calculated: lthrCalc,
      vdot: vdotVal,
      notes: ttForm.notes || null,
    })
    setTtSaving(false)
    if (err) { setError(err.message); return }

    // Mirror LTHR ke athlete_settings jika ada
    if (lthrCalc) {
      await supabase.from('athlete_settings').upsert(
        { athlete_id: athleteId, lthr: lthrCalc, updated_at: new Date().toISOString() },
        { onConflict: 'athlete_id' }
      )
    }

    setTtForm({ tt_date: new Date().toISOString().split('T')[0], tt_type: '5K', distance_km: '5.0', finish_time: '', hr_avg: '', hr_partial_avg: '', notes: '' })
    setShowTtForm(false)
    const { data } = await supabase.from('tt_history')
      .select('id,tt_date,distance_km,finish_time_sec,tt_type,hr_avg,hr_partial_avg,lthr_calculated,vdot,notes')
      .eq('athlete_id', athleteId as string).order('tt_date', { ascending: false })
    if (data) setTtList(data)
  }

  function openEditTt(tt: TtEntry) {
    setEditTtId(tt.id)
    setEditTtForm({
      tt_date: tt.tt_date,
      tt_type: tt.tt_type ?? '8min',
      distance_km: tt.distance_km?.toString() ?? '',
      finish_time: fmtTime(tt.finish_time_sec),
      hr_avg: tt.hr_avg?.toString() ?? '',
      hr_partial_avg: tt.hr_partial_avg?.toString() ?? '',
    })
  }

  async function saveEditTt() {
    if (!athleteId || !editTtId) return
    setEditTtSaving(true)
    const finishSec = parseTimeToSec(editTtForm.finish_time)
    if (!finishSec) { setError('Format waktu tidak valid.'); setEditTtSaving(false); return }
    const distKm = parseFloat(editTtForm.distance_km || '0')
    const hrAvgVal = editTtForm.hr_avg ? parseInt(editTtForm.hr_avg) : null
    const hrPartialVal = editTtForm.hr_partial_avg ? parseInt(editTtForm.hr_partial_avg) : null
    const lthrCalc = calcLthrFromTT(editTtForm.tt_type, hrAvgVal, hrPartialVal)
    const vdotVal = distKm > 0 ? calcVdot(distKm * 1000, finishSec) : null
    const { error: err } = await supabase.from('tt_history').update({
      tt_date: editTtForm.tt_date,
      tt_type: editTtForm.tt_type,
      distance_km: distKm > 0 ? distKm : 0,
      finish_time_sec: finishSec,
      hr_avg: hrAvgVal,
      hr_partial_avg: hrPartialVal,
      lthr_calculated: lthrCalc,
      vdot: vdotVal,
    }).eq('id', editTtId)
    setEditTtSaving(false)
    if (err) { setError(err.message); return }
    if (lthrCalc) {
      await supabase.from('athlete_settings').upsert(
        { athlete_id: athleteId, lthr: lthrCalc, updated_at: new Date().toISOString() },
        { onConflict: 'athlete_id' }
      )
    }
    setEditTtId(null)
    const { data } = await supabase.from('tt_history')
      .select('id,tt_date,distance_km,finish_time_sec,tt_type,hr_avg,hr_partial_avg,lthr_calculated,vdot,notes')
      .eq('athlete_id', athleteId as string).order('tt_date', { ascending: false })
    if (data) setTtList(data)
  }

  async function deleteTt(id: string) {
    if (!confirm('Hapus entri TT ini?')) return
    await supabase.from('tt_history').delete().eq('id', id)
    setTtList(prev => prev.filter(t => t.id !== id))
  }

  if (loading) return <div className="p-6"><PageHeader title="Profil & Analisis" subtitle="Memuat data..." /></div>

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 w-full max-w-[1400px] space-y-6">
      <PageHeader
        title="Profil & Analisis"
        subtitle="Data atlet, fitness scoring, prediksi race, dan efficiency metrics"
        action={!editMode ? (
          <button onClick={openEdit} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors">
            ✏️ Edit Profil
          </button>
        ) : undefined}
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      {/* ── IDENTITAS ATLET ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest mb-4 pb-2 border-b border-indigo-100">Identitas Atlet</div>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xl shrink-0">{initials}</div>
          <div>
            <div className="font-bold text-gray-800 text-xl">{athlete?.name ?? '—'}</div>
            <div className="text-sm text-gray-500">{settings.domisili ?? '—'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Usia', val: age ? `${age} tahun` : '—' },
            { label: 'Tinggi / Berat', val: `${settings.height_cm ?? '—'} cm · ${settings.weight_kg ?? '—'} kg` },
            { label: 'BMI', val: bmiData ? `${bmiData.bmi} (${bmiData.label})` : '—', color: bmiData?.color },
            { label: 'Training Age', val: taStr },
            { label: 'LTHR / MaxHR', val: `${lthrRef ?? '—'} / ${maxHR ?? '—'} bpm` },
            { label: 'HRrest (avg EWS)', val: rhrAvg ? `${rhrAvg} bpm` : '—' },
            { label: 'HR Reserve', val: hrr ? `${hrr} bpm` : '—' },
            { label: 'Status Cedera', val: settings.cedera ?? '—', color: settings.cedera === 'Tidak ada' ? '#10b981' : '#ef4444' },
          ].map(f => (
            <div key={f.label} className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs font-medium text-gray-500 mb-1">{f.label}</div>
              <div className="text-base font-bold" style={{ color: (f as {color?: string}).color ?? '#1f2937' }}>{f.val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── EDIT PROFIL ── */}
      {editMode && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Edit Profil</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              { key: 'name', label: 'Nama Lengkap', ph: 'Andita Sely Bestoro', type: 'text' },
              { key: 'whatsapp', label: 'Nomor WhatsApp', ph: '08xxxxxxxxxx', type: 'text' },
              { key: 'birth_date', label: 'Tanggal Lahir', ph: '', type: 'date' },
              { key: 'height_cm', label: 'Tinggi (cm)', ph: '164', type: 'number' },
              { key: 'weight_kg', label: 'Berat (kg)', ph: '69', type: 'number' },
              { key: 'domisili', label: 'Domisili', ph: 'Makassar', type: 'text' },
              { key: 'cedera', label: 'Status Cedera', ph: 'Tidak ada', type: 'text' },
              { key: 'start_training_date', label: 'Mulai Latihan Terprogram', ph: '', type: 'date' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input type={f.type} value={editForm[f.key] ?? ''} placeholder={f.ph}
                  onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                {f.key === 'birth_date' && editForm.birth_date && (
                  <div className="text-xs text-indigo-600 mt-1">Usia: {calcAge(editForm.birth_date)} tahun</div>
                )}
                {f.key === 'start_training_date' && editForm.start_training_date && (
                  <div className="text-xs text-indigo-600 mt-1">Training Age: {calcTrainingAge(editForm.start_training_date)}</div>
                )}
              </div>
            ))}
          </div>

          {/* Ganti Password */}
          <div className="border-t border-gray-100 pt-4 mb-4">
            <div className="text-xs font-semibold text-gray-500 mb-2">Ganti Password</div>
            <p className="text-xs text-gray-400 mb-3">Email reset password akan dikirim ke <strong>{athlete?.email}</strong>. Klik link di email untuk membuat password baru.</p>
            <button onClick={sendPasswordReset} disabled={pwLoading}
              className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors">
              {pwLoading ? 'Mengirim...' : '📧 Kirim Email Reset Password'}
            </button>
            {pwMsg && <div className="mt-2 text-xs text-gray-600">{pwMsg}</div>}
          </div>

          <div className="flex gap-3">
            <button onClick={saveProfile} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setEditMode(false)} className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200">Batal</button>
          </div>
        </section>
      )}

      {/* ── DATA PERFORMA ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest mb-4 pb-2 border-b border-indigo-100">Data Performa</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Time Trial Aktif</div>
            <div className="text-lg font-bold text-gray-700">{latestTt ? fmtTime(latestTt.finish_time_sec) : '—'}</div>
            {latestTt && <div className="text-xs text-gray-400 mt-1">{latestTt.distance_km ? `${latestTt.distance_km} km` : ''} · {new Date(latestTt.tt_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Pace TT</div>
            <div className="text-lg font-bold text-gray-700">{latestTt && latestTt.distance_km ? `${secToPace(Math.round(latestTt.finish_time_sec / latestTt.distance_km))}/km` : '—'}</div>
            <div className="text-xs text-gray-400 mt-1">Avg pace per km</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Magic Mile</div>
            <div className="text-lg font-bold text-gray-700">{latestTt && latestTt.distance_km ? `${magicMilePace(latestTt)}/km` : '—'}</div>
            <div className="text-xs text-gray-400 mt-1">Per km (Galloway)</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Easy Run Pace</div>
            <div className="text-lg font-bold text-gray-700">{easyPaceStr ? `${easyPaceStr}/km` : '—'}</div>
            <div className="text-xs text-gray-400 mt-1">Dari VDOT terbaru</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">VDOT</div>
            <div className="text-lg font-bold text-gray-700">{vdot?.toFixed(1) ?? '—'}</div>
            {vdot && (
              <div className="mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{vdotRel.icon} {vdotRel.label}</span>
                <div className="text-xs italic text-gray-400 mt-1 leading-tight">{vdotRel.note}</div>
              </div>
            )}
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">LTHR</div>
            <div className="text-lg font-bold text-gray-700">{lthrRef ? `${lthrRef} bpm` : '—'}</div>
            <div className="text-xs text-gray-400 mt-1">{lthrFromTt ? 'Dari Time Trial' : 'Joe Friel reference'}</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 col-span-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Long Run Terakhir</div>
            <div className="text-base font-bold text-gray-700">{lrStr}</div>
            <div className="text-xs text-gray-400 mt-1">Sesi ≥10 km atau ≥90 menit</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 col-span-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Status Cedera</div>
            <div className="text-lg font-extrabold" style={{ color: settings.cedera === 'Tidak ada' ? '#10b981' : '#ef4444' }}>
              {settings.cedera === 'Tidak ada' ? '✅ Tidak Ada' : `⚠️ ${settings.cedera ?? '—'}`}
            </div>
          </div>
        </div>
      </section>

            {/* ── PREDICTED HM ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest mb-4 pb-2 border-b border-indigo-100">Predicted HM</div>
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Predicted Finish</div>
          <div className="text-4xl font-extrabold text-gray-800">{predHmSec ? fmtTime(Math.round(predHmSec)) : '—:—:—'}</div>
          {predHmSec && <div className="text-sm text-gray-400 mt-1">{secToPace(Math.round(predHmSec / 21.0975))}/km · HM 21.1 km</div>}
        </div>
        <div className="space-y-3">
          {RACE_TARGETS.map(rt => {
            const gap = predHmSec ? predHmSec - rt.target : null
            const gapMm = gap != null ? Math.floor(Math.abs(gap) / 60) : 0
            const gapSs = gap != null ? Math.round(Math.abs(gap) % 60) : 0
            const gapStr = gap == null ? '—' : gap <= 0 ? `✅ +${gapMm}:${String(gapSs).padStart(2,'0')}` : `⚠ -${gapMm}:${String(gapSs).padStart(2,'0')}`
            const bc = gap != null && gap <= 0 ? '#10b981' : '#f59e0b'
            const prog = predHmSec ? Math.min(100, Math.max(0, Math.round(((rt.target * 1.15) - predHmSec) / (rt.target * 0.15) * 100))) : 0
            return (
              <div key={rt.label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-gray-600">{rt.label}</span>
                  <span className="text-xs font-bold" style={{ color: bc }}>{gapStr}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full"><div className="h-full rounded-full transition-all" style={{ width: `${prog}%`, background: bc }} /></div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── EFFICIENCY & ECONOMY ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest mb-4 pb-2 border-b border-indigo-100">Efficiency &amp; Economy</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">⚡ Efficiency Factor (EF)</div>
            {ef ? (
              <>
                <div className="text-3xl font-extrabold" style={{ color: ef.color }}>{ef.current.toFixed(2)}</div>
                <div className="text-xs text-gray-400 mt-1">EF = (1000/pace_sec)/avg_HR×100</div>
                <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: ef.color + '22', color: ef.color }}>{ef.label}</span>
                <div className="text-xs text-gray-300 mt-1">Referensi Coggan &amp; Allen</div>
              </>
            ) : <p className="text-sm text-gray-400 mt-2">Belum ada sesi easy/LR dengan data HR &amp; pace.</p>}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-700 mb-2">📊 Performance Efficiency Score</div>
            {pes ? (
              <>
                <div className="text-3xl font-extrabold" style={{ color: pes.color }}>{pes.pes}</div>
                <div className="text-xs text-gray-400 mt-1">Performance Efficiency Score (0–100)</div>
                <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: pes.color + '22', color: pes.color }}>{pes.label}</span>
                <div className="text-xs text-gray-500 mt-2 mb-3">{pes.msg}</div>
                <div className="space-y-2">
                  {([['Pace-HR Ratio','40%',pes.phrNorm,'Coggan EF'],['TRIMP Efficiency','25%',pes.teNorm,'Banister'],['RHR Trend','20%',pes.rhrNorm,'Cardiac proxy'],['Z1-Z2 Dist.','15%',pes.z12Norm,'Seiler 80/20']] as [string,string,number,string][]).map(([l,w,v,r]) => (
                    <div key={l}>
                      <div className="flex justify-between text-xs text-gray-500 mb-0.5"><span>{l} <span className="text-gray-300">({w})</span></span><span>{v}%</span></div>
                      <div className="h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${v}%` }} /></div>
                      <div className="text-xs text-gray-300">{r}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-gray-400 mt-2">Minimal 3 sesi latihan diperlukan.</p>}
          </div>
        </div>
      </section>

      {/* ── TIME TRIAL HISTORY ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Time Trial History</div>
          <button onClick={() => { setShowTtForm(v => !v); setError(null) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            {showTtForm ? 'Batal' : '+ Tambah TT'}
          </button>
        </div>

        {showTtForm && (() => {
          const activeTtType = TT_TYPES.find(t => t.value === ttForm.tt_type)
          const distKm = parseFloat(ttForm.distance_km || '0')
          const finishSec = parseTimeToSec(ttForm.finish_time)
          const hrAvgVal = ttForm.hr_avg ? parseInt(ttForm.hr_avg) : null
          const hrPartialVal = ttForm.hr_partial_avg ? parseInt(ttForm.hr_partial_avg) : null
          const previewPace = (distKm > 0 && finishSec) ? secToPace(Math.round(finishSec / distKm)) : null
          const previewVdot = (distKm > 0 && finishSec) ? calcVdot(distKm * 1000, finishSec) : null
          const previewLthr = calcLthrFromTT(ttForm.tt_type, hrAvgVal, hrPartialVal)
          return (
          <div className="mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tanggal</label>
                <input type="date" value={ttForm.tt_date} onChange={e => setTtForm(p => ({ ...p, tt_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Jenis Time Trial</label>
                <select value={ttForm.tt_type} onChange={e => onTtTypeChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {TT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label} — {t.race}</option>
                  ))}
                </select>
                {activeTtType && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    <span className="text-xs text-indigo-500">{activeTtType.hint}</span>
                    <span className="text-xs font-semibold text-green-600">📍 {activeTtType.race}</span>
                    <span className="text-xs font-semibold text-amber-600">🎯 {activeTtType.accuracy}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jarak (km)</label>
                <input type="number" step="0.01" value={ttForm.distance_km} placeholder="5.0"
                  onChange={e => setTtForm(p => ({ ...p, distance_km: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Total Waktu (MM:SS atau HH:MM:SS)</label>
                <input type="text" value={ttForm.finish_time} placeholder="20:00"
                  onChange={e => setTtForm(p => ({ ...p, finish_time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Avg HR (bpm)</label>
                <input type="number" value={ttForm.hr_avg} placeholder="165"
                  onChange={e => setTtForm(p => ({ ...p, hr_avg: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              {needsPartial && (
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs text-gray-500 mb-1">{needsPartial}</label>
                  <input type="number" value={ttForm.hr_partial_avg} placeholder="172"
                    onChange={e => setTtForm(p => ({ ...p, hr_partial_avg: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              )}
            </div>

            {/* Preview Real-time */}
            <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <div className="text-center">
                <div className="text-xs font-medium text-gray-500 mb-1">Avg Pace</div>
                <div className="text-lg font-extrabold text-indigo-700">{previewPace ? `${previewPace}/km` : '—'}</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-medium text-gray-500 mb-1">VDOT</div>
                <div className="text-lg font-extrabold text-indigo-700">{previewVdot ?? '—'}</div>
              </div>
              <div className="text-center">
                <div className="text-xs font-medium text-gray-500 mb-1">LTHR</div>
                <div className="text-lg font-extrabold text-red-600">{previewLthr ? `${previewLthr} bpm` : '—'}</div>
              </div>
            </div>

            <button onClick={saveTt} disabled={ttSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {ttSaving ? 'Menyimpan...' : 'Simpan TT'}
            </button>
          </div>
          )
        })()}

        {ttList.length === 0 ? (
          <EmptyState title="Belum ada time trial" description="Input TT untuk menghitung VDOT dan LTHR otomatis." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  {['Tanggal','Jenis TT','Waktu','Pace','Pred. HM','VDOT','Magic Mile','LTHR',''].map(h => (
                    <th key={h} className="text-left py-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ttList.map((tt, idx) => {
                  const isActive = idx === 0
                  const predHm = tt.distance_km ? predictTime(tt.distance_km * 1000, tt.finish_time_sec, 21097.5) : null
                  const pace = tt.distance_km ? secToPace(Math.round(tt.finish_time_sec / tt.distance_km)) : '—'
                  const isEditing = editTtId === tt.id
                  const editType = TT_TYPES.find(t => t.value === editTtForm.tt_type)
                  const editFinishSec = isEditing ? parseTimeToSec(editTtForm.finish_time) : null
                  const editDistKm = isEditing ? parseFloat(editTtForm.distance_km || '0') : 0
                  const editHrAvg = isEditing && editTtForm.hr_avg ? parseInt(editTtForm.hr_avg) : null
                  const editHrPartial = isEditing && editTtForm.hr_partial_avg ? parseInt(editTtForm.hr_partial_avg) : null
                  const editPreviewPace = (editDistKm > 0 && editFinishSec) ? secToPace(Math.round(editFinishSec / editDistKm)) : null
                  const editPreviewVdot = (editDistKm > 0 && editFinishSec) ? calcVdot(editDistKm * 1000, editFinishSec) : null
                  const editPreviewLthr = isEditing ? calcLthrFromTT(editTtForm.tt_type, editHrAvg, editHrPartial) : null
                  const editNeedsPartial = editType?.partialLabel ?? null
                  return (
                    <>
                    <tr key={tt.id} className={`border-b border-gray-50 ${isActive ? 'bg-blue-50' : ''} ${isEditing ? 'bg-yellow-50' : ''}`}>
                      <td className="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(tt.tt_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {isActive && <div className="text-blue-600 font-bold text-xs">▶ Aktif</div>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <div className="text-xs font-semibold text-gray-700">{TT_TYPES.find(t => t.value === tt.tt_type)?.label ?? tt.tt_type ?? '—'}</div>
                        <div className="text-xs text-green-600">{TT_TYPES.find(t => t.value === tt.tt_type)?.race ?? ''}</div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-sm">{fmtTime(tt.finish_time_sec)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-sm">{pace}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-sm">{predHm ? fmtTime(Math.round(predHm)) : '—'}</td>
                      <td className="py-2 pr-3 font-bold text-indigo-600 text-sm">{tt.vdot ?? '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-sm">{tt.distance_km ? magicMilePace(tt) : '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {tt.lthr_calculated ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{tt.lthr_calculated} bpm</span> : '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <button onClick={() => isEditing ? setEditTtId(null) : openEditTt(tt)} className="text-xs text-indigo-400 hover:text-indigo-600 mr-2">{isEditing ? 'Batal' : 'Edit'}</button>
                        <button onClick={() => deleteTt(tt.id)} className="text-xs text-red-400 hover:text-red-600">Hapus</button>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr key={`edit-${tt.id}`} className="bg-yellow-50 border-b border-yellow-100">
                        <td colSpan={9} className="px-3 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Tanggal</label>
                              <input type="date" value={editTtForm.tt_date} onChange={e => setEditTtForm(p => ({ ...p, tt_date: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Jenis TT</label>
                              <select value={editTtForm.tt_type} onChange={e => setEditTtForm(p => ({ ...p, tt_type: e.target.value, hr_partial_avg: '' }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                                {TT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label} — {t.race}</option>)}
                              </select>
                              {editType && <div className="text-xs text-amber-600 mt-1">🎯 {editType.accuracy}</div>}
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Jarak (km)</label>
                              <input type="number" step="0.01" value={editTtForm.distance_km} onChange={e => setEditTtForm(p => ({ ...p, distance_km: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Total Waktu</label>
                              <input type="text" value={editTtForm.finish_time} onChange={e => setEditTtForm(p => ({ ...p, finish_time: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Avg HR (bpm)</label>
                              <input type="number" value={editTtForm.hr_avg} onChange={e => setEditTtForm(p => ({ ...p, hr_avg: e.target.value }))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            {editNeedsPartial && (
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">{editNeedsPartial}</label>
                                <input type="number" value={editTtForm.hr_partial_avg} onChange={e => setEditTtForm(p => ({ ...p, hr_partial_avg: e.target.value }))}
                                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                              </div>
                            )}
                          </div>
                          <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                            <div className="text-center">
                              <div className="text-xs font-medium text-gray-500 mb-1">Avg Pace</div>
                              <div className="text-base font-extrabold text-indigo-700">{editPreviewPace ? `${editPreviewPace}/km` : '—'}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs font-medium text-gray-500 mb-1">VDOT</div>
                              <div className="text-base font-extrabold text-indigo-700">{editPreviewVdot ?? '—'}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs font-medium text-gray-500 mb-1">LTHR</div>
                              <div className="text-base font-extrabold text-red-600">{editPreviewLthr ? `${editPreviewLthr} bpm` : '—'}</div>
                            </div>
                          </div>
                          <button onClick={saveEditTt} disabled={editTtSaving}
                            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            {editTtSaving ? 'Menyimpan...' : 'Simpan Perubahan'}
                          </button>
                        </td>
                      </tr>
                    )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── HEAT STRESS INDEX ── */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest mb-4 pb-2 border-b border-indigo-100">🌡️ Heat Stress Index</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><label>Suhu (°C)</label><span className="font-semibold">{hsiState.temp}°C</span></div>
              <input type="range" min={15} max={45} step={0.5} value={hsiState.temp} onChange={e => setHsiState(s => ({ ...s, temp: parseFloat(e.target.value) }))} className="w-full accent-indigo-600" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><label>Kelembaban (%)</label><span className="font-semibold">{hsiState.rh}%</span></div>
              <input type="range" min={20} max={100} step={1} value={hsiState.rh} onChange={e => setHsiState(s => ({ ...s, rh: parseInt(e.target.value) }))} className="w-full accent-indigo-600" />
            </div>
            <div className={`inline-block text-sm font-bold px-3 py-1 rounded-full ${hsi.cls === 'safe' ? 'bg-green-100 text-green-700' : hsi.cls === 'low' ? 'bg-yellow-100 text-yellow-700' : hsi.cls === 'mod' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
              {hsi.emoji} WBGT {hsi.wbgt}°C — {hsi.risk}
            </div>
          </div>
          <div>
            <table className="w-full text-xs text-gray-600 mb-2">
              <thead><tr className="text-gray-400 border-b border-gray-100"><th className="text-left py-1 pr-3">Zona</th><th className="text-right py-1">Penyesuaian Pace</th></tr></thead>
              <tbody>
                {Object.entries(hsi.penalties).map(([zone, pen]) => {
                  const base = basePaces[zone] ?? null
                  return (
                    <tr key={zone} className="border-b border-gray-50">
                      <td className="py-1 pr-3">{zone}</td>
                      <td className="py-1 text-right">+{pen} det/km → <strong>{base ? secToPace(base + pen) : '—'}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="text-xs text-gray-400">HR drift estimasi: +{hsi.hrDrift} bpm · Ref: Moran et al. (2004)</div>
            {hsi.hrDrift > 8 && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
                ⚠️ HR drift tinggi — <strong>prioritaskan HR bukan pace</strong> saat lari hari ini.
              </div>
            )}
          </div>
        </div>
      </section>

    </div>
  )
}
