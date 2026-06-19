import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface AthleteSettings {
  lthr: number | null
  easy_pace_min: number | null
  easy_pace_sec: number | null
  resting_hr: number | null
  max_hr: number | null
  weight_kg: number | null
  height_cm: number | null
  training_age_years: number | null
  domisili: string | null
  birth_date: string | null
  cedera: string | null
  start_training_date: string | null
  lr_distance_km: number | null
  lr_pace_min: number | null
  lr_pace_sec: number | null
}

interface TtEntry {
  id: string
  tt_date: string
  distance_km: number
  finish_time_sec: number
  vdot: number | null
  hr_avg: number | null
  notes: string | null
}

interface TrainingSession {
  session_date: string
  session_type: string | null
  pace_avg_min: number | null
  pace_avg_sec: number | null
  hr_avg: number | null
  trimp: number | null
  duration_sec: number | null
}

interface HrHistoryEntry {
  hr_type: string | null
  hr_value: number
  recorded_date: string
}

function calcVdot(distanceM: number, finishTimeSec: number): number {
  const v = distanceM / finishTimeSec * 60
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
  const pctVo2 = 0.8 + 0.1894393 * Math.exp(-0.012778 * finishTimeSec / 60)
               + 0.2989558 * Math.exp(-0.1932605 * finishTimeSec / 60)
  return parseFloat((vo2 / pctVo2).toFixed(1))
}

function vdotToPaces(vdot: number) {
  const zones = [
    { name: 'Easy', pct: 0.65 },
    { name: 'Tempo', pct: 0.88 },
    { name: 'SubLT', pct: 0.92 },
    { name: 'VO2max', pct: 0.98 },
    { name: 'Race (HM)', pct: 0.855 },
  ]
  const result: Record<string, number> = {}
  for (const z of zones) {
    let lo = 100, hi = 600
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      const vo2atV = -4.60 + 0.182258 * mid + 0.000104 * mid * mid
      if (vo2atV / vdot < z.pct) lo = mid; else hi = mid
    }
    result[z.name] = Math.round(1000 / ((lo + hi) / 2) * 60)
  }
  return result
}

