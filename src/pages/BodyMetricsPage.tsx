import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { useAuth } from '../contexts/AuthContext'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface BodyMetric {
  id: string
  recorded_date: string
  weight_kg: number | null
  waist_cm: number | null
  resting_hr: number | null
  body_fat_pct: number | null
  skeletal_muscle_pct: number | null
  visceral_fat_index: number | null
  bmr_kcal: number | null
  body_water_pct: number | null
  lean_body_mass_kg: number | null
  smi: number | null
  health_score: number | null
  protein_pct: number | null
  notes: string | null
}

interface AthleteProfile {
  height_cm: number | null
  birth_date: string | null
  gender: string | null
}

interface Race {
  id: string
  name: string
  event_date: string | null
  status: string
}

// ─────────────────────────────────────────────
// ALGORITHMS
// ─────────────────────────────────────────────

/** Hitung usia dari birth_date */
function calcAge(birthDate: string | null): number {
  if (!birthDate) return 30
  const today = new Date()
  const birth = new Date(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/** BMI */
function calcBMI(weight: number, heightCm: number): number {
  const h = heightCm / 100
  return weight / (h * h)
}

/** Ideal BF% range per usia & gender — Gallagher et al. (2000) */
function idealBFRange(age: number, gender: string): [number, number] {
  const isMale = gender === 'male' || gender === 'M' || gender === 'laki-laki'
  if (isMale) {
    if (age < 40) return [8, 19]
    if (age < 60) return [11, 22]
    return [13, 25]
  } else {
    if (age < 40) return [21, 33]
    if (age < 60) return [23, 35]
    return [24, 36]
  }
}

/** Runner norma BF% — Tanaka & Swensen (1998) */
function runnerNormBF(gender: string): [number, number] {
  const isMale = gender === 'male' || gender === 'M' || gender === 'laki-laki'
  return isMale ? [6, 15] : [14, 23]
}

/**
 * Race Weight Estimator
 * Formula: Race Weight = Lean Body Mass / (1 - Target BF%)
 * Sumber: Matt Fitzgerald "Racing Weight" (2009)
 */
function calcRaceWeight(leanMass: number, targetBFPct: number): number {
  const targetBF = Math.max(0.05, Math.min(0.40, targetBFPct / 100))
  return leanMass / (1 - targetBF)
}

/**
 * Ideal Body Weight fallback (Devine formula dimodifikasi)
 * Male:   IBW = 50 + 2.3 × (height_cm/2.54 - 60)
 * Female: IBW = 45.5 + 2.3 × (height_cm/2.54 - 60)
 */
function calcIBW(heightCm: number, gender: string): number {
  const isMale = gender === 'male' || gender === 'M' || gender === 'laki-laki'
  const heightIn = heightCm / 2.54
  const base = isMale ? 50 : 45.5
  return Math.max(40, base + 2.3 * (heightIn - 60))
}

/**
 * Running Weight Index (RWI)
 * Estimasi pace improvement jika berat turun X kg
 * ~2 detik/km per 1% berat badan — Joyner (1991)
 */
function calcRWI(currentWeight: number, targetWeight: number): number {
  if (currentWeight <= 0 || targetWeight <= 0) return 0
  const pctLoss = ((currentWeight - targetWeight) / currentWeight) * 100
  return pctLoss * 2 // detik/km
}

/**
 * Runner's Composition Score (RCS) 0–100
 * Composite: BF% score (40%) + Skeletal Muscle % score (40%) + VFI score (20%)
 * Sumber: Lohman (1992), Tanaka & Swensen (1998)
 */
function calcRCS(
  bodyFatPct: number | null,
  skeletalMusclePct: number | null,
  vfi: number | null,
  gender: string
): number | null {
  if (!bodyFatPct && !skeletalMusclePct && !vfi) return null
  const [bfLow, bfHigh] = runnerNormBF(gender)

  // BF Score: 100 = di bawah bfHigh, 0 = 2× bfHigh
  let bfScore = 50
  if (bodyFatPct !== null) {
    if (bodyFatPct <= bfLow) bfScore = 100
    else if (bodyFatPct <= bfHigh) bfScore = 100 - ((bodyFatPct - bfLow) / (bfHigh - bfLow)) * 30
    else bfScore = Math.max(0, 70 - ((bodyFatPct - bfHigh) / bfHigh) * 70)
  }

  // SM Score: range norma Tanaka & Swensen runner endurance pria 42–52%, wanita 35–45%
  const isMale = gender === 'male' || gender === 'M' || gender === 'laki-laki'
  const smLow = isMale ? 42 : 35
  const smHigh = isMale ? 52 : 45
  let smScore = 50
  if (skeletalMusclePct !== null) {
    if (skeletalMusclePct >= smHigh) smScore = 100
    else if (skeletalMusclePct >= smLow) smScore = 60 + ((skeletalMusclePct - smLow) / (smHigh - smLow)) * 40
    else smScore = Math.max(0, (skeletalMusclePct / smLow) * 60)
  }

  // VFI Score: Despres et al. (2006) — VFI ≤9 aman
  let vfiScore = 50
  if (vfi !== null) {
    if (vfi <= 6) vfiScore = 100
    else if (vfi <= 9) vfiScore = 100 - ((vfi - 6) / 3) * 30
    else if (vfi <= 14) vfiScore = 70 - ((vfi - 9) / 5) * 50
    else vfiScore = Math.max(0, 20 - ((vfi - 14) / 6) * 20)
  }

  const weights = [
    bodyFatPct !== null ? 0.40 : 0,
    skeletalMusclePct !== null ? 0.40 : 0,
    vfi !== null ? 0.20 : 0,
  ]
  const totalW = weights.reduce((a, b) => a + b, 0)
  if (totalW === 0) return null
  const score = (bfScore * weights[0] + smScore * weights[1] + vfiScore * weights[2]) / totalW
  return Math.round(score)
}

function rcsLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Elite', color: '#059669' }
  if (score >= 65) return { label: 'Optimal', color: '#10b981' }
  if (score >= 40) return { label: 'Cukup Baik', color: '#f59e0b' }
  return { label: 'Perlu Perbaikan', color: '#ef4444' }
}

/**
 * Body Type Tag — matriks Muscle% vs BF%
 * Diadopsi dari sistem InBody/Tanita (Gallagher 2000)
 */
function calcBodyTypeTag(
  bodyFatPct: number | null,
  skeletalMusclePct: number | null,
  gender: string
): string | null {
  if (bodyFatPct === null || skeletalMusclePct === null) return null
  const isMale = gender === 'male' || gender === 'M' || gender === 'laki-laki'
  const bfHigh = isMale ? 25 : 33
  const bfLow  = isMale ? 10 : 18
  const smHigh = isMale ? 48 : 40
  const smLow  = isMale ? 38 : 30

  const bfCat = bodyFatPct < bfLow ? 'low' : bodyFatPct <= bfHigh ? 'normal' : 'high'
  const smCat = skeletalMusclePct > smHigh ? 'high' : skeletalMusclePct >= smLow ? 'normal' : 'low'

  const matrix: Record<string, Record<string, string>> = {
    high:   { low: 'Active / Muscular', normal: 'Strong',         high: 'Masked Obesity' },
    normal: { low: 'Slightly Lean',     normal: 'Standard',       high: 'Slightly Chubby' },
    low:    { low: 'Too Lean',          normal: 'Standard — Low Muscle', high: 'Obese' },
  }
  return matrix[smCat]?.[bfCat] ?? null
}

/** Visceral Fat status — Despres (2006), Tanaka (2014) */
function vfiStatus(vfi: number): { label: string; color: string; bg: string } {
  if (vfi <= 9)  return { label: 'Aman',          color: '#059669', bg: '#d1fae5' }
  if (vfi <= 14) return { label: 'Risiko Sedang',  color: '#d97706', bg: '#fef3c7' }
  return               { label: 'Risiko Tinggi',  color: '#dc2626', bg: '#fee2e2' }
}

/** Trend analisis otomatis 4 minggu terakhir */
function buildTrendAnalysis(logs: BodyMetric[]): string[] {
  const msgs: string[] = []
  if (logs.length < 2) return msgs
  const sorted = [...logs].sort((a, b) => a.recorded_date.localeCompare(b.recorded_date))
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 28)
  const recent = sorted.filter(l => new Date(l.recorded_date) >= cutoff)
  if (recent.length < 2) return msgs

  const first = recent[0]
  const last  = recent[recent.length - 1]

  if (first.weight_kg && last.weight_kg) {
    const diff = last.weight_kg - first.weight_kg
    if (Math.abs(diff) >= 0.3) {
      msgs.push(diff < 0
        ? `Berat turun ${Math.abs(diff).toFixed(1)} kg dalam 4 minggu — progres positif.`
        : `Berat naik ${diff.toFixed(1)} kg dalam 4 minggu — pantau asupan kalori.`)
    } else {
      msgs.push('Berat badan stabil dalam 4 minggu terakhir.')
    }
  }

  if (first.body_fat_pct && last.body_fat_pct) {
    const diff = last.body_fat_pct - first.body_fat_pct
    if (Math.abs(diff) >= 0.5) {
      msgs.push(diff < 0
        ? `Body Fat turun ${Math.abs(diff).toFixed(1)}% — komposisi tubuh membaik.`
        : `Body Fat naik ${diff.toFixed(1)}% — evaluasi pola makan dan intensitas latihan.`)
    }
  }

  if (first.lean_body_mass_kg && last.lean_body_mass_kg) {
    const diff = last.lean_body_mass_kg - first.lean_body_mass_kg
    if (Math.abs(diff) >= 0.3) {
      msgs.push(diff > 0
        ? `Lean Mass naik ${diff.toFixed(1)} kg — respons positif terhadap program latihan.`
        : `Lean Mass turun ${Math.abs(diff).toFixed(1)} kg — perhatikan asupan protein (target 1.6–2.0 g/kg).`)
    }
  }

  return msgs
}

