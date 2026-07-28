import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EwsEntry {
  id: string; athlete_id: string; entry_date: string
  resting_hr: number | null; hrv: number | null; sleep_hours: number | null
  sleep_quality: number | null; sleep_deep_min: number | null; sleep_rem_min: number | null
  sleep_awake_min: number | null; muscle_soreness: number | null; motivation: number | null
  mood: number | null; fatigue: number | null; stress: number | null
  composite_score: number | null; notes: string | null
}

interface FlagItem {
  level: 'yellow' | 'red'
  item: string
  value: string
  message: string
}

interface EwsResult {
  baseRhr: number; baseHrv: number; baseSource: string
  scorePhys: number; scoreSleep: number; scoreDoms: number; scoreEnergy: number
  scoreFatigue: number; scoreMood: number; scoreStress: number
  // Sleep sub-components (PSQI-Proxy — Garmin stage-based)
  sleepC1: number; sleepC2: number; sleepC3: number; sleepC3b: number
  sleepC5: number; sleepC7: number
  rawScore: number     // composite tanpa override
  totalScore: number   // = rawScore (tidak ada override lagi)
  flags: FlagItem[]
  overrideApplied: boolean
}

interface EwsForm {
  entry_date: string; resting_hr: string; hrv: string
  sleep_str: string; sleep_hours: string; sleep_quality: string
  sleep_deep_min: string; sleep_rem_min: string; sleep_awake_min: string
  muscle_soreness: string; motivation: string
  mood: string; fatigue: string; stress: string; notes: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FORM_BLANK: EwsForm = {
  entry_date: new Date().toISOString().slice(0, 10),
  resting_hr: '', hrv: '', sleep_str: '', sleep_hours: '',
  sleep_quality: '', sleep_deep_min: '', sleep_rem_min: '', sleep_awake_min: '',
  muscle_soreness: '', motivation: '',
  mood: '', fatigue: '', stress: '', notes: ''
}

const STATUS_CONFIG = [
  { max: 15,  label: 'Sangat Prima',              color: '#6366f1', bg: '#eef2ff', icon: '🛡️', rec: 'Pemulihan sangat tuntas. Tubuh dalam keadaan optimal untuk menyerap beban latihan berat (Long Run atau Interval). Lanjutkan sesuai program dengan percaya diri!' },
  { max: 30,  label: 'Kondisi Baik',               color: '#10b981', bg: '#ecfdf5', icon: '✅', rec: 'Kelelahan berada pada tingkat normal dan dapat ditoleransi. Anda masih dalam zona produktif untuk melanjutkan program mingguan.' },
  { max: 45,  label: 'Perlu Perhatian',             color: '#f59e0b', bg: '#fffbeb', icon: '⚠️', rec: 'Tubuh menunjukkan tanda kelelahan yang mulai menumpuk. Rekomendasi: Kurangi intensitas lari 10–15% hari ini, atau ganti Quality Run menjadi Easy RWR pace.' },
  { max: 60,  label: 'Kelelahan Tingkat Tinggi',   color: '#ef4444', bg: '#fef2f2', icon: '🚨', rec: 'Peringatan! Risiko cedera dan overtraining meningkat drastis. Sangat disarankan mengganti sesi lari dengan Active Recovery atau pilih Full Rest.' },
  { max: 101, label: 'Danger Zone / Overreaching', color: '#1e293b', bg: '#f8fafc', icon: '💀', rec: 'DANGER! Sistem saraf pusat kelelahan ekstrim. Segera hentikan seluruh aktivitas latihan. Wajib Full Rest 1–2 hari, prioritaskan hidrasi dan tidur ekstra.' },
]

const ROWS_PER_PAGE = 14

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatus(score: number) {
  return STATUS_CONFIG.find(s => score <= s.max) || STATUS_CONFIG[STATUS_CONFIG.length - 1]
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function parseSleepStr(str: string): number | null {
  if (!str || !str.includes(':')) return null
  const [h, m] = str.split(':').map(Number)
  if (isNaN(h)) return null
  return h + (isNaN(m) ? 0 : m / 60)
}

function avg(arr: (number | null)[]): number | null {
  const v = arr.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function trendArrow(current: number | null, baseline: number | null, higherIsBetter: boolean): { arrow: string; color: string } {
  if (current == null || baseline == null) return { arrow: '→', color: '#9ca3af' }
  const diff = current - baseline
  const pct  = Math.abs(diff / baseline) * 100
  if (pct < 3) return { arrow: '→', color: '#9ca3af' }
  if (higherIsBetter) {
    return diff > 0 ? { arrow: '↑', color: '#10b981' } : { arrow: '↓', color: '#ef4444' }
  } else {
    return diff > 0 ? { arrow: '↑', color: '#ef4444' } : { arrow: '↓', color: '#10b981' }
  }
}

// ── Algorithm v4 — PSQI-Proxy Sleep (5 Komponen) + Hapus Hard Override ──────
// Sleep Score berbasis PSQI-Proxy:
//   C1 Kualitas Subjektif    — Buysse et al. 1989 (PSQI)
//   C2 Sleep Latency         — Buysse et al. 1989 (PSQI)
//   C3 Defisit vs Personal   — Kiviniemi 2007 / Plews 2013 (individual baseline)
//   C3b Defisit vs Kritis    — Van Dongen et al. 2003 (<5 jam = critical)
//   C5 Gangguan Tidur        — Buysse et al. 1989 (PSQI)
//   C7 Daytime Dysfunction   — Proxy dari fatigue + energy (Buysse et al. 1989)
// Override keras dihapus — flag tetap informatif, tidak mengubah skor
// Referensi: Carpenter & Andrykowski 1998 (r=0.94 dengan PSQI penuh, 5 komponen)

function calculateEWS(
  dateStr: string, rhr: number, hrv: number,
  sleep: number, sleepQual: number, doms: number, energy: number,
  mood: number | null, fatigue: number | null, stress: number | null,
  sleepDeepMin: number | null, sleepRemMin: number | null, sleepAwakeMin: number | null,
  history: EwsEntry[], profileHRrest: number, profileHRVBase: number | null
): EwsResult {
  const past = history.filter(e => e.entry_date < dateStr).sort((a, b) => b.entry_date.localeCompare(a.entry_date))

  // ── Baseline 3 Lapis (Kiviniemi 2007 / Plews 2013) ───────────────────────
  const profileRhr = profileHRrest || rhr
  const profileHrv = profileHRVBase || hrv

  let baseRhr: number, baseHrv: number, baseSource: string

  if (past.length >= 21) {
    const last30 = past.slice(0, 30)
    const rhrV = last30.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = last30.map(e => e.hrv).filter((v): v is number => v != null)
    baseRhr = rhrV.length ? rhrV.reduce((a, b) => a + b, 0) / rhrV.length : profileRhr
    baseHrv = hrvV.length ? hrvV.reduce((a, b) => a + b, 0) / hrvV.length : profileHrv
    baseSource = `rolling avg ${Math.min(past.length, 30)} hari (Lapis 3 — fully individual)`
  } else if (past.length >= 8) {
    const rhrV = past.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = past.map(e => e.hrv).filter((v): v is number => v != null)
    const rollingRhr = rhrV.length ? rhrV.reduce((a, b) => a + b, 0) / rhrV.length : profileRhr
    const rollingHrv = hrvV.length ? hrvV.reduce((a, b) => a + b, 0) / hrvV.length : profileHrv
    baseRhr = (profileRhr * 0.5) + (rollingRhr * 0.5)
    baseHrv = (profileHrv * 0.5) + (rollingHrv * 0.5)
    baseSource = `blended profil 50% + rolling ${past.length} entri 50% (Lapis 2)`
  } else {
    baseRhr = profileRhr
    baseHrv = profileHrv
    const src = (profileHRrest && profileHRVBase) ? 'profil RHR & HRV Baseline' : profileHRrest ? 'profil RHR + HRV hari ini' : 'nilai hari ini'
    baseSource = `${src} (Lapis 1 — ${past.length === 0 ? 'entri pertama' : past.length + ' entri'})`
  }

  // ── Personal Sleep Baseline (rolling avg, min 7 entri) ───────────────────
  const sleepHistory = past.map(e => e.sleep_hours).filter((v): v is number => v != null)
  const personalAvgSleep = sleepHistory.length >= 7
    ? sleepHistory.slice(0, 30).reduce((a, b) => a + b, 0) / Math.min(sleepHistory.length, 30)
    : 6.0  // fallback populasi umum jika belum cukup data

  // ── Component Scores (0–100, higher = worse) ─────────────────────────────

  // 1. Physio (HRV + RHR) — objektif
  let scoreRhr = 0, scoreHrv = 0
  if (rhr > 0 && baseRhr > 0) scoreRhr = Math.min(Math.max(((rhr - baseRhr) / baseRhr) * 200, 0), 100)
  if (hrv > 0 && baseHrv > 0) scoreHrv = Math.min(Math.max(((hrv - baseHrv) / baseHrv) * -200, 0), 100)
  const scorePhys = (0.6 * scoreHrv) + (0.4 * scoreRhr)

  // 2. Sleep — PSQI-Proxy 5 Komponen (Garmin stage-based)
  // C1: Kualitas subjektif (20%) — Buysse et al. 1989
  const sleepC1 = ((5 - sleepQual) / 4) * 100

  // C2: Sleep stage quality — Deep + REM proportion (15%)
  //     Walker 2017: Deep ≥13–23%, REM ≥20–25% dari total = restoratif optimal
  //     Jika tidak ada data stage → default netral (50)
  const totalSleepMin = sleep * 60
  let sleepC2 = 50  // default netral jika tidak ada data stage
  if (sleepDeepMin != null && sleepRemMin != null && totalSleepMin > 0) {
    const restorativePct = ((sleepDeepMin + sleepRemMin) / totalSleepMin) * 100
    // Target restoratif ≥38% (13% deep + 25% REM minimum)
    // Makin rendah dari 38% → makin tinggi skor (makin buruk)
    sleepC2 = Math.max(0, Math.min(100, (38 - restorativePct) / 38 * 100))
  }

  // C3: Defisit vs personal average — individual baseline (30%)
  //     Kiviniemi 2007: penyimpangan dari baseline personal lebih prediktif
  const sleepC3 = Math.max(0, (personalAvgSleep - sleep) / personalAvgSleep) * 100

  // C3b: Defisit vs batas kritis 5 jam — Van Dongen et al. 2003 (10%)
  const sleepC3b = Math.max(0, (5 - sleep) / 5) * 100

  // C5: Waktu terjaga (Awake time) dari Garmin (15%)
  //     Proxy langsung untuk sleep disturbances — lebih akurat dari hitungan kasar 0-3
  //     >60 mnt awake = sangat terganggu (PSQI C5 threshold)
  const awakeMin = sleepAwakeMin ?? 0
  const sleepC5 = Math.min((awakeMin / 60) * 100, 100)

  // C7: Daytime dysfunction — proxy fatigue + energy (10%)
  //     Buysse et al. 1989: daytime sleepiness + lack of enthusiasm
  const fatigueProxy = fatigue != null ? ((fatigue - 1) / 4) * 50 : 25
  const energyProxy  = ((10 - energy) / 9) * 50
  const sleepC7 = fatigueProxy + energyProxy

  const scoreSleep = (0.20 * sleepC1) + (0.15 * sleepC2) + (0.30 * sleepC3) +
                     (0.10 * sleepC3b) + (0.15 * sleepC5) + (0.10 * sleepC7)

  // 3. DOMS (0-10 → 0-100)
  const scoreDoms = (doms / 10) * 100

  // 4. Energy (0-10, inverted)
  const scoreEnergy = ((10 - energy) / 10) * 100

  // 5. Fatigue / Kelelahan (1-5, inverted → 0-100) — Hooper Index
  const scoreFatigue = fatigue != null ? ((fatigue - 1) / 4) * 100 : 0

  // 6. Mood (1-5, inverted → 0-100) — Morgan's Iceberg Profile
  const scoreMood = mood != null ? ((5 - mood) / 4) * 100 : 0

  // 7. Stress (1-5 → 0-100) — Kellmann RESTQ-Sport
  const scoreStress = stress != null ? ((stress - 1) / 4) * 100 : 0

  // ── Composite Score ───────────────────────────────────────────────────────
  const hasMFS = mood != null && fatigue != null && stress != null
  let rawScore: number

  if (hasMFS) {
    rawScore =
      (0.20 * scorePhys) +
      (0.20 * scoreSleep) +
      (0.15 * scoreDoms) +
      (0.15 * scoreFatigue) +
      (0.10 * scoreMood) +
      (0.10 * scoreStress) +
      (0.10 * scoreEnergy)
  } else {
    rawScore =
      (0.30 * scorePhys) +
      (0.30 * scoreSleep) +
      (0.20 * scoreDoms) +
      (0.20 * scoreEnergy)
  }

  // ── Flag System — INFORMATIF SAJA, tidak mengubah skor ───────────────────
  // Flags hanya sebagai peringatan visual, override keras dihapus
  // (Meeusen et al. 2013: monitor signals, bukan paksa skor)
  const flags: FlagItem[] = []

  if (doms >= 8) flags.push({ level: 'red', item: 'DOMS', value: `${doms}/10`, message: 'Kerusakan otot berat — wajib Active Recovery atau Rest' })
  else if (doms >= 6) flags.push({ level: 'yellow', item: 'DOMS', value: `${doms}/10`, message: 'Nyeri otot signifikan pasca latihan berat — pertimbangkan recovery' })

  if (fatigue != null) {
    if (fatigue >= 5) flags.push({ level: 'red', item: 'Kelelahan', value: `${fatigue}/5`, message: 'Kelelahan ekstrim — risiko overtraining (Hooper Index)' })
    else if (fatigue >= 4) flags.push({ level: 'yellow', item: 'Kelelahan', value: `${fatigue}/5`, message: 'Kelelahan tinggi — kurangi volume/intensitas' })
  }

  if (stress != null) {
    if (stress >= 5) flags.push({ level: 'red', item: 'Stres', value: `${stress}/5`, message: 'Stres psikososial ekstrim — recovery capacity terganggu (Kellmann 2010)' })
    else if (stress >= 4) flags.push({ level: 'yellow', item: 'Stres', value: `${stress}/5`, message: 'Stres tinggi — dampak negatif pada pemulihan' })
  }

  if (mood != null) {
    if (mood <= 1) flags.push({ level: 'red', item: 'Mood', value: `${mood}/5`, message: 'Mood sangat rendah — tanda awal overreaching (Morgan 1985)' })
    else if (mood <= 2) flags.push({ level: 'yellow', item: 'Mood', value: `${mood}/5`, message: 'Mood rendah — monitor potensi non-functional overreaching' })
  }

  // Sleep flags — berbasis personal baseline (Kiviniemi 2007)
  const sleepDeficitPct = personalAvgSleep > 0 ? ((personalAvgSleep - sleep) / personalAvgSleep) * 100 : 0
  if (sleep < 5) flags.push({ level: 'red', item: 'Durasi Tidur', value: `${sleep.toFixed(1)} jam`, message: `Tidur sangat kurang — batas kritis 5 jam (Van Dongen 2003)` })
  else if (sleepDeficitPct >= 20) flags.push({ level: 'yellow', item: 'Durasi Tidur', value: `${sleep.toFixed(1)} jam`, message: `Defisit ${sleepDeficitPct.toFixed(0)}% dari rata-rata personal (${personalAvgSleep.toFixed(1)} jam)` })

  // Sleep stage flags (Walker 2017)
  if (sleepDeepMin != null && sleepRemMin != null && totalSleepMin > 0) {
    const deepPct = (sleepDeepMin / totalSleepMin) * 100
    const remPct  = (sleepRemMin  / totalSleepMin) * 100
    if (deepPct < 10) flags.push({ level: 'red',    item: 'Deep Sleep', value: `${sleepDeepMin} mnt (${deepPct.toFixed(0)}%)`, message: 'Deep sleep sangat rendah — pemulihan fisik terganggu (Walker 2017)' })
    else if (deepPct < 13) flags.push({ level: 'yellow', item: 'Deep Sleep', value: `${sleepDeepMin} mnt (${deepPct.toFixed(0)}%)`, message: 'Deep sleep di bawah normal (target ≥13%)' })
    if (remPct < 15) flags.push({ level: 'red',    item: 'REM Sleep', value: `${sleepRemMin} mnt (${remPct.toFixed(0)}%)`, message: 'REM sangat rendah — konsolidasi memori & recovery kognitif terganggu (Walker 2017)' })
    else if (remPct < 20) flags.push({ level: 'yellow', item: 'REM Sleep', value: `${sleepRemMin} mnt (${remPct.toFixed(0)}%)`, message: 'REM di bawah normal (target ≥20%)' })
  }

  // Awake time flags
  if (awakeMin >= 60) flags.push({ level: 'red',    item: 'Awake Time', value: `${awakeMin} mnt`, message: 'Terlalu banyak terbangun (≥60 mnt) — kualitas tidur sangat terganggu (PSQI C5)' })
  else if (awakeMin >= 30) flags.push({ level: 'yellow', item: 'Awake Time', value: `${awakeMin} mnt`, message: 'Cukup sering terbangun — monitor pola tidur' })

  if (energy <= 2) flags.push({ level: 'red', item: 'Energy', value: `${energy}/10`, message: 'Energi sangat rendah — tubuh butuh istirahat penuh' })
  else if (energy <= 3) flags.push({ level: 'yellow', item: 'Energy', value: `${energy}/10`, message: 'Energi rendah — pertimbangkan sesi ringan' })

  if (baseRhr > 0 && rhr > 0) {
    const rhrPct = ((rhr - baseRhr) / baseRhr) * 100
    if (rhrPct >= 8) flags.push({ level: 'red', item: 'RHR', value: `${rhr} bpm (+${rhrPct.toFixed(0)}%)`, message: 'RHR jauh di atas baseline — kemungkinan stress sistemik' })
    else if (rhrPct >= 5) flags.push({ level: 'yellow', item: 'RHR', value: `${rhr} bpm (+${rhrPct.toFixed(0)}%)`, message: 'RHR meningkat — monitor pemulihan' })
  }
  if (baseHrv > 0 && hrv > 0) {
    const hrvPct = ((baseHrv - hrv) / baseHrv) * 100
    if (hrvPct >= 15) flags.push({ level: 'red', item: 'HRV', value: `${hrv} ms (-${hrvPct.toFixed(0)}%)`, message: 'HRV sangat rendah — ANS exhaustion (Plews 2013)' })
    else if (hrvPct >= 10) flags.push({ level: 'yellow', item: 'HRV', value: `${hrv} ms (-${hrvPct.toFixed(0)}%)`, message: 'HRV menurun signifikan — parasympathetic withdrawal' })
  }

  // totalScore = rawScore (tidak ada override)
  const totalScore = rawScore

  return {
    baseRhr, baseHrv, baseSource,
    scorePhys, scoreSleep, scoreDoms, scoreEnergy,
    scoreFatigue, scoreMood, scoreStress,
    sleepC1, sleepC2, sleepC3, sleepC3b, sleepC5, sleepC7,
    rawScore, totalScore,
    flags, overrideApplied: false
  }
}
// Referensi:
//   McLean et al. (2010) — 5-item subjective wellness questionnaire
//   Saw et al. (2016)    — subjective > objective untuk monitoring respons atlet
//   Hooper & Mackinnon (1995) — Hooper Index (fatigue, DOMS, sleep, stress)
//   Halson (2014)        — sleep deprivation ↓ performance 10-30%
//   Meeusen et al. (2013) — ECSS consensus: overtraining prevention
//   Kellmann (2010)      — RESTQ-Sport: psychosocial stress modulates recovery
//   Morgan (1985)        — Iceberg Profile: mood as early overreaching marker
//   Kiviniemi (2007) / Plews (2013) — HRV individual baseline


// ── Component ─────────────────────────────────────────────────────────────────

export default function EwsPage() {
  const [athleteId, setAthleteId]   = useState<string | null>(null)
  const [entries, setEntries]       = useState<EwsEntry[]>([])
  const [form, setForm]             = useState<EwsForm>(FORM_BLANK)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [result, setResult]         = useState<EwsResult | null>(null)
  const [profileHRrest, setProfileHRrest]   = useState(55)
  const [profileHRVBase, setProfileHRVBase]   = useState<number | null>(null)
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)
  const [activeTab, setActiveTab]   = useState<'dashboard' | 'input'>('dashboard')
  const [filterWeek, setFilterWeek] = useState<string>('ALL')
  const [page, setPage]             = useState(1)
  const [searchDate, setSearchDate] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
      if (!ath) return
      setAthleteId(ath.id)
      const { data: settings } = await supabase.from('athlete_settings').select('resting_hr,hrv_baseline').eq('athlete_id', ath.id).single()
      if ((settings as any)?.resting_hr) setProfileHRrest((settings as any).resting_hr)
      if ((settings as any)?.hrv_baseline) setProfileHRVBase((settings as any).hrv_baseline)
      await loadEntries(ath.id)
      setLoading(false)
    }
    init()
  }, [])

  async function loadEntries(athId: string) {
    const { data } = await (supabase as any)
      .from('ews_entries').select('*')
      .eq('athlete_id', athId)
      .order('entry_date', { ascending: false })
    setEntries(data || [])
  }

  // Real-time calc — include all fields including new sleep fields
  useEffect(() => {
    const rhr = parseFloat(form.resting_hr), hrv = parseFloat(form.hrv)
    const sleep = parseSleepStr(form.sleep_str) ?? parseFloat(form.sleep_hours)
    const sq = parseFloat(form.sleep_quality), doms = parseFloat(form.muscle_soreness), energy = parseFloat(form.motivation)
    if (!form.entry_date || isNaN(rhr) || isNaN(hrv) || isNaN(sleep) || isNaN(sq) || isNaN(doms) || isNaN(energy)) {
      setResult(null); return
    }
    const moodVal = form.mood ? parseInt(form.mood) : null
    const fatigueVal = form.fatigue ? parseInt(form.fatigue) : null
    const stressVal = form.stress ? parseInt(form.stress) : null
    const onsetVal = form.sleep_deep_min ? parseInt(form.sleep_deep_min) : null
    const remVal   = form.sleep_rem_min  ? parseInt(form.sleep_rem_min)  : null
    const awakeVal = form.sleep_awake_min ? parseInt(form.sleep_awake_min) : null
    setResult(calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, moodVal, fatigueVal, stressVal, onsetVal, remVal, awakeVal, entries, profileHRrest, profileHRVBase))
  }, [form, entries, profileHRrest, profileHRVBase])

  function handleSleepStr(val: string) {
    let c = val.replace(/\D/g, '')
    if (c.length >= 3) c = c.slice(0, 2) + ':' + c.slice(2, 4)
    const hours = parseSleepStr(c)
    setForm(f => ({ ...f, sleep_str: c, sleep_hours: hours != null ? hours.toFixed(2) : '' }))
  }

  async function saveEntry() {
    if (!athleteId) return
    if (!form.entry_date || !form.resting_hr || !form.hrv) { showToast('Tanggal, RHR, dan HRV wajib diisi', false); return }
    setSaving(true)
    const sleep = parseSleepStr(form.sleep_str) ?? (form.sleep_hours ? parseFloat(form.sleep_hours) : null)
    const rhr = parseFloat(form.resting_hr), hrv = parseFloat(form.hrv)
    const sq = form.sleep_quality ? parseInt(form.sleep_quality) : null
    const doms = form.muscle_soreness ? parseFloat(form.muscle_soreness) : null
    const energy = form.motivation ? parseFloat(form.motivation) : null
    const moodVal = form.mood ? parseInt(form.mood) : null
    const fatigueVal = form.fatigue ? parseInt(form.fatigue) : null
    const stressVal = form.stress ? parseInt(form.stress) : null
    const onsetVal = form.sleep_deep_min  ? parseInt(form.sleep_deep_min)  : null
    const remVal   = form.sleep_rem_min   ? parseInt(form.sleep_rem_min)   : null
    const awakeVal = form.sleep_awake_min ? parseInt(form.sleep_awake_min) : null
    let score: number | null = null
    if (rhr && hrv && sleep != null && sq != null && doms != null && energy != null)
      score = calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, moodVal, fatigueVal, stressVal, onsetVal, remVal, awakeVal, entries, profileHRrest, profileHRVBase).totalScore
    const payload = {
      athlete_id: athleteId, entry_date: form.entry_date,
      resting_hr: rhr || null, hrv: hrv || null, sleep_hours: sleep,
      sleep_quality: sq, sleep_deep_min: onsetVal, sleep_rem_min: remVal, sleep_awake_min: awakeVal,
      muscle_soreness: doms, motivation: energy,
      mood: moodVal, fatigue: fatigueVal, stress: stressVal,
      composite_score: score != null ? parseFloat(score.toFixed(1)) : null,
      notes: form.notes || null
    }
    try {
      if (editingId) {
        await (supabase as any).from('ews_entries').update(payload).eq('id', editingId)
        showToast('Entri diperbarui')
      } else {
        await (supabase as any).from('ews_entries').insert(payload)
        showToast('Entri disimpan')
      }
      setForm(FORM_BLANK); setEditingId(null)
      await loadEntries(athleteId)
      setActiveTab('dashboard')
    } catch (e: any) { showToast('Gagal: ' + e.message, false) }
    finally { setSaving(false) }
  }

  function editEntry(e: EwsEntry) {
    const h = Math.floor(e.sleep_hours ?? 0), m = Math.round(((e.sleep_hours ?? 0) - h) * 60)
    const sleepStr = (e.sleep_hours ?? 0) > 0 ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}` : ''
    setForm({
      entry_date: e.entry_date, resting_hr: e.resting_hr?.toString() || '',
      hrv: e.hrv?.toString() || '', sleep_str: sleepStr,
      sleep_hours: (e.sleep_hours ?? 0) > 0 ? (e.sleep_hours!).toFixed(2) : '',
      sleep_quality: e.sleep_quality?.toString() || '',
      sleep_deep_min:  e.sleep_deep_min?.toString()  || '',
      sleep_rem_min:   e.sleep_rem_min?.toString()   || '',
      sleep_awake_min: e.sleep_awake_min?.toString() || '',
      muscle_soreness: e.muscle_soreness?.toString() || '',
      motivation: e.motivation?.toString() || '', mood: e.mood?.toString() || '',
      fatigue: e.fatigue?.toString() || '', stress: e.stress?.toString() || '', notes: e.notes || ''
    })
    setEditingId(e.id)
    setActiveTab('input')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteEntry(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await (supabase as any).from('ews_entries').delete().eq('id', id)
    await loadEntries(athleteId!); showToast('Entri dihapus')
  }

  // ── Recalculate all entries (v3 — 7-component) ──
  async function recalculateAll() {
    if (!athleteId) return
    if (!confirm(`Recalculate composite_score untuk ${entries.length} entri menggunakan algoritma v4 (PSQI-Proxy + Garmin stage, tanpa override)?`)) return
    let updated = 0
    for (const e of entries) {
      const rhr = e.resting_hr, hrv = e.hrv
      const sleep = e.sleep_hours, sq = e.sleep_quality
      const doms = e.muscle_soreness, energy = e.motivation
      if (!rhr || !hrv || sleep == null || sq == null || doms == null || energy == null) continue
      const res = calculateEWS(e.entry_date, rhr, hrv, sleep, sq, doms, energy, e.mood, e.fatigue, e.stress, e.sleep_deep_min, e.sleep_rem_min, e.sleep_awake_min, entries, profileHRrest, profileHRVBase)
      await (supabase as any).from('ews_entries').update({ composite_score: parseFloat(res.totalScore.toFixed(1)) }).eq('id', e.id)
      updated++
    }
    await loadEntries(athleteId)
    showToast(`${updated} entri berhasil di-recalculate (algoritma v3)`)
  }

  // ── Download seluruh riwayat EWS sebagai CSV (semua kolom tabel) ──
  function downloadCSV() {
    if (!entries.length) { showToast('Tidak ada data untuk diunduh', false); return }
    const headers = Object.keys(entries[0]) as (keyof EwsEntry)[]
    const csvRows = [
      headers.join(','),
      ...entries.map(e => headers.map(h => {
        const v = e[h]
        if (v === null || v === undefined) return ''
        const str = String(v).replace(/"/g, '""')
        return /[",\n]/.test(str) ? `"${str}"` : str
      }).join(','))
    ]
    const csvContent = csvRows.join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ews_tracker_export_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast('CSV berhasil diunduh')
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const getWeekKey = useCallback((dateStr: string) => {
    const d = new Date(dateStr)
    const jan4 = new Date(d.getFullYear(), 0, 4)
    const wn = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${wn.toString().padStart(2,'0')}`
  }, [])

  const weekOptions = Array.from(new Set(entries.map(e => getWeekKey(e.entry_date)))).sort().reverse()

  const filteredAsc = useCallback((): EwsEntry[] => {
    let list = [...entries]
    if (filterWeek !== 'ALL') list = list.filter(e => getWeekKey(e.entry_date) === filterWeek)
    return list.sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  }, [entries, filterWeek, getWeekKey])

  const filtered = filteredAsc()

  // Stats
  const avgFatigue = avg(filtered.map(e => e.composite_score))
  const avgSleepH  = avg(filtered.map(e => e.sleep_hours))
  const avgDoms    = avg(filtered.map(e => e.muscle_soreness))
  const avgEnergy  = avg(filtered.map(e => e.motivation))
  const avgRhr     = avg(filtered.map(e => e.resting_hr))
  const avgMoodRaw = avg(filtered.map(e => e.mood))
  const avgFatigueRaw = avg(filtered.map(e => e.fatigue))
  const avgStressRaw = avg(filtered.map(e => e.stress))

  const avgPhysioScore = (() => {
    const vals = filtered.filter(e => e.composite_score != null).map(e => {
      const rhr = e.resting_hr ?? 0, hrv = e.hrv ?? 0
      if (!rhr || !hrv) return null
      const past = entries.filter(x => x.entry_date < e.entry_date)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
      const profRhr = profileHRrest || rhr
      const profHrv = profileHRVBase || hrv
      let bRhr: number, bHrv: number
      if (past.length >= 21) {
        const last30 = past.slice(0, 30)
        bRhr = avg(last30.map(x => x.resting_hr)) ?? profRhr
        bHrv = avg(last30.map(x => x.hrv)) ?? profHrv
      } else if (past.length >= 8) {
        const rollingRhr = avg(past.map(x => x.resting_hr)) ?? profRhr
        const rollingHrv = avg(past.map(x => x.hrv)) ?? profHrv
        bRhr = profRhr * 0.5 + rollingRhr * 0.5
        bHrv = profHrv * 0.5 + rollingHrv * 0.5
      } else {
        bRhr = profRhr
        bHrv = profHrv
      }
      const sRhr = Math.min(Math.max(((rhr - bRhr) / bRhr) * 200, 0), 100)
      const sHrv = Math.min(Math.max(((hrv - bHrv) / bHrv) * -200, 0), 100)
      return (0.6 * sHrv) + (0.4 * sRhr)
    }).filter((v): v is number => v !== null)
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  })()

  // Streak
  const sortedDesc = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date))
  let streak = 0
  if (sortedDesc.length) {
    const today = new Date().toISOString().slice(0, 10)
    let cur = new Date(today)
    for (const e of sortedDesc) {
      const eDate = new Date(e.entry_date).toISOString().slice(0, 10)
      const expected = cur.toISOString().slice(0, 10)
      if (eDate === expected) { streak++; cur.setDate(cur.getDate() - 1) }
      else if (eDate < expected) break
    }
  }

  const goodDays = filtered.filter(e => e.composite_score != null && e.composite_score <= 30).length
  const goodPct  = filtered.length ? Math.round((goodDays / filtered.length) * 100) : 0

  // Distribution
  const dist = [0,0,0,0,0]
  filtered.forEach(e => {
    if (e.composite_score == null) return
    const idx = STATUS_CONFIG.findIndex(s => (e.composite_score as number) <= s.max)
    if (idx >= 0) dist[idx]++
  })

  // RHR & HRV trend
  const last7 = [...entries].sort((a,b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 7)
  const prev7 = [...entries].sort((a,b) => b.entry_date.localeCompare(a.entry_date)).slice(7, 14)
  const rhrTrend = trendArrow(avg(last7.map(e => e.resting_hr)), avg(prev7.map(e => e.resting_hr)), false)
  const hrvTrend = trendArrow(avg(last7.map(e => e.hrv)), avg(prev7.map(e => e.hrv)), true)

  // Chart data
  const chartData = filtered.map(e => ({
    date: new Date(e.entry_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
    fatigue: e.composite_score != null ? parseFloat(e.composite_score.toFixed(1)) : null,
    rhr: e.resting_hr,
    hrv: e.hrv,
    energy: e.motivation != null ? e.motivation * 10 : null
  }))

  // Latest entry
  const latest = entries[0]
  const latestStatus = latest?.composite_score != null ? getStatus(latest.composite_score) : null

  // Latest flags (recalculate for display)
  const latestFlags: FlagItem[] = (() => {
    if (!latest || latest.composite_score == null) return []
    const rhr = latest.resting_hr, hrv = latest.hrv
    const sleep = latest.sleep_hours, sq = latest.sleep_quality
    const doms = latest.muscle_soreness, energy = latest.motivation
    if (!rhr || !hrv || sleep == null || sq == null || doms == null || energy == null) return []
    const res = calculateEWS(latest.entry_date, rhr, hrv, sleep, sq, doms, energy, latest.mood, latest.fatigue, latest.stress, latest.sleep_deep_min, latest.sleep_rem_min, latest.sleep_awake_min, entries, profileHRrest, profileHRVBase)
    return res.flags
  })()

  // Table pagination & search
  const tableEntries = [...entries]
    .filter(e => searchDate ? e.entry_date.includes(searchDate) : true)
    .filter(e => filterWeek !== 'ALL' ? getWeekKey(e.entry_date) === filterWeek : true)
  const totalPages = Math.max(1, Math.ceil(tableEntries.length / ROWS_PER_PAGE))
  const pageEntries = tableEntries.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE)

  const status = result ? getStatus(result.totalScore) : null

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {toast && <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>{toast.msg}</div>}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Training Readiness — EWS Tracker</h1>
            <p className="text-xs text-gray-400 mt-0.5">Algoritma 7-Komponen + PSQI-Proxy Sleep (Garmin Stage: Deep, REM, Awake) · Buysse 1989 · Walker 2017 · Kiviniemi 2007</p>
          </div>
          <button onClick={() => { setActiveTab('input'); setForm(FORM_BLANK); setEditingId(null) }}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700">
            + Input Harian
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['dashboard','input'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'dashboard' ? '📊 Dashboard & Tren' : '✏️ Input & Riwayat'}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — DASHBOARD & TREN
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">

          {/* Readiness hari ini */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Readiness Hari Ini</h2>
            {!latestStatus || !latest ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <div className="text-4xl mb-3">📊</div>
                <div>Belum ada data EWS. Mulai input di tab Input & Riwayat.</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0" style={{ background: latestStatus.bg }}>
                      {latestStatus.icon}
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 mb-0.5">Entri terakhir · {fmtDate(latest.entry_date)}</div>
                      <div className="text-xl font-bold" style={{ color: latestStatus.color }}>{latestStatus.label}</div>
                      <div className="text-xs text-gray-500 mt-1 leading-relaxed max-w-lg">{latestStatus.rec}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 py-4 min-w-[120px]">
                    <div className="text-3xl font-bold" style={{ color: latestStatus.color }}>
                      {latest.composite_score?.toFixed(1)}
                    </div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Readiness Score</div>
                    <div className="mt-2 h-1.5 w-20 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(latest.composite_score ?? 0, 100)}%`, background: latestStatus.color }} />
                    </div>
                  </div>
                </div>

                {/* Flag alerts on dashboard */}
                {latestFlags.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {latestFlags.map((f, i) => (
                      <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${f.level === 'red' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                        <span className="flex-shrink-0 mt-0.5">{f.level === 'red' ? '🔴' : '⚠️'}</span>
                        <div>
                          <span className={`font-bold ${f.level === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{f.item}: {f.value}</span>
                          <span className="text-gray-600 ml-1">— {f.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Filter + Stat Cards — 2 rows */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-gsans text-xl text-indigo-700 uppercase">Rata-Rata Metrik Kelelahan</h3>
              <select value={filterWeek} onChange={e => { setFilterWeek(e.target.value); setPage(1) }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="ALL">Semua Waktu</option>
                {weekOptions.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            {/* Row 1: Original 5 cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
              {[
                { label: 'Avg Physio Score',  val: avgPhysioScore, icon: '❤️', color: '#6366f1' },
                { label: 'Avg Sleep Score',   val: avgSleepH != null ? Math.min(100, (Math.max(0, 7 - avgSleepH) / 7) * 100) : null, icon: '😴', color: '#8b5cf6' },
                { label: 'Avg DOMS Score',    val: avgDoms != null ? (avgDoms / 10) * 100 : null, icon: '🔥', color: '#ef4444' },
                { label: 'Avg Energy Score',  val: avgEnergy != null ? ((10 - avgEnergy) / 10) * 100 : null, icon: '⚡', color: '#f59e0b' },
                { label: 'Avg Readiness',     val: avgFatigue, icon: '🔋', color: '#1e293b' },
              ].map(({ label, val, icon, color }) => (
                <div key={label} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mt-0.5">{label}</div>
                    <div className="text-lg font-bold" style={{ color }}>{val != null ? val.toFixed(1) : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
            {/* Row 2: New subjective cards (raw averages, not scores) */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Avg Mood', val: avgMoodRaw, icon: '😊', color: '#059669', suffix: '/5', note: '(5=sangat baik)' },
                { label: 'Avg Kelelahan', val: avgFatigueRaw, icon: '🥱', color: '#dc2626', suffix: '/5', note: '(5=sangat lelah)' },
                { label: 'Avg Stres', val: avgStressRaw, icon: '😤', color: '#7c3aed', suffix: '/5', note: '(5=sangat tinggi)' },
              ].map(({ label, val, icon, color, suffix, note }) => (
                <div key={label} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase mt-0.5">{label}</div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold" style={{ color }}>{val != null ? val.toFixed(1) : '—'}</span>
                      <span className="text-xs text-gray-400">{suffix}</span>
                    </div>
                    <div className="text-[10px] text-gray-400">{note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Streak + Konsistensi + RHR/HRV Trend */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Streak */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-bold text-gray-700 uppercase mb-3">🔥 Streak & Konsistensi</div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-500">{streak}</div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Hari Berturut</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div className="text-center">
                  <div className="text-3xl font-bold text-indigo-600">{goodPct}%</div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Hari Kondisi Baik</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-700">{filtered.length}</div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">Total Entri</div>
                </div>
              </div>
            </div>

            {/* RHR Trend */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-bold text-gray-700 uppercase mb-3">💓 Tren RHR (7 hari terakhir)</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-800">{avgRhr != null ? avgRhr.toFixed(0) : '—'}</span>
                    <span className="text-2xl font-bold" style={{ color: rhrTrend.color }}>{rhrTrend.arrow}</span>
                  </div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">bpm avg sekarang</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div>
                  <div className="text-xl font-bold text-gray-500">{avg(prev7.map(e => e.resting_hr))?.toFixed(0) ?? '—'}</div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">bpm avg sebelumnya</div>
                </div>
              </div>
              <div className="mt-3 text-xs font-medium text-gray-600">
                {rhrTrend.color === '#10b981' ? '✅ RHR membaik (turun)' : rhrTrend.color === '#ef4444' ? '⚠️ RHR meningkat — monitor' : '→ RHR stabil'}
              </div>
            </div>

            {/* HRV Trend */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm font-bold text-gray-700 uppercase mb-3">📡 Tren HRV (7 hari terakhir)</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-800">{avg(last7.map(e => e.hrv))?.toFixed(0) ?? '—'}</span>
                    <span className="text-2xl font-bold" style={{ color: hrvTrend.color }}>{hrvTrend.arrow}</span>
                  </div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">ms avg sekarang</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div>
                  <div className="text-xl font-bold text-gray-500">{avg(prev7.map(e => e.hrv))?.toFixed(0) ?? '—'}</div>
                  <div className="text-xs font-semibold text-gray-500 uppercase mt-1">ms avg sebelumnya</div>
                </div>
              </div>
              <div className="mt-3 text-xs font-medium text-gray-600">
                {hrvTrend.color === '#10b981' ? '✅ HRV membaik (naik)' : hrvTrend.color === '#ef4444' ? '⚠️ HRV menurun — butuh recovery' : '→ HRV stabil'}
              </div>
            </div>
          </div>

          {/* Distribusi Status */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Distribusi Status</h2>
            {/* Zone reference badges */}
            <div className="flex flex-wrap gap-2 mb-5">
              {[['#eef2ff','#6366f1','≤15 Sangat Prima'],['#ecfdf5','#065f46','≤30 Kondisi Baik'],['#fffbeb','#92400e','≤45 Perlu Perhatian'],['#fef2f2','#991b1b','≤60 Kelelahan Tinggi'],['#1e293b','#f8fafc','>60 Danger Zone']].map(([bg,col,lbl]) => (
                <span key={lbl} className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: bg, color: col }}>{lbl}</span>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs">Belum ada data untuk periode ini.</div>
            ) : (
              <div className="space-y-2">
                {STATUS_CONFIG.map((s, i) => {
                  const count = dist[i]
                  const pct   = filtered.length ? (count / filtered.length) * 100 : 0
                  return (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className="w-5 text-sm flex-shrink-0">{s.icon}</div>
                      <div className="w-40 flex-shrink-0 text-xs font-medium text-gray-600">{s.label}</div>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                      </div>
                      <div className="w-20 flex-shrink-0 text-right">
                        <span className="text-xs font-bold text-gray-700">{count}×</span>
                        <span className="text-xs text-gray-400 ml-1">({pct.toFixed(0)}%)</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Trend Chart */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Tren Metrik Kelelahan Harian</h2>
            {chartData.length < 2 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <div className="text-4xl mb-3">📈</div>
                <div>Simpan minimal 2 entri untuk melihat tren.</div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-4 mb-6 text-xs font-semibold text-gray-600">
                  {[['#6366f1','Readiness Score'],['#ef4444','RHR (bpm)'],['#10b981','HRV (ms)'],['#f59e0b','Energy (×10)']].map(([c,l]) => (
                    <span key={l} className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-0.5 rounded" style={{ background: c }} />{l}
                    </span>
                  ))}
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="hr" orientation="right" domain={['auto','auto']} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                      <ReferenceLine yAxisId="score" y={15} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={30} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={45} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={60} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <Line yAxisId="score" type="monotone" dataKey="fatigue" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} name="Readiness Score" connectNulls />
                      <Line yAxisId="hr"    type="monotone" dataKey="rhr"     stroke="#ef4444" strokeWidth={1.8} dot={{ r: 3 }} name="RHR (bpm)" connectNulls />
                      <Line yAxisId="hr"    type="monotone" dataKey="hrv"     stroke="#10b981" strokeWidth={1.8} dot={{ r: 3 }} name="HRV (ms)" connectNulls />
                      <Line yAxisId="score" type="monotone" dataKey="energy"  stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 5" dot={{ r: 3 }} name="Energy (×10)" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — INPUT & RIWAYAT
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'input' && (
        <div className="space-y-6">

          {/* Form */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4 flex items-center justify-between">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Input Metrik Harian</h2>
              <button onClick={saveEntry} disabled={saving}
                className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : editingId ? '✓ Perbarui EWS' : '✓ Simpan EWS'}
              </button>
            </div>

            {editingId && (
              <div className="mb-4 flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 text-sm text-amber-800">
                <span>✏️ Mode Edit</span>
                <button onClick={() => { setForm(FORM_BLANK); setEditingId(null) }}
                  className="border border-red-200 text-red-600 text-xs px-3 py-1 rounded-lg hover:bg-red-50">Batal</button>
              </div>
            )}

            {/* Baseline info — selalu tampil */}
            <div className="mb-4 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-lg">
              <div className="text-xs font-bold text-indigo-600 uppercase mb-1">Baseline EWS Aktif</div>
              <div className="flex flex-wrap gap-4 text-xs text-gray-700">
                <span>💓 RHR Baseline: <strong className="text-indigo-700">{profileHRrest} bpm</strong></span>
                <span>📡 HRV Baseline: <strong className="text-indigo-700">{profileHRVBase != null ? `${profileHRVBase} ms` : 'belum diisi'}</strong></span>
                <span className="text-gray-400">
                  {entries.length === 0
                    ? '— Lapis 1 (entri pertama)'
                    : entries.length < 8
                    ? `— Lapis 1 (${entries.length} entri, akumulasi data)`
                    : entries.length < 21
                    ? `— Lapis 2 (blended profil + rolling ${entries.length} entri)`
                    : `— Lapis 3 (rolling avg ${Math.min(entries.length, 30)} hari)`
                  }
                </span>
              </div>
              {!profileHRVBase && (
                <div className="text-xs text-amber-600 mt-1">⚠️ HRV Baseline belum diisi — isi di Profil → Edit Profil untuk hasil EWS lebih akurat</div>
              )}
            </div>

            {/* Row 1 — Tanggal */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
              <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                className="w-full sm:w-64 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>

            {/* Row 2 — Sleep fields */}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-4 mb-4">
              <div className="sm:col-span-2">
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Sleep (HH:MM)</div>
                <div className="flex gap-2">
                  <input type="text" value={form.sleep_str} maxLength={5} onChange={e => handleSleepStr(e.target.value)}
                    placeholder="07:30" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <input type="text" value={form.sleep_hours} readOnly tabIndex={-1}
                    className="w-16 border border-gray-100 bg-gray-50 rounded-lg px-2 py-2 text-sm font-bold text-center text-indigo-700" placeholder="0.00" />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Sleep Quality (1–5)</div>
                <input type="number" min={1} max={5} value={form.sleep_quality}
                  onChange={e => setForm(f => ({ ...f, sleep_quality: e.target.value }))}
                  placeholder="4" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Deep Sleep (mnt)</div>
                <input type="number" min={0} max={480} value={form.sleep_deep_min}
                  onChange={e => setForm(f => ({ ...f, sleep_deep_min: e.target.value }))}
                  placeholder="90" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">REM Sleep (mnt)</div>
                <input type="number" min={0} max={480} value={form.sleep_rem_min}
                  onChange={e => setForm(f => ({ ...f, sleep_rem_min: e.target.value }))}
                  placeholder="100" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Awake Time (mnt)</div>
                <input type="number" min={0} max={480} value={form.sleep_awake_min}
                  onChange={e => setForm(f => ({ ...f, sleep_awake_min: e.target.value }))}
                  placeholder="15" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { key: 'muscle_soreness', label: 'DOMS / Nyeri (0–10)', placeholder: '1', min: 0, max: 10 },
                { key: 'motivation',      label: 'Energy Level (1–10)', placeholder: '8', min: 1, max: 10 },
                { key: 'resting_hr',      label: 'RHR Pagi (bpm) *',   placeholder: '62', min: 30, max: 200 },
                { key: 'hrv',             label: 'HRV (ms) *',          placeholder: '65', min: 0, max: 300 },
              ].map(({ key, label, placeholder, min, max }) => (
                <div key={key}>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">{label}</div>
                  <input type="number" min={min} max={max} value={form[key as keyof EwsForm] as string}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
            </div>

            {/* Baseline */}
            {result && (
              <div className="mb-4 px-3 py-2 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-xs text-gray-600">
                ℹ️ Base RHR: <strong>{result.baseRhr.toFixed(0)} bpm</strong> &nbsp;·&nbsp; Base HRV: <strong>{result.baseHrv.toFixed(0)} ms</strong> &nbsp;·&nbsp; Sumber: <em>{result.baseSource}</em>
              </div>
            )}

            {/* Row 3: Subjective wellness (now part of algorithm) */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              {[
                { key: 'mood',    label: 'Mood (1–5)',       placeholder: '4', max: 5 },
                { key: 'fatigue', label: 'Kelelahan (1–5)',  placeholder: '2', max: 5 },
                { key: 'stress',  label: 'Stres (1–5)',      placeholder: '2', max: 5 },
              ].map(({ key, label, placeholder, max }) => (
                <div key={key}>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">{label}</div>
                  <input type="number" min={1} max={max} value={form[key as keyof EwsForm] as string}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              ))}
            </div>

            {/* Notes */}
            <div className="mb-5">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
              <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Kondisi khusus, cedera, keluhan..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>

            {/* Auto Status — enhanced with 7 components + flags */}
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">Analisis Algoritma: Readiness Score & Rekomendasi (7-Komponen + Flag Override)</div>
              {!result ? (
                <div className="border border-gray-200 rounded-lg px-4 py-4 text-sm text-gray-400">
                  ℹ️ Lengkapi semua metrik untuk melihat analisis algoritma EWS.
                </div>
              ) : (
                <div className="rounded-xl p-4" style={{ background: status!.bg }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{status!.icon}</span>
                    <strong className="text-base" style={{ color: status!.color }}>{status!.label}</strong>
                    <span className="text-sm font-bold text-gray-600">(Skor: {result.totalScore.toFixed(1)})</span>
                  </div>
                  <div className="text-sm text-gray-700 leading-relaxed mb-3">{status!.rec}</div>

                  {/* Flag alerts in form */}
                  {result.flags.length > 0 && (
                    <div className="space-y-1.5 mb-3">
                      {result.flags.map((f, i) => (
                        <div key={i} className={`flex items-start gap-2 px-3 py-1.5 rounded-lg text-xs ${f.level === 'red' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                          <span className="flex-shrink-0">{f.level === 'red' ? '🔴' : '⚠️'}</span>
                          <span className={f.level === 'red' ? 'text-red-700' : 'text-amber-700'}><strong>{f.item}: {f.value}</strong> — {f.message}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 7-component + sleep sub-component breakdown */}
                  <div className="bg-white/60 rounded-lg px-3 py-2 space-y-1.5">
                    <div className="flex flex-wrap gap-4 text-xs">
                      <span><strong>Physio:</strong> {result.scorePhys.toFixed(1)}</span>
                      <span><strong>Sleep:</strong> {result.scoreSleep.toFixed(1)}</span>
                      <span><strong>DOMS:</strong> {result.scoreDoms.toFixed(1)}</span>
                      <span><strong>Energy:</strong> {result.scoreEnergy.toFixed(1)}</span>
                      <span><strong>Fatigue:</strong> {result.scoreFatigue.toFixed(1)}</span>
                      <span><strong>Mood:</strong> {result.scoreMood.toFixed(1)}</span>
                      <span><strong>Stress:</strong> {result.scoreStress.toFixed(1)}</span>
                    </div>
                    <div className="border-t border-gray-200 pt-1.5">
                      <p className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Sleep Sub-komponen (PSQI-Proxy + Garmin Stage):</p>
                      <div className="flex flex-wrap gap-3 text-[10px] text-gray-600">
                        <span>C1 Kualitas: {result.sleepC1.toFixed(1)}</span>
                        <span>C2 Stage Quality (Deep+REM): {result.sleepC2.toFixed(1)}</span>
                        <span>C3 Defisit Personal: {result.sleepC3.toFixed(1)}</span>
                        <span>C3b Kritis: {result.sleepC3b.toFixed(1)}</span>
                        <span>C5 Awake Time: {result.sleepC5.toFixed(1)}</span>
                        <span>C7 Daytime Dysfunction: {result.sleepC7.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* History Table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4 flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Riwayat EWS & Readiness Score</h2>
              {entries.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={recalculateAll}
                    className="border border-indigo-500 text-indigo-600 text-xs px-3 py-1 rounded-lg hover:bg-indigo-50">
                    🔄 Recalculate Semua (v4)
                  </button>
                  <button onClick={downloadCSV}
                    className="border border-gray-300 text-gray-600 text-xs px-3 py-1 rounded-lg hover:bg-gray-50">
                    ⬇️ Download CSV
                  </button>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap gap-3 mb-4">
              <input type="month" value={searchDate} onChange={e => { setSearchDate(e.target.value); setPage(1) }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <select value={filterWeek} onChange={e => { setFilterWeek(e.target.value); setPage(1) }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="ALL">Semua Minggu</option>
                {weekOptions.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
              {(searchDate || filterWeek !== 'ALL') && (
                <button onClick={() => { setSearchDate(''); setFilterWeek('ALL'); setPage(1) }}
                  className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                  Reset Filter
                </button>
              )}
              <span className="text-xs text-gray-400 self-center ml-auto">{tableEntries.length} entri</span>
            </div>

            {entries.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">Belum ada entri EWS.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left">
                        {['Tanggal','Sleep','S.Qual','DOMS','Energy','Mood','Lelah','Stres','RHR','HRV','Score',''].map(h => (
                          <th key={h} className="text-xs font-medium text-gray-500 uppercase pb-2 pr-3 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageEntries.map(e => {
                        const st = e.composite_score != null ? getStatus(e.composite_score) : null
                        return (
                          <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2.5 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(e.entry_date)}</td>
                            <td className="py-2.5 pr-3 text-xs font-mono text-gray-700">{e.sleep_hours?.toFixed(1) ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.sleep_quality ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.muscle_soreness ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.motivation ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.mood ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.fatigue ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.stress ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.resting_hr ?? '—'}</td>
                            <td className="py-2.5 pr-3 text-xs text-gray-700 text-center">{e.hrv ?? '—'}</td>
                            <td className="py-2.5 pr-3">
                              {st && e.composite_score != null ? (
                                <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
                                  {st.icon} {e.composite_score.toFixed(1)}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-2.5">
                              <div className="flex gap-1">
                                <button onClick={() => editEntry(e)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                <button onClick={() => deleteEntry(e.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                    <div className="text-xs text-gray-400">
                      Halaman {page} dari {totalPages} · {(page-1)*ROWS_PER_PAGE+1}–{Math.min(page*ROWS_PER_PAGE, tableEntries.length)} dari {tableEntries.length} entri
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPage(1)} disabled={page === 1}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30">«</button>
                      <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30">‹</button>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        const pg = Math.max(1, Math.min(page - 2, totalPages - 4)) + i
                        return (
                          <button key={pg} onClick={() => setPage(pg)}
                            className={`w-7 h-7 rounded-lg border text-xs font-medium transition-all ${pg === page ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                            {pg}
                          </button>
                        )
                      })}
                      <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30">›</button>
                      <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
                        className="w-7 h-7 rounded-lg border border-gray-200 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30">»</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