function easyPaceFromVdot(vdot: number): string {
  const paces = vdotToPaces(vdot)
  return secToPace(paces['Easy'])
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

function calcBmi(heightCm: number, weightKg: number) {
  const bmi = weightKg / Math.pow(heightCm / 100, 2)
  const label = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'
  const color = bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444'
  return { bmi: bmi.toFixed(1), label, color }
}

function calcAge(birthDate: string): number {
  const today = new Date()
  const dob = new Date(birthDate)
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

function calcTrainingAge(startDate: string | null): { years: number; months: number; total: number } {
  if (!startDate) return { years: 0, months: 0, total: 0 }
  const start = new Date(startDate)
  const now = new Date()
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  return { years: Math.floor(months / 12), months: months % 12, total: months / 12 }
}

function getVdotReliability(taYears: number) {
  if (taYears < 2) return { icon: '🔴', label: 'Akurasi ±8%', note: 'Running economy masih berkembang. Potensi aktual bisa 5–10% lebih baik dari VDOT.' }
  if (taYears < 5) return { icon: '🟡', label: 'Akurasi ±5%', note: 'Running economy cukup stabil. Potensi aktual mungkin 2–5% lebih baik.' }
  return { icon: '🟢', label: 'Akurasi ±3%', note: 'Running economy sudah mature. VDOT mencerminkan potensi realistis.' }
}

function calcEF(sessions: TrainingSession[]) {
  const easyLR = sessions.filter(s => s.session_type === 'Easy' || s.session_type === 'LR')
  const valid = easyLR.filter(s => s.pace_avg_min != null && s.hr_avg != null && s.hr_avg > 0)
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
  const withPaceHr = sessions.filter(s => s.pace_avg_min != null && s.hr_avg != null && s.hr_avg > 0)
  if (!withPaceHr.length) return null
  const avgEf = withPaceHr.reduce((acc, s) => {
    const paceSec = (s.pace_avg_min! * 60) + (s.pace_avg_sec ?? 0)
    return acc + (paceSec > 0 ? (1000 / paceSec) / s.hr_avg! * 100 : 0)
  }, 0) / withPaceHr.length
  const phrNorm = Math.min(100, Math.round(avgEf / 1.4 * 100))
  const withTrimp = sessions.filter(s => s.trimp)
  const avgTrimp = withTrimp.length ? withTrimp.reduce((a, s) => a + s.trimp!, 0) / withTrimp.length : 0
  const teNorm = Math.min(100, Math.round(avgTrimp / 80 * 100))
  const rhrNorm = 70
  const z12 = sessions.filter(s => s.session_type === 'Easy' || s.session_type === 'LR').length
  const z12Norm = Math.min(100, Math.round(z12 / sessions.length * 100))
  const pes = Math.round(phrNorm * 0.4 + teNorm * 0.25 + rhrNorm * 0.2 + z12Norm * 0.15)
  const color = pes >= 80 ? '#10b981' : pes >= 60 ? '#3b82f6' : pes >= 40 ? '#f59e0b' : '#ef4444'
  const label = pes >= 80 ? 'Excellent' : pes >= 60 ? 'Baik' : pes >= 40 ? 'Cukup' : 'Perlu Ditingkatkan'
  const msg = pes >= 80 ? 'Efisiensi latihan sangat baik.' : pes >= 60 ? 'Latihan cukup efisien, ada ruang peningkatan.' : 'Fokus pada sesi easy dan konsistensi.'
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

const TT_DISTANCES = [
  { label: 'Magic Mile (1.6 km)', value: 1.6 },
  { label: '5K', value: 5.0 },
  { label: '10K', value: 10.0 },
  { label: 'Half Marathon', value: 21.0975 },
]

const RACE_TARGETS = [
  { label: '🏁 Maybank <2:30', target: 9000, color: '#6366f1' },
  { label: '⭐ Pocari <2:15', target: 8100, color: '#f59e0b' },
]

const emptySettings: AthleteSettings = {
  lthr: null, easy_pace_min: null, easy_pace_sec: null,
  resting_hr: null, max_hr: null, weight_kg: null,
  height_cm: null, training_age_years: null, domisili: null,
  birth_date: null, cedera: null, start_training_date: null,
  lr_distance_km: null, lr_pace_min: null, lr_pace_sec: null,
}

export default function ProfilPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id
  const cancelledRef = useRef(false)

  const [settings, setSettings] = useState<AthleteSettings>(emptySettings)
  const [ttList, setTtList] = useState<TtEntry[]>([])
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [hrHistory, setHrHistory] = useState<HrHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showTtForm, setShowTtForm] = useState(false)
  const [ttForm, setTtForm] = useState({
    tt_date: new Date().toISOString().split('T')[0],
    distance_km: '5.0', finish_time: '', hr_avg: '', notes: '',
  })
  const [ttSaving, setTtSaving] = useState(false)
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
      const [sRes, ttRes, sesRes, hrRes] = await Promise.all([
        supabase.from('athlete_settings')
          .select('lthr,easy_pace_min,easy_pace_sec,resting_hr,max_hr,weight_kg,height_cm,training_age_years,domisili,birth_date,cedera,start_training_date,lr_distance_km,lr_pace_min,lr_pace_sec')
          .eq('athlete_id', athleteId as string).maybeSingle(),
        supabase.from('tt_history')
          .select('id,tt_date,distance_km,finish_time_sec,vdot,hr_avg,notes')
          .eq('athlete_id', athleteId as string).order('tt_date', { ascending: false }),
        supabase.from('training_sessions')
          .select('session_date,session_type,pace_avg_min,pace_avg_sec,hr_avg,trimp,duration_sec')
          .eq('athlete_id', athleteId as string).order('session_date', { ascending: false }).limit(90),
        supabase.from('hr_history')
          .select('hr_type,hr_value,recorded_date')
          .eq('athlete_id', athleteId as string).order('recorded_date', { ascending: false }).limit(20),
      ])
      if (cancelled) return
      if (sRes.data) setSettings(sRes.data as AthleteSettings)
      if (ttRes.data) setTtList(ttRes.data)
      if (sesRes.data) setSessions(sesRes.data)
      if (hrRes.data) setHrHistory(hrRes.data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [athleteId])

  const latestTt = ttList[0] ?? null
  const vdot = latestTt?.vdot ?? null
  const taFromStart = calcTrainingAge(settings.start_training_date)
  const taYears = settings.start_training_date ? taFromStart.total : (settings.training_age_years ?? 0)
  const taStr = settings.start_training_date
    ? (taFromStart.years > 0 ? `${taFromStart.years} tahun${taFromStart.months > 0 ? ' ' + taFromStart.months + ' bulan' : ''}` : `${taFromStart.months} bulan`)
    : (settings.training_age_years ? `${settings.training_age_years} tahun` : '—')

  const age = settings.birth_date ? calcAge(settings.birth_date) : null
  const bmiData = (settings.height_cm && settings.weight_kg) ? calcBmi(settings.height_cm, settings.weight_kg) : null
  const lthrRef = hrHistory.find(h => h.hr_type === 'lthr')?.hr_value ?? settings.lthr
  const rhrValues = hrHistory.filter(h => h.hr_type === 'rhr').map(h => h.hr_value)
  const rhrAvg = rhrValues.length ? Math.round(rhrValues.reduce((a, b) => a + b, 0) / rhrValues.length) : (settings.resting_hr ?? null)
  const maxHR = settings.max_hr ?? (lthrRef ? Math.round(lthrRef / 0.88) : null)
  const hrr = (lthrRef && rhrAvg && maxHR) ? maxHR - rhrAvg : null
  const predHmSec = latestTt ? predictTime(latestTt.distance_km * 1000, latestTt.finish_time_sec, 21097.5) : null
  const pred10kSec = latestTt ? predictTime(latestTt.distance_km * 1000, latestTt.finish_time_sec, 10000) : null
  const vdotRel = getVdotReliability(taYears)
  const ef = calcEF(sessions)
  const pes = calcPES(sessions)
  const easyPaceStr = vdot ? easyPaceFromVdot(vdot) : (settings.easy_pace_min != null && settings.easy_pace_sec != null ? `${settings.easy_pace_min}:${String(settings.easy_pace_sec).padStart(2, '0')}` : null)
  const basePaces: Record<string, number> = vdot ? vdotToPaces(vdot) : {}
  const hsi = calcHSI(hsiState.temp, hsiState.rh)
  const lrStr = (settings.lr_distance_km && settings.lr_pace_min != null) ? `${settings.lr_distance_km} km @ ${settings.lr_pace_min}:${String(settings.lr_pace_sec ?? 0).padStart(2, '0')}/km` : '—'
  const initials = (athlete?.name ?? 'A').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()

  function openEdit() {
    setSettingsForm({
      lthr: settings.lthr?.toString() ?? '',
      resting_hr: settings.resting_hr?.toString() ?? '',
      max_hr: settings.max_hr?.toString() ?? '',
      easy_pace_min: settings.easy_pace_min?.toString() ?? '',
      easy_pace_sec: settings.easy_pace_sec?.toString() ?? '',
      weight_kg: settings.weight_kg?.toString() ?? '',
      height_cm: settings.height_cm?.toString() ?? '',
      training_age_years: settings.training_age_years?.toString() ?? '',
      domisili: settings.domisili ?? '',
      birth_date: settings.birth_date ?? '',
      cedera: settings.cedera ?? 'Tidak ada',
      start_training_date: settings.start_training_date ?? '',
      lr_distance_km: settings.lr_distance_km?.toString() ?? '',
      lr_pace_min: settings.lr_pace_min?.toString() ?? '',
      lr_pace_sec: settings.lr_pace_sec?.toString() ?? '',
    })
    setEditMode(true)
  }

  async function saveSettings() {
    if (!athleteId) return
    setSaving(true); setError(null)
    const p = settingsForm
    const payload = {
      athlete_id: athleteId,
      lthr: p.lthr ? parseInt(p.lthr) : null,
      resting_hr: p.resting_hr ? parseInt(p.resting_hr) : null,
      max_hr: p.max_hr ? parseInt(p.max_hr) : null,
      easy_pace_min: p.easy_pace_min ? parseInt(p.easy_pace_min) : null,
      easy_pace_sec: p.easy_pace_sec ? parseInt(p.easy_pace_sec) : null,
      weight_kg: p.weight_kg ? parseFloat(p.weight_kg) : null,
      height_cm: p.height_cm ? parseInt(p.height_cm) : null,
      training_age_years: p.training_age_years ? parseInt(p.training_age_years) : null,
      domisili: p.domisili || null,
      birth_date: p.birth_date || null,
      cedera: p.cedera || 'Tidak ada',
      start_training_date: p.start_training_date || null,
      lr_distance_km: p.lr_distance_km ? parseFloat(p.lr_distance_km) : null,
      lr_pace_min: p.lr_pace_min ? parseInt(p.lr_pace_min) : null,
      lr_pace_sec: p.lr_pace_sec ? parseInt(p.lr_pace_sec) : null,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = await supabase.from('athlete_settings').upsert(payload, { onConflict: 'athlete_id' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditMode(false)
    const { data } = await supabase.from('athlete_settings')
      .select('lthr,easy_pace_min,easy_pace_sec,resting_hr,max_hr,weight_kg,height_cm,training_age_years,domisili,birth_date,cedera,start_training_date,lr_distance_km,lr_pace_min,lr_pace_sec')
      .eq('athlete_id', athleteId as string).maybeSingle()
    if (data) setSettings(data as AthleteSettings)
  }

  async function saveTt() {
    if (!athleteId) return
    setError(null)
    const finishSec = parseTimeToSec(ttForm.finish_time)
    if (!finishSec) { setError('Format waktu tidak valid. Gunakan MM:SS atau HH:MM:SS.'); return }
    const distM = parseFloat(ttForm.distance_km) * 1000
    const vdotVal = calcVdot(distM, finishSec)
    setTtSaving(true)
    const { error: err } = await supabase.from('tt_history').insert({
      athlete_id: athleteId,
      tt_date: ttForm.tt_date,
      distance_km: parseFloat(ttForm.distance_km),
      finish_time_sec: finishSec,
      vdot: vdotVal,
      hr_avg: ttForm.hr_avg ? parseInt(ttForm.hr_avg) : null,
      notes: ttForm.notes || null,
    })
    setTtSaving(false)
    if (err) { setError(err.message); return }
    setTtForm({ tt_date: new Date().toISOString().split('T')[0], distance_km: '5.0', finish_time: '', hr_avg: '', notes: '' })
    setShowTtForm(false)
    const { data } = await supabase.from('tt_history').select('id,tt_date,distance_km,finish_time_sec,vdot,hr_avg,notes').eq('athlete_id', athleteId as string).order('tt_date', { ascending: false })
    if (data) setTtList(data)
  }

  async function deleteTt(id: string) {
    if (!confirm('Hapus entri TT ini?')) return
    await supabase.from('tt_history').delete().eq('id', id)
    setTtList(prev => prev.filter(t => t.id !== id))
  }

  if (loading) return <div className="p-6"><PageHeader title="Profil & Analisis" subtitle="Memuat data..." /></div>

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <PageHeader
        title="Profil & Analisis"
        subtitle="Data atlet, fitness scoring, prediksi race, dan efficiency metrics"
        action={!editMode ? (
          <button onClick={openEdit} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2">
            ✏️ Edit Profil
          </button>
        ) : undefined}
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

      {/* IDENTITAS ATLET */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Identitas Atlet</div>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shrink-0">{initials}</div>
          <div>
            <div className="font-bold text-gray-800 text-lg">{athlete?.name ?? '—'}</div>
            <div className="text-sm text-gray-500">{settings.domisili ?? '—'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Usia', val: age ? `${age} thn` : '—' },
            { label: 'Tinggi / Berat', val: `${settings.height_cm ?? '—'} cm · ${settings.weight_kg ?? '—'} kg` },
            { label: 'BMI', val: bmiData ? `${bmiData.bmi} (${bmiData.label})` : '—', color: bmiData?.color },
            { label: 'Training Age', val: taStr },
            { label: 'LTHR / MaxHR', val: `${lthrRef ?? '—'} / ${maxHR ?? '—'} bpm` },
            { label: 'HRrest (avg EWS)', val: rhrAvg ? `${rhrAvg} bpm` : '—' },
            { label: 'HR Reserve', val: hrr ? `${hrr} bpm` : '—' },
            { label: 'Status Cedera', val: settings.cedera ?? '—', color: settings.cedera === 'Tidak ada' ? '#10b981' : '#ef4444' },
          ].map(f => (
            <div key={f.label} className="bg-gray-50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">{f.label}</div>
              <div className="text-sm font-semibold" style={{ color: (f as {color?: string}).color ?? '#1f2937' }}>{f.val}</div>
            </div>
          ))}
        </div>
      </section>

      {/* EDIT FORM */}
      {editMode && (
        <section className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Edit Profil</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tanggal Lahir</label>
              <input type="date" value={settingsForm.birth_date ?? ''} onChange={e => setSettingsForm(p => ({ ...p, birth_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              {settingsForm.birth_date && <div className="text-xs text-indigo-600 mt-1">Usia saat ini: {calcAge(settingsForm.birth_date)} tahun</div>}
            </div>
            {[
              { key: 'lthr', label: 'LTHR (bpm)', ph: '160' },
              { key: 'resting_hr', label: 'HR Rest (bpm)', ph: '48' },
              { key: 'max_hr', label: 'HR Max (bpm)', ph: '185' },
              { key: 'easy_pace_min', label: 'Easy Pace (menit)', ph: '7' },
              { key: 'easy_pace_sec', label: 'Easy Pace (detik)', ph: '30' },
              { key: 'weight_kg', label: 'Berat (kg)', ph: '69' },
              { key: 'height_cm', label: 'Tinggi (cm)', ph: '164' },
              { key: 'training_age_years', label: 'Training Age (tahun)', ph: '6' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input type="number" value={settingsForm[f.key] ?? ''} placeholder={f.ph}
                  onChange={e => setSettingsForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status Cedera</label>
              <input type="text" value={settingsForm.cedera ?? ''} placeholder="Tidak ada"
                onChange={e => setSettingsForm(p => ({ ...p, cedera: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mulai Latihan Terprogram</label>
              <input type="date" value={settingsForm.start_training_date ?? ''} onChange={e => setSettingsForm(p => ({ ...p, start_training_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Long Run Terakhir (km)</label>
              <input type="number" value={settingsForm.lr_distance_km ?? ''} placeholder="12.6"
                onChange={e => setSettingsForm(p => ({ ...p, lr_distance_km: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">LR Pace (menit)</label>
              <input type="number" value={settingsForm.lr_pace_min ?? ''} placeholder="7"
                onChange={e => setSettingsForm(p => ({ ...p, lr_pace_min: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">LR Pace (detik)</label>
              <input type="number" value={settingsForm.lr_pace_sec ?? ''} placeholder="56"
                onChange={e => setSettingsForm(p => ({ ...p, lr_pace_sec: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-gray-500 mb-1">Domisili</label>
              <input type="text" value={settingsForm.domisili ?? ''} placeholder="Makassar"
                onChange={e => setSettingsForm(p => ({ ...p, domisili: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={saveSettings} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setEditMode(false)} className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200">Batal</button>
          </div>
        </section>
      )}

      {/* DATA PERFORMA */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Data Performa</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-gray-100">
          <div className="space-y-3 md:pr-6 pb-4 md:pb-0">
            {[
              { label: 'Time Trial Aktif', val: latestTt ? `${latestTt.distance_km}K — ${fmtTime(latestTt.finish_time_sec)}` : '—', note: latestTt ? new Date(latestTt.tt_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Tambahkan TT via tombol di bawah' },
              { label: 'Pace TT', val: latestTt ? secToPace(Math.round(latestTt.finish_time_sec / latestTt.distance_km)) : '—', note: 'Avg pace per km' },
              { label: 'Predicted HM', val: predHmSec ? fmtTime(Math.round(predHmSec)) : '—', note: 'Riegel formula' },
              { label: 'Predicted 10K', val: pred10kSec ? fmtTime(Math.round(pred10kSec)) : '—', note: 'Riegel formula' },
              { label: 'Magic Mile', val: latestTt ? magicMilePace(latestTt) : '—', note: 'Per km (Galloway)' },
            ].map(f => (
              <div key={f.label} className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-gray-400">{f.label}</div>
                  <div className="text-xs text-gray-300">{f.note}</div>
                </div>
                <div className="text-sm font-semibold text-gray-800">{f.val}</div>
              </div>
            ))}
          </div>
          <div className="space-y-3 md:pl-6 pt-4 md:pt-0">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs text-gray-400">VDOT</div>
                <div className="text-xs text-gray-300">{vdotRel.note}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-800">{vdot?.toFixed(1) ?? '—'}</div>
                {vdot && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-semibold">{vdotRel.icon} {vdotRel.label}</span>}
              </div>
            </div>
            {[
              { label: 'Easy Run Pace', val: easyPaceStr ? `${easyPaceStr}/km` : '—', note: 'Aerobic base pace' },
              { label: 'Long Run Terakhir', val: lrStr, note: '' },
              { label: 'LTHR', val: lthrRef ? `${lthrRef} bpm` : '—', note: 'Joe Friel reference' },
              { label: 'Status Cedera', val: settings.cedera ?? '—', note: settings.cedera === 'Tidak ada' ? '✅ Aman progressive overload' : '⚠️ Monitor cedera', color: settings.cedera === 'Tidak ada' ? '#10b981' : '#ef4444' },
            ].map(f => (
              <div key={f.label} className="flex justify-between items-start">
                <div>
                  <div className="text-xs text-gray-400">{f.label}</div>
                  {f.note && <div className="text-xs text-gray-300">{f.note}</div>}
                </div>
                <div className="text-sm font-semibold" style={{ color: (f as {color?: string}).color ?? '#1f2937' }}>{f.val}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PREDICTED HM */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Predicted HM</div>
        <div className="mb-4">
          <div className="text-xs text-gray-400 mb-1">Predicted Finish</div>
          <div className="text-3xl font-extrabold text-gray-800">{predHmSec ? fmtTime(Math.round(predHmSec)) : '—:—:—'}</div>
          {predHmSec && <div className="text-sm text-gray-400 mt-1">{secToPace(Math.round(predHmSec / 21.0975))}/km · HM 21.1 km</div>}
        </div>
        <div className="space-y-3">
          {RACE_TARGETS.map(rt => {
            const gap = predHmSec ? predHmSec - rt.target : null
            const gapMm = gap != null ? Math.floor(Math.abs(gap) / 60) : 0
            const gapSs = gap != null ? Math.round(Math.abs(gap) % 60) : 0
            const gapStr = gap == null ? '—' : gap <= 0 ? `✅ +${gapMm}:${String(gapSs).padStart(2, '0')}` : `⚠ -${gapMm}:${String(gapSs).padStart(2, '0')}`
            const bc = gap != null && gap <= 0 ? '#10b981' : '#f59e0b'
            const prog = predHmSec ? Math.min(100, Math.max(0, Math.round(((rt.target * 1.15) - predHmSec) / (rt.target * 0.15) * 100))) : 0
            return (
              <div key={rt.label}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-gray-600">{rt.label}</span>
                  <span className="text-xs font-bold" style={{ color: bc }}>{gapStr}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div className="h-full rounded-full transition-all" style={{ width: `${prog}%`, background: bc }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* EFFICIENCY & ECONOMY */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">Efficiency &amp; Economy</div>
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
            ) : <p className="text-sm text-gray-400">Belum ada sesi easy/LR dengan data HR &amp; pace.</p>}
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
                  {([['Pace-HR Ratio', '40%', pes.phrNorm, 'Coggan EF'], ['TRIMP Efficiency', '25%', pes.teNorm, 'Banister'], ['RHR Trend', '20%', pes.rhrNorm, 'Cardiac proxy'], ['Z1-Z2 Dist.', '15%', pes.z12Norm, 'Seiler 80/20']] as [string, string, number, string][]).map(([l, w, v, r]) => (
                    <div key={l}>
                      <div className="flex justify-between text-xs text-gray-500 mb-0.5"><span>{l} <span className="text-gray-300">({w})</span></span><span>{v}%</span></div>
                      <div className="h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${v}%` }} /></div>
                      <div className="text-xs text-gray-300">{r}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-gray-400">Minimal 3 sesi latihan diperlukan.</p>}
          </div>
        </div>
      </section>

      {/* TIME TRIAL HISTORY */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest">Time Trial History</div>
          <button onClick={() => { setShowTtForm(v => !v); setError(null) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            {showTtForm ? 'Batal' : '+ Tambah TT'}
          </button>
        </div>
        {showTtForm && (
          <div className="mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tanggal</label>
                <input type="date" value={ttForm.tt_date} onChange={e => setTtForm(p => ({ ...p, tt_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jarak</label>
                <select value={ttForm.distance_km} onChange={e => setTtForm(p => ({ ...p, distance_km: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {TT_DISTANCES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Waktu (MM:SS atau HH:MM:SS)</label>
                <input type="text" value={ttForm.finish_time} placeholder="31:10" onChange={e => setTtForm(p => ({ ...p, finish_time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">HR Avg (bpm)</label>
                <input type="number" value={ttForm.hr_avg} placeholder="165" onChange={e => setTtForm(p => ({ ...p, hr_avg: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Catatan</label>
                <input type="text" value={ttForm.notes} placeholder="Kondisi, cuaca..." onChange={e => setTtForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
            <button onClick={saveTt} disabled={ttSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {ttSaving ? 'Menyimpan...' : 'Simpan TT'}
            </button>
          </div>
        )}
        {ttList.length === 0 ? (
          <EmptyState title="Belum ada time trial" description="Input TT untuk menghitung VDOT dan prediksi race." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  {['Tanggal', 'Jarak', 'Waktu', 'Pace', 'Pred. HM', 'VDOT', 'Magic Mile', 'Akurasi', ''].map(h => (
                    <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ttList.map((tt, idx) => {
                  const isActive = idx === 0
                  const predHm = predictTime(tt.distance_km * 1000, tt.finish_time_sec, 21097.5)
                  const ageDays = (Date.now() - new Date(tt.tt_date).getTime()) / 86400000
                  const acc: 'high' | 'medium' | 'low' = tt.distance_km >= 8 ? 'high' : (tt.distance_km >= 5 && ageDays <= 28 ? 'medium' : 'low')
                  const accMap = { high: ['bg-green-100 text-green-700', '🟢 High'], medium: ['bg-yellow-100 text-yellow-700', '🟡 Medium'], low: ['bg-red-100 text-red-700', '🔴 Low'] } as const
                  return (
                    <tr key={tt.id} className={`border-b border-gray-50 ${isActive ? 'bg-blue-50' : ''}`}>
                      <td className="py-2 pr-3 text-xs text-gray-500">
                        {new Date(tt.tt_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {isActive && <div className="text-blue-600 font-bold text-xs">▶ Aktif</div>}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{tt.distance_km} km</td>
                      <td className="py-2 pr-3">{fmtTime(tt.finish_time_sec)}</td>
                      <td className="py-2 pr-3">{secToPace(Math.round(tt.finish_time_sec / tt.distance_km))}</td>
                      <td className="py-2 pr-3">{fmtTime(Math.round(predHm))}</td>
                      <td className="py-2 pr-3 font-semibold text-indigo-600">{tt.vdot}</td>
                      <td className="py-2 pr-3">{magicMilePace(tt)}</td>
                      <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${accMap[acc][0]}`}>{accMap[acc][1]}</span></td>
                      <td className="py-2"><button onClick={() => deleteTt(tt.id)} className="text-xs text-red-400 hover:text-red-600">Hapus</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* HEAT STRESS INDEX */}
      <section className="bg-white rounded-xl shadow-sm p-5">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-4">🌡️ Heat Stress Index</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><label>Suhu (°C)</label><span>{hsiState.temp}°C</span></div>
              <input type="range" min={15} max={45} step={0.5} value={hsiState.temp} onChange={e => setHsiState(s => ({ ...s, temp: parseFloat(e.target.value) }))} className="w-full accent-indigo-600" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><label>Kelembaban (%)</label><span>{hsiState.rh}%</span></div>
              <input type="range" min={20} max={100} step={1} value={hsiState.rh} onChange={e => setHsiState(s => ({ ...s, rh: parseInt(e.target.value) }))} className="w-full accent-indigo-600" />
            </div>
            <div className="text-xs text-gray-300">Nilai tersimpan otomatis</div>
          </div>
          <div>
            <div className={`inline-block text-sm font-bold px-3 py-1 rounded-full mb-3 ${hsi.cls === 'safe' ? 'bg-green-100 text-green-700' : hsi.cls === 'low' ? 'bg-yellow-100 text-yellow-700' : hsi.cls === 'mod' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>{hsi.emoji} {hsi.risk}</div>
            <table className="w-full text-xs text-gray-600 mb-2">
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
            <div className="text-xs text-gray-400">WBGT: {hsi.wbgt}°C · HR drift: +{hsi.hrDrift} bpm · Ref: Moran et al. (2004)</div>
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