// ─────────────────────────────────────────────
// EMPTY FORM
// ─────────────────────────────────────────────
const emptyForm = {
  recorded_date: new Date().toISOString().split('T')[0],
  weight_kg: '',
  body_fat_pct: '',
  skeletal_muscle_pct: '',
  visceral_fat_index: '',
  bmr_kcal: '',
  body_water_pct: '',
  lean_body_mass_kg: '',
  smi: '',
  health_score: '',
  protein_pct: '',
  waist_cm: '',
  resting_hr: '',
  notes: '',
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────
export default function BodyMetricsPage() {
  const { athlete } = useAthlete()
  const { user } = useAuth()
  const athleteId = athlete?.id

  // Roles
  const [roles, setRoles] = useState<string[]>([])
  const canEdit = roles.includes('coach') || roles.includes('admin') || roles.includes('athlete')

  // Data
  const [logs, setLogs] = useState<BodyMetric[]>([])
  const [profile, setProfile] = useState<AthleteProfile>({ height_cm: null, birth_date: null, gender: null })
  const [races, setRaces] = useState<Race[]>([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [activeTab, setActiveTab] = useState<'overview' | 'input' | 'history'>('overview')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [targetBFInput, setTargetBFInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiFile, setAiFile] = useState<File | null>(null)

  // Load
  useEffect(() => {
    if (!athleteId || !user) return
    let cancelled = false
    Promise.all([
      loadLogs(cancelled),
      loadProfile(cancelled),
      loadRaces(cancelled),
      loadRoles(cancelled),
    ]).then(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athleteId, user])

  async function loadRoles(cancelled = false) {
    if (!user) return
    const { data } = await supabase.rpc('has_role', { role_name: 'coach' })
    const { data: isAdmin } = await supabase.rpc('has_role', { role_name: 'admin' })
    if (!cancelled) {
      const r: string[] = ['athlete']
      if (data) r.push('coach')
      if (isAdmin) r.push('admin')
      setRoles(r)
    }
  }

  async function loadLogs(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase
      .from('body_metrics')
      .select('*')
      .eq('athlete_id', athleteId)
      .order('recorded_date', { ascending: false })
      .limit(120)
    if (!cancelled && data) setLogs(data as BodyMetric[])
  }

  async function loadProfile(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase
      .from('athlete_settings')
      .select('height_cm, birth_date, gender')
      .eq('athlete_id', athleteId)
      .single()
    if (!cancelled && data) setProfile({ height_cm: data.height_cm, birth_date: data.birth_date, gender: (data as unknown as { gender: string | null }).gender })
  }

  async function loadRaces(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase
      .from('races')
      .select('id, name, event_date, status')
      .eq('athlete_id', athleteId)
      .eq('status', 'A')
      .gte('event_date', new Date().toISOString().split('T')[0])
      .order('event_date', { ascending: true })
    if (!cancelled && data) setRaces(data as Race[])
  }

  // ── Save ──
  async function handleSave() {
    if (!athleteId) return
    if (!form.recorded_date || !form.weight_kg) {
      showToast('Tanggal dan berat badan wajib diisi.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('body_metrics').upsert({
      athlete_id: athleteId,
      recorded_date: form.recorded_date,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
      body_fat_pct: form.body_fat_pct ? parseFloat(form.body_fat_pct) : null,
      skeletal_muscle_pct: form.skeletal_muscle_pct ? parseFloat(form.skeletal_muscle_pct) : null,
      visceral_fat_index: form.visceral_fat_index ? parseFloat(form.visceral_fat_index) : null,
      bmr_kcal: form.bmr_kcal ? parseFloat(form.bmr_kcal) : null,
      body_water_pct: form.body_water_pct ? parseFloat(form.body_water_pct) : null,
      lean_body_mass_kg: form.lean_body_mass_kg ? parseFloat(form.lean_body_mass_kg) : null,
      smi: form.smi ? parseFloat(form.smi) : null,
      health_score: form.health_score ? parseFloat(form.health_score) : null,
      protein_pct: form.protein_pct ? parseFloat(form.protein_pct) : null,
      waist_cm: form.waist_cm ? parseFloat(form.waist_cm) : null,
      resting_hr: form.resting_hr ? parseInt(form.resting_hr) : null,
      notes: form.notes || null,
    }, { onConflict: 'athlete_id,recorded_date' })
    setSaving(false)
    if (error) { showToast('Gagal menyimpan: ' + error.message); return }
    setForm(emptyForm)
    await loadLogs()
    showToast('Data berhasil disimpan!')
    setActiveTab('overview')
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await supabase.from('body_metrics').delete().eq('id', id)
    await loadLogs()
    showToast('Data dihapus.')
  }

  // ── AI Import ──
  async function handleAIImport() {
    if (!aiFile) { showToast('Pilih foto laporan terlebih dahulu.'); return }
    setAiLoading(true)
    try {
      const base64 = await fileToBase64(aiFile)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: aiFile.type as 'image/jpeg' | 'image/png', data: base64 }
              },
              {
                type: 'text',
                text: `Extract body composition data from this report image. Return ONLY a JSON object with these keys (use null if not found):
weight_kg, body_fat_pct, skeletal_muscle_pct, visceral_fat_index, bmr_kcal, body_water_pct, lean_body_mass_kg, smi, health_score, protein_pct, waist_cm.
All values must be numbers or null. No other text.`
              }
            ]
          }]
        })
      })
      const data = await res.json()
      const text = data.content?.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '').join('') ?? ''
      const clean = text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(clean)
      setForm(prev => ({
        ...prev,
        weight_kg: parsed.weight_kg?.toString() ?? prev.weight_kg,
        body_fat_pct: parsed.body_fat_pct?.toString() ?? prev.body_fat_pct,
        skeletal_muscle_pct: parsed.skeletal_muscle_pct?.toString() ?? prev.skeletal_muscle_pct,
        visceral_fat_index: parsed.visceral_fat_index?.toString() ?? prev.visceral_fat_index,
        bmr_kcal: parsed.bmr_kcal?.toString() ?? prev.bmr_kcal,
        body_water_pct: parsed.body_water_pct?.toString() ?? prev.body_water_pct,
        lean_body_mass_kg: parsed.lean_body_mass_kg?.toString() ?? prev.lean_body_mass_kg,
        smi: parsed.smi?.toString() ?? prev.smi,
        health_score: parsed.health_score?.toString() ?? prev.health_score,
        protein_pct: parsed.protein_pct?.toString() ?? prev.protein_pct,
        waist_cm: parsed.waist_cm?.toString() ?? prev.waist_cm,
      }))
      showToast('Data berhasil diimpor dari foto — mohon verifikasi sebelum menyimpan.')
    } catch {
      showToast('Gagal mengekstrak data dari foto.')
    }
    setAiLoading(false)
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  // ── Derived values ──
  const latest = logs[0] ?? null
  const age = calcAge(profile.birth_date)
  const gender = profile.gender ?? 'male'
  const heightCm = profile.height_cm ?? 170

  const bmi = latest?.weight_kg ? calcBMI(latest.weight_kg, heightCm) : null
  const bmiLabel = bmi
    ? bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'
    : null
  const bmiColor = bmi
    ? bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444'
    : '#6b7280'

  const fatMass = latest?.weight_kg && latest?.body_fat_pct
    ? (latest.body_fat_pct / 100) * latest.weight_kg
    : null

  const leanMass = latest?.lean_body_mass_kg
    ?? (latest?.weight_kg && fatMass !== null ? latest.weight_kg - fatMass : null)

  const rcs = calcRCS(latest?.body_fat_pct ?? null, latest?.skeletal_muscle_pct ?? null, latest?.visceral_fat_index ?? null, gender)
  const bodyTypeTag = calcBodyTypeTag(latest?.body_fat_pct ?? null, latest?.skeletal_muscle_pct ?? null, gender)
  const trendMsgs = useMemo(() => buildTrendAnalysis(logs), [logs])

  // Race Weight Estimator
  const targetRace = races.length > 0 ? races[0] : null
  const daysToRace = targetRace?.event_date
    ? Math.ceil((new Date(targetRace.event_date).getTime() - new Date().getTime()) / 86400000)
    : null
  const [bfLow, bfHigh] = idealBFRange(age, gender)
  const [runBfLow] = runnerNormBF(gender)
  const defaultTargetBF = targetRace ? runBfLow : bfLow
  const targetBF = targetBFInput ? parseFloat(targetBFInput) : defaultTargetBF
  const effectiveLean = leanMass ?? (latest?.weight_kg ? latest.weight_kg * 0.75 : null)
  const raceWeight = effectiveLean && targetBF ? calcRaceWeight(effectiveLean, targetBF) : null
  const ibw = calcIBW(heightCm, gender)
  const weightGap = raceWeight && latest?.weight_kg ? latest.weight_kg - raceWeight : null
  const rwi = raceWeight && latest?.weight_kg ? calcRWI(latest.weight_kg, raceWeight) : null
  const safeWeeklyLoss = 0.5 // kg/minggu — ACSM recommendation
  const weeksNeeded = weightGap && weightGap > 0 ? weightGap / safeWeeklyLoss : null

  // Chart data
  const chartData = useMemo(() => {
    return [...logs].reverse().map(l => ({
      date: new Date(l.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      'Lean Mass (kg)': l.lean_body_mass_kg ?? undefined,
      'Fat Mass (kg)': (l.body_fat_pct && l.weight_kg) ? parseFloat(((l.body_fat_pct / 100) * l.weight_kg).toFixed(1)) : undefined,
      'Berat (kg)': l.weight_kg ?? undefined,
    }))
  }, [logs])

  // ─────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────
  const sectionCls = 'bg-white rounded-xl shadow-sm p-5 mb-5'
  const headerCls  = 'font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4'
  const labelCls   = 'block text-xs font-medium text-gray-500 uppercase mb-1'
  const valueCls   = 'text-sm font-bold text-gray-800'
  const inputCls   = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300'

  if (loading) return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      <p className="text-gray-400 text-sm">Memuat data...</p>
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="font-gsans text-2xl text-gray-900">Body Metrics</h1>
        <p className="text-sm text-gray-500 mt-1">Monitoring komposisi tubuh & proyeksi berat ideal</p>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-2">
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'input',    label: 'Input Data' },
          { key: 'history',  label: 'Riwayat' },
        ].map(t => (
          <button key={t.key}
            onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          TAB: OVERVIEW
      ══════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <>
          {!latest ? (
            <div className={sectionCls}>
              <p className="text-center text-gray-400 py-8">Belum ada data. Mulai input pengukuran pertama.</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className={sectionCls}>
                <h2 className={headerCls}>Pengukuran Terkini</h2>
                <p className="text-xs text-gray-400 mb-4">
                  {new Date(latest.recorded_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Berat Badan', value: latest.weight_kg ? `${latest.weight_kg} kg` : '—', color: '#4f46e5' },
                    { label: 'BMI', value: bmi ? `${bmi.toFixed(1)} (${bmiLabel})` : '—', color: bmiColor },
                    { label: 'Body Fat %', value: latest.body_fat_pct ? `${latest.body_fat_pct}%` : '—', color: '#ef4444' },
                    { label: 'Lean Mass', value: leanMass ? `${leanMass.toFixed(1)} kg` : '—', color: '#10b981' },
                    { label: 'Fat Mass', value: fatMass ? `${fatMass.toFixed(1)} kg` : '—', color: '#f59e0b' },
                    { label: 'Skeletal Muscle', value: latest.skeletal_muscle_pct ? `${latest.skeletal_muscle_pct}%` : '—', color: '#8b5cf6' },
                    { label: 'Visceral Fat Index', value: latest.visceral_fat_index ? `${latest.visceral_fat_index}` : '—', color: '#6b7280' },
                    { label: 'BMR', value: latest.bmr_kcal ? `${latest.bmr_kcal} kcal` : '—', color: '#6b7280' },
                    { label: 'Body Water %', value: latest.body_water_pct ? `${latest.body_water_pct}%` : '—', color: '#0ea5e9' },
                    { label: 'Protein %', value: latest.protein_pct ? `${latest.protein_pct}%` : '—', color: '#6b7280' },
                    { label: 'SMI', value: latest.smi ? `${latest.smi}` : '—', color: '#6b7280' },
                    { label: 'Health Score', value: latest.health_score ? `${latest.health_score}` : '—', color: '#4f46e5' },
                  ].map(c => (
                    <div key={c.label} className="bg-gray-50 rounded-lg p-3">
                      <p className={labelCls}>{c.label}</p>
                      <p className="text-sm font-bold" style={{ color: c.color }}>{c.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visceral Fat Alert */}
              {latest.visceral_fat_index !== null && latest.visceral_fat_index !== undefined && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Visceral Fat Alert</h2>
                  {(() => {
                    const vs = vfiStatus(latest.visceral_fat_index!)
                    return (
                      <div className="flex items-center gap-4 p-4 rounded-lg" style={{ backgroundColor: vs.bg }}>
                        <div className="text-2xl font-bold" style={{ color: vs.color }}>
                          VFI {latest.visceral_fat_index}
                        </div>
                        <div>
                          <p className="text-sm font-bold" style={{ color: vs.color }}>{vs.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Threshold: VFI ≤9 aman, 10–14 risiko sedang, ≥15 risiko tinggi
                            <span className="ml-1 text-gray-400">(Despres et al. 2006; Tanaka et al. 2014)</span>
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Runner's Composition Score */}
              {rcs !== null && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Runner's Composition Score (RCS)</h2>
                  <div className="flex items-center gap-6">
                    <div className="text-5xl font-bold" style={{ color: rcsLabel(rcs).color }}>
                      {rcs}
                    </div>
                    <div>
                      <p className="text-lg font-bold" style={{ color: rcsLabel(rcs).color }}>{rcsLabel(rcs).label}</p>
                      <p className="text-xs text-gray-400 mt-1 max-w-md">
                        Composite score dari Body Fat % (40%), Skeletal Muscle % (40%), dan Visceral Fat Index (20%)
                        terhadap norma runner endurance.
                        <span className="ml-1">(Lohman 1992; Tanaka & Swensen 1998)</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${rcs}%`, backgroundColor: rcsLabel(rcs).color }}
                    />
                  </div>
                </div>
              )}

              {/* Body Type Tag */}
              {bodyTypeTag && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Body Type</h2>
                  <div className="inline-block px-4 py-2 bg-indigo-50 rounded-lg">
                    <p className="text-lg font-bold text-indigo-700">{bodyTypeTag}</p>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    Berdasarkan matriks Skeletal Muscle % vs Body Fat % per gender.
                    <span className="ml-1">(Gallagher et al. 2000; sistem InBody/Tanita)</span>
                  </p>
                </div>
              )}

              {/* Race Weight Estimator */}
              <div className={sectionCls}>
                <h2 className={headerCls}>Race Weight Estimator</h2>
                <p className="text-xs text-gray-400 mb-4">
                  Formula: Race Weight = Lean Mass ÷ (1 − Target BF%).
                  <span className="ml-1">(Matt Fitzgerald "Racing Weight", 2009; Maughan & Leiper 1983)</span>
                </p>

                {/* Race Target Info */}
                {targetRace ? (
                  <div className="mb-4 p-3 bg-indigo-50 rounded-lg text-sm">
                    <span className="font-semibold text-indigo-700">Race A: {targetRace.name}</span>
                    <span className="ml-3 text-gray-500">
                      {targetRace.event_date ? new Date(targetRace.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                    </span>
                    {daysToRace !== null && (
                      <span className="ml-3 text-indigo-600 font-medium">{daysToRace} hari lagi</span>
                    )}
                  </div>
                ) : (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                    Tidak ada Race A aktif — menggunakan target berat ideal umum (Devine Formula).
                    <span className="ml-1">IBW: <strong>{ibw.toFixed(1)} kg</strong></span>
                  </div>
                )}

                {/* Target BF% Input */}
                <div className="flex items-center gap-3 mb-5">
                  <div>
                    <label className={labelCls}>Target Body Fat %</label>
                    <input
                      type="number" step="0.1" min="5" max="35"
                      placeholder={defaultTargetBF.toString()}
                      value={targetBFInput}
                      onChange={e => setTargetBFInput(e.target.value)}
                      className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div className="text-xs text-gray-400 mt-4">
                    Range ideal runner: <strong>{runnerNormBF(gender)[0]}–{runnerNormBF(gender)[1]}%</strong>
                    &nbsp;·&nbsp; Range ideal umum: <strong>{bfLow}–{bfHigh}%</strong>
                  </div>
                </div>

                {/* Hasil */}
                {latest?.weight_kg && effectiveLean && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className={labelCls}>Berat Terkini</p>
                      <p className={`${valueCls} text-lg`}>{latest.weight_kg} kg</p>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3">
                      <p className={labelCls}>Race Weight Target</p>
                      <p className="text-lg font-bold text-indigo-700">{raceWeight?.toFixed(1) ?? '—'} kg</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className={labelCls}>Gap</p>
                      <p className={`text-lg font-bold ${weightGap && weightGap > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {weightGap !== null ? (weightGap > 0 ? `−${weightGap.toFixed(1)} kg` : '✓ Sudah tercapai') : '—'}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className={labelCls}>Estimasi Waktu Aman</p>
                      <p className={valueCls}>
                        {weeksNeeded ? `${weeksNeeded.toFixed(1)} minggu` : weightGap !== null && weightGap <= 0 ? 'Tercapai' : '—'}
                      </p>
                      <p className="text-xs text-gray-400">≤0.5 kg/minggu (ACSM)</p>
                    </div>
                  </div>
                )}

                {/* RWI */}
                {rwi !== null && rwi > 0 && (
                  <div className="mt-4 p-3 bg-green-50 rounded-lg">
                    <p className="text-xs font-medium text-green-800">
                      Running Weight Index: Jika target berat tercapai, estimasi pace improvement
                      <span className="font-bold text-green-700"> ~{rwi.toFixed(0)} detik/km</span>
                      <span className="text-green-600 ml-1">(Joyner 1991; Landers et al. 2013)</span>
                    </p>
                    {daysToRace !== null && weeksNeeded !== null && weeksNeeded * 7 > daysToRace && (
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠ Waktu yang dibutuhkan ({weeksNeeded.toFixed(1)} minggu) melebihi sisa hari menuju race — pertimbangkan target BF% yang lebih realistis.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Trend Komposisi Multi-Line */}
              {chartData.filter(d => d['Lean Mass (kg)'] || d['Fat Mass (kg)']).length > 1 && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Trend Komposisi Tubuh</h2>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="Lean Mass (kg)" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Fat Mass (kg)" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                      <Line type="monotone" dataKey="Berat (kg)" stroke="#4f46e5" strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Trend Analisis Otomatis */}
              {trendMsgs.length > 0 && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Analisis Trend (4 Minggu Terakhir)</h2>
                  <ul className="space-y-2">
                    {trendMsgs.map((msg, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-indigo-400 mt-0.5">→</span>
                        <span>{msg}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Muscle Balance Monitoring */}
              <div className={sectionCls}>
                <h2 className={headerCls}>Muscle Balance</h2>
                <p className="text-xs text-gray-500 mb-2">
                  Data segmental dari timbangan bioimpedansi. Flag jika gap L/R &gt;15%.
                  <span className="ml-1 text-gray-400">(Rauh et al. 2006; Niemuth et al. 2005)</span>
                </p>
                <div className="p-3 bg-amber-50 rounded-lg text-xs text-amber-700">
                  ⚠ Data ini mencerminkan distribusi lemak segmental, bukan kekuatan otot. Bukan pengganti functional strength assessment klinis.
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Fitur input data segmental (L/R arm, trunk, L/R leg) tersedia di form Input Data.
                </p>
              </div>
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════
          TAB: INPUT DATA
      ══════════════════════════════════════════ */}
      {activeTab === 'input' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Input Pengukuran Baru</h2>

          {/* AI Import */}
          <div className="mb-6 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
            <p className="text-xs font-medium text-indigo-700 mb-2 uppercase tracking-wide">Import dari Foto Laporan (AI)</p>
            <p className="text-xs text-gray-500 mb-3">
              Upload foto laporan timbangan bioimpedansi — data akan diekstrak otomatis. Verifikasi sebelum menyimpan.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="file" accept="image/*"
                onChange={e => setAiFile(e.target.files?.[0] ?? null)}
                className="text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer"
              />
              <button
                onClick={handleAIImport}
                disabled={!aiFile || aiLoading}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {aiLoading ? 'Mengekstrak...' : 'Ekstrak Data'}
              </button>
            </div>
          </div>

          {/* Form Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
            <div>
              <label className={labelCls}>Tanggal *</label>
              <input type="date" value={form.recorded_date} className={inputCls}
                onChange={e => setForm(p => ({ ...p, recorded_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Berat Badan (kg) *</label>
              <input type="number" step="0.1" placeholder="69.5" value={form.weight_kg} className={inputCls}
                onChange={e => setForm(p => ({ ...p, weight_kg: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Body Fat %</label>
              <input type="number" step="0.1" placeholder="24.7" value={form.body_fat_pct} className={inputCls}
                onChange={e => setForm(p => ({ ...p, body_fat_pct: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Skeletal Muscle %</label>
              <input type="number" step="0.1" placeholder="42.2" value={form.skeletal_muscle_pct} className={inputCls}
                onChange={e => setForm(p => ({ ...p, skeletal_muscle_pct: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Visceral Fat Index</label>
              <input type="number" step="0.1" placeholder="6" value={form.visceral_fat_index} className={inputCls}
                onChange={e => setForm(p => ({ ...p, visceral_fat_index: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>BMR (kcal)</label>
              <input type="number" placeholder="1507" value={form.bmr_kcal} className={inputCls}
                onChange={e => setForm(p => ({ ...p, bmr_kcal: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Body Water %</label>
              <input type="number" step="0.1" placeholder="55.3" value={form.body_water_pct} className={inputCls}
                onChange={e => setForm(p => ({ ...p, body_water_pct: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Lean Body Mass (kg)</label>
              <input type="number" step="0.1" placeholder="52.6" value={form.lean_body_mass_kg} className={inputCls}
                onChange={e => setForm(p => ({ ...p, lean_body_mass_kg: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Protein %</label>
              <input type="number" step="0.1" placeholder="14.9" value={form.protein_pct} className={inputCls}
                onChange={e => setForm(p => ({ ...p, protein_pct: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>SMI</label>
              <input type="number" step="0.1" placeholder="8.2" value={form.smi} className={inputCls}
                onChange={e => setForm(p => ({ ...p, smi: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Health Score</label>
              <input type="number" placeholder="79" value={form.health_score} className={inputCls}
                onChange={e => setForm(p => ({ ...p, health_score: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Lingkar Perut (cm)</label>
              <input type="number" step="0.5" placeholder="82" value={form.waist_cm} className={inputCls}
                onChange={e => setForm(p => ({ ...p, waist_cm: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Resting HR (bpm)</label>
              <input type="number" placeholder="52" value={form.resting_hr} className={inputCls}
                onChange={e => setForm(p => ({ ...p, resting_hr: e.target.value }))} />
            </div>
            <div className="col-span-2 md:col-span-3 lg:col-span-4">
              <label className={labelCls}>Catatan</label>
              <input type="text" placeholder="Catatan opsional..." value={form.notes} className={inputCls}
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          {/* Live Preview */}
          {form.weight_kg && (
            <div className="mb-5 p-4 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-500 uppercase mb-3">Preview Kalkulasi</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(() => {
                  const w = parseFloat(form.weight_kg)
                  const bf = form.body_fat_pct ? parseFloat(form.body_fat_pct) : null
                  const sm = form.skeletal_muscle_pct ? parseFloat(form.skeletal_muscle_pct) : null
                  const vfi = form.visceral_fat_index ? parseFloat(form.visceral_fat_index) : null
                  const bmiVal = calcBMI(w, heightCm)
                  const fatMassVal = bf ? (bf / 100) * w : null
                  const leanVal = form.lean_body_mass_kg ? parseFloat(form.lean_body_mass_kg) : (fatMassVal !== null ? w - fatMassVal : null)
                  const rcsVal = calcRCS(bf, sm, vfi, gender)
                  const tagVal = calcBodyTypeTag(bf, sm, gender)
                  return (
                    <>
                      <div>
                        <p className={labelCls}>BMI</p>
                        <p className={valueCls}>{bmiVal.toFixed(1)}</p>
                      </div>
                      {fatMassVal !== null && <div><p className={labelCls}>Fat Mass</p><p className={valueCls}>{fatMassVal.toFixed(1)} kg</p></div>}
                      {leanVal !== null && <div><p className={labelCls}>Lean Mass</p><p className={valueCls}>{leanVal.toFixed(1)} kg</p></div>}
                      {rcsVal !== null && <div><p className={labelCls}>RCS</p><p className="text-sm font-bold" style={{ color: rcsLabel(rcsVal).color }}>{rcsVal} — {rcsLabel(rcsVal).label}</p></div>}
                      {tagVal && <div className="col-span-2"><p className={labelCls}>Body Type</p><p className={valueCls}>{tagVal}</p></div>}
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving || !canEdit}
              className="px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setForm(emptyForm)}
              className="px-6 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Reset
            </button>
          </div>
          {!canEdit && (
            <p className="text-xs text-gray-400 mt-2">Hanya coach atau admin yang dapat menyimpan data.</p>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB: RIWAYAT
      ══════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Riwayat Pengukuran</h2>
          {logs.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Belum ada data pengukuran.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Tanggal','Berat','BF%','Fat Mass','Lean Mass','BMI','SM%','VFI','BMR','Waist','RHR','Score','Catatan',''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 uppercase pb-2 pr-4 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => {
                    const bmiV = l.weight_kg ? calcBMI(l.weight_kg, heightCm) : null
                    const fatMV = l.body_fat_pct && l.weight_kg ? (l.body_fat_pct / 100) * l.weight_kg : null
                    const leanV = l.lean_body_mass_kg ?? (l.weight_kg && fatMV !== null ? l.weight_kg - fatMV : null)
                    return (
                      <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                          {new Date(l.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="py-2 pr-4 font-bold text-indigo-700">{l.weight_kg ?? '—'}</td>
                        <td className="py-2 pr-4">{l.body_fat_pct ? `${l.body_fat_pct}%` : '—'}</td>
                        <td className="py-2 pr-4">{fatMV ? `${fatMV.toFixed(1)}` : '—'}</td>
                        <td className="py-2 pr-4 text-green-600 font-medium">{leanV ? `${leanV.toFixed(1)}` : '—'}</td>
                        <td className="py-2 pr-4" style={{ color: bmiV ? (bmiV < 25 ? '#10b981' : bmiV < 30 ? '#f59e0b' : '#ef4444') : '#6b7280' }}>
                          {bmiV ? bmiV.toFixed(1) : '—'}
                        </td>
                        <td className="py-2 pr-4">{l.skeletal_muscle_pct ? `${l.skeletal_muscle_pct}%` : '—'}</td>
                        <td className="py-2 pr-4">{l.visceral_fat_index ?? '—'}</td>
                        <td className="py-2 pr-4">{l.bmr_kcal ?? '—'}</td>
                        <td className="py-2 pr-4">{l.waist_cm ? `${l.waist_cm} cm` : '—'}</td>
                        <td className="py-2 pr-4">{l.resting_hr ? `${l.resting_hr} bpm` : '—'}</td>
                        <td className="py-2 pr-4">{l.health_score ?? '—'}</td>
                        <td className="py-2 pr-4 text-gray-400 text-xs max-w-[120px] truncate">{l.notes ?? ''}</td>
                        <td className="py-2">
                          <button
                            onClick={() => handleDelete(l.id)}
                            className="border border-red-200 text-red-500 text-xs px-3 py-1 rounded-lg hover:bg-red-50 transition-colors">
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
