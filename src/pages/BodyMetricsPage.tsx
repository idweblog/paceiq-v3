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
  seg_arm_left: number | null
  seg_arm_right: number | null
  seg_trunk: number | null
  seg_leg_left: number | null
  seg_leg_right: number | null
  seg_muscle_arm_left: number | null
  seg_muscle_arm_right: number | null
  seg_muscle_trunk: number | null
  seg_muscle_leg_left: number | null
  seg_muscle_leg_right: number | null
  notes: string | null
}

interface AthleteProfile {
  height_cm: number | null
  birth_date: string | null
  gender: string | null
  resting_hr: number | null
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

function calcAge(birthDate: string | null): number {
  if (!birthDate) return 30
  const today = new Date()
  const birth = new Date(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

function calcBMI(weight: number, heightCm: number): number {
  const h = heightCm / 100
  return weight / (h * h)
}

function idealBFRange(age: number, gender: string): [number, number] {
  const isMale = gender === 'male'
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

function runnerNormBF(gender: string): [number, number] {
  return gender === 'male' ? [6, 15] : [14, 23]
}

function calcRaceWeight(leanMass: number, targetBFPct: number): number {
  const targetBF = Math.max(0.05, Math.min(0.40, targetBFPct / 100))
  return leanMass / (1 - targetBF)
}

function calcIBW(heightCm: number, gender: string): number {
  const heightIn = heightCm / 2.54
  const base = gender === 'male' ? 50 : 45.5
  return Math.max(40, base + 2.3 * (heightIn - 60))
}

function calcRWI(currentWeight: number, targetWeight: number): number {
  if (currentWeight <= 0 || targetWeight <= 0) return 0
  const pctLoss = ((currentWeight - targetWeight) / currentWeight) * 100
  return pctLoss * 2
}

function calcRCS(
  bodyFatPct: number | null,
  skeletalMusclePct: number | null,
  vfi: number | null,
  gender: string
): number | null {
  if (!bodyFatPct && !skeletalMusclePct && !vfi) return null
  const [bfLow, bfHigh] = runnerNormBF(gender)
  let bfScore = 50
  if (bodyFatPct !== null) {
    if (bodyFatPct <= bfLow) bfScore = 100
    else if (bodyFatPct <= bfHigh) bfScore = 100 - ((bodyFatPct - bfLow) / (bfHigh - bfLow)) * 30
    else bfScore = Math.max(0, 70 - ((bodyFatPct - bfHigh) / bfHigh) * 70)
  }
  const isMale = gender === 'male'
  const smLow = isMale ? 42 : 35
  const smHigh = isMale ? 52 : 45
  let smScore = 50
  if (skeletalMusclePct !== null) {
    if (skeletalMusclePct >= smHigh) smScore = 100
    else if (skeletalMusclePct >= smLow) smScore = 60 + ((skeletalMusclePct - smLow) / (smHigh - smLow)) * 40
    else smScore = Math.max(0, (skeletalMusclePct / smLow) * 60)
  }
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
  return Math.round((bfScore * weights[0] + smScore * weights[1] + vfiScore * weights[2]) / totalW)
}

function rcsLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Elite', color: '#059669' }
  if (score >= 65) return { label: 'Optimal', color: '#10b981' }
  if (score >= 40) return { label: 'Cukup Baik', color: '#f59e0b' }
  return { label: 'Perlu Perbaikan', color: '#ef4444' }
}

function calcBodyTypeTag(bodyFatPct: number | null, skeletalMusclePct: number | null, gender: string): string | null {
  if (bodyFatPct === null || skeletalMusclePct === null) return null
  const isMale = gender === 'male'
  const bfHigh = isMale ? 25 : 33
  const bfLow  = isMale ? 10 : 18
  const smHigh = isMale ? 48 : 40
  const smLow  = isMale ? 38 : 30
  const bfCat = bodyFatPct < bfLow ? 'low' : bodyFatPct <= bfHigh ? 'normal' : 'high'
  const smCat = skeletalMusclePct > smHigh ? 'high' : skeletalMusclePct >= smLow ? 'normal' : 'low'
  const matrix: Record<string, Record<string, string>> = {
    high:   { low: 'Active / Muscular', normal: 'Strong',              high: 'Masked Obesity' },
    normal: { low: 'Slightly Lean',     normal: 'Standard',            high: 'Slightly Chubby' },
    low:    { low: 'Too Lean',          normal: 'Standard — Low Muscle', high: 'Obese' },
  }
  return matrix[smCat]?.[bfCat] ?? null
}

function vfiStatus(vfi: number): { label: string; color: string; bg: string } {
  if (vfi <= 9)  return { label: 'Aman',         color: '#059669', bg: '#d1fae5' }
  if (vfi <= 14) return { label: 'Risiko Sedang', color: '#d97706', bg: '#fef3c7' }
  return               { label: 'Risiko Tinggi', color: '#dc2626', bg: '#fee2e2' }
}

function buildTrendAnalysis(logs: BodyMetric[]): string[] {
  const msgs: string[] = []
  if (logs.length < 2) return msgs
  const sorted = [...logs].sort((a, b) => a.recorded_date.localeCompare(b.recorded_date))
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28)
  const recent = sorted.filter(l => new Date(l.recorded_date) >= cutoff)
  if (recent.length < 2) return msgs
  const first = recent[0], last = recent[recent.length - 1]
  if (first.weight_kg && last.weight_kg) {
    const diff = last.weight_kg - first.weight_kg
    if (Math.abs(diff) >= 0.3)
      msgs.push(diff < 0 ? `Berat turun ${Math.abs(diff).toFixed(1)} kg dalam 4 minggu — progres positif.` : `Berat naik ${diff.toFixed(1)} kg dalam 4 minggu — pantau asupan kalori.`)
    else msgs.push('Berat badan stabil dalam 4 minggu terakhir.')
  }
  if (first.body_fat_pct && last.body_fat_pct) {
    const diff = last.body_fat_pct - first.body_fat_pct
    if (Math.abs(diff) >= 0.5)
      msgs.push(diff < 0 ? `Body Fat turun ${Math.abs(diff).toFixed(1)}% — komposisi tubuh membaik.` : `Body Fat naik ${diff.toFixed(1)}% — evaluasi pola makan dan intensitas latihan.`)
  }
  if (first.lean_body_mass_kg && last.lean_body_mass_kg) {
    const diff = last.lean_body_mass_kg - first.lean_body_mass_kg
    if (Math.abs(diff) >= 0.3)
      msgs.push(diff > 0 ? `Lean Mass naik ${diff.toFixed(1)} kg — respons positif terhadap program latihan.` : `Lean Mass turun ${Math.abs(diff).toFixed(1)} kg — perhatikan asupan protein (target 1.6–2.0 g/kg).`)
  }
  return msgs
}

function segGap(left: number | null, right: number | null): { pct: number; flag: boolean } | null {
  if (!left || !right) return null
  const gap = Math.abs(left - right) / Math.max(left, right) * 100
  return { pct: parseFloat(gap.toFixed(1)), flag: gap > 15 }
}

// ─────────────────────────────────────────────
// EMPTY FORM  (resting_hr dihapus dari form)
// ─────────────────────────────────────────────
const emptyForm = {
  recorded_date: new Date().toISOString().split('T')[0],
  weight_kg: '', body_fat_pct: '', skeletal_muscle_pct: '',
  visceral_fat_index: '', bmr_kcal: '', body_water_pct: '',
  lean_body_mass_kg: '', smi: '', health_score: '', protein_pct: '',
  waist_cm: '',
  seg_arm_left: '', seg_arm_right: '', seg_trunk: '',
  seg_leg_left: '', seg_leg_right: '',
  seg_muscle_arm_left: '', seg_muscle_arm_right: '', seg_muscle_trunk: '',
  seg_muscle_leg_left: '', seg_muscle_leg_right: '',
  notes: '',
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────
export default function BodyMetricsPage() {
  const { athlete } = useAthlete()
  const { user } = useAuth()
  const athleteId = athlete?.id

  const [roles, setRoles] = useState<string[]>([])
  const canEdit = roles.includes('coach') || roles.includes('admin') || roles.includes('athlete')

  const [logs, setLogs] = useState<BodyMetric[]>([])
  const [profile, setProfile] = useState<AthleteProfile>({ height_cm: null, birth_date: null, gender: null, resting_hr: null })
  const [races, setRaces] = useState<Race[]>([])
  const [ewsRHR, setEwsRHR] = useState<number | null>(null)  // rata-rata RHR 7 hari dari EWS
  const [loading, setLoading] = useState(true)

  const [activeTab, setActiveTab] = useState<'overview' | 'input' | 'history'>('overview')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [targetBFInput, setTargetBFInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiFile, setAiFile] = useState<File | null>(null)

  useEffect(() => {
    if (!athleteId || !user) return
    let cancelled = false
    Promise.all([
      loadLogs(cancelled),
      loadProfile(cancelled),
      loadRaces(cancelled),
      loadRoles(cancelled),
      loadEwsRHR(cancelled),
    ]).then(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [athleteId, user])

  async function loadRoles(cancelled = false) {
    if (!user) return
    const { data: isCoach } = await supabase.rpc('has_role', { role_name: 'coach' })
    const { data: isAdmin } = await supabase.rpc('has_role', { role_name: 'admin' })
    if (!cancelled) {
      const r: string[] = ['athlete']
      if (isCoach) r.push('coach')
      if (isAdmin) r.push('admin')
      setRoles(r)
    }
  }

  async function loadLogs(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase.from('body_metrics').select('*')
      .eq('athlete_id', athleteId).order('recorded_date', { ascending: false }).limit(120)
    if (!cancelled && data) setLogs(data as unknown as BodyMetric[])
  }

  async function loadProfile(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase.from('athlete_settings')
      .select('height_cm, birth_date, gender, resting_hr').eq('athlete_id', athleteId).single()
    if (!cancelled && data) setProfile({
      height_cm: data.height_cm,
      birth_date: data.birth_date,
      gender: (data as unknown as { gender: string | null }).gender,
      resting_hr: (data as unknown as { resting_hr: number | null }).resting_hr,
    })
  }

  async function loadRaces(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase.from('races').select('id, name, event_date, status')
      .eq('athlete_id', athleteId).eq('status', 'A')
      .gte('event_date', new Date().toISOString().split('T')[0])
      .order('event_date', { ascending: true })
    if (!cancelled && data) setRaces(data as Race[])
  }

  // Ambil rata-rata RHR 7 hari terakhir dari ews_entries
  async function loadEwsRHR(cancelled = false) {
    if (!athleteId) return
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 7)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const { data } = await supabase
      .from('ews_entries')
      .select('resting_hr')
      .eq('athlete_id', athleteId)
      .gte('entry_date', cutoffStr)
      .not('resting_hr', 'is', null)
    if (!cancelled && data && data.length > 0) {
      const valid = data.map((d: { resting_hr: number }) => d.resting_hr).filter((v: number) => v > 0 && v < 200)
      if (valid.length > 0) {
        const avg = Math.round(valid.reduce((a: number, b: number) => a + b, 0) / valid.length)
        setEwsRHR(avg)
      }
    }
  }

  // RHR efektif: prioritas EWS, fallback athlete_settings
  const effectiveRHR = ewsRHR ?? profile.resting_hr ?? null
  const rhrSource = ewsRHR ? 'Rata-rata 7 hari EWS' : profile.resting_hr ? 'Profil Atlet' : null

  async function handleSave() {
    if (!athleteId) return
    if (!form.recorded_date || !form.weight_kg) { showToast('Tanggal dan berat badan wajib diisi.'); return }
    setSaving(true)
    const { error } = await (supabase as any).from('body_metrics').upsert({
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
      // resting_hr tidak lagi diisi manual — kolom tetap di DB tapi diisi null
      resting_hr: null,
      seg_arm_left: form.seg_arm_left ? parseFloat(form.seg_arm_left) : null,
      seg_arm_right: form.seg_arm_right ? parseFloat(form.seg_arm_right) : null,
      seg_trunk: form.seg_trunk ? parseFloat(form.seg_trunk) : null,
      seg_leg_left: form.seg_leg_left ? parseFloat(form.seg_leg_left) : null,
      seg_leg_right: form.seg_leg_right ? parseFloat(form.seg_leg_right) : null,
      seg_muscle_arm_left: form.seg_muscle_arm_left ? parseFloat(form.seg_muscle_arm_left) : null,
      seg_muscle_arm_right: form.seg_muscle_arm_right ? parseFloat(form.seg_muscle_arm_right) : null,
      seg_muscle_trunk: form.seg_muscle_trunk ? parseFloat(form.seg_muscle_trunk) : null,
      seg_muscle_leg_left: form.seg_muscle_leg_left ? parseFloat(form.seg_muscle_leg_left) : null,
      seg_muscle_leg_right: form.seg_muscle_leg_right ? parseFloat(form.seg_muscle_leg_right) : null,
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

  function handleEdit(l: BodyMetric) {
    setForm({
      recorded_date: l.recorded_date,
      weight_kg: l.weight_kg?.toString() ?? '',
      body_fat_pct: l.body_fat_pct?.toString() ?? '',
      skeletal_muscle_pct: l.skeletal_muscle_pct?.toString() ?? '',
      visceral_fat_index: l.visceral_fat_index?.toString() ?? '',
      bmr_kcal: l.bmr_kcal?.toString() ?? '',
      body_water_pct: l.body_water_pct?.toString() ?? '',
      lean_body_mass_kg: l.lean_body_mass_kg?.toString() ?? '',
      smi: l.smi?.toString() ?? '',
      health_score: l.health_score?.toString() ?? '',
      protein_pct: l.protein_pct?.toString() ?? '',
      waist_cm: l.waist_cm?.toString() ?? '',
      seg_arm_left: l.seg_arm_left?.toString() ?? '',
      seg_arm_right: l.seg_arm_right?.toString() ?? '',
      seg_trunk: l.seg_trunk?.toString() ?? '',
      seg_leg_left: l.seg_leg_left?.toString() ?? '',
      seg_leg_right: l.seg_leg_right?.toString() ?? '',
      seg_muscle_arm_left: l.seg_muscle_arm_left?.toString() ?? '',
      seg_muscle_arm_right: l.seg_muscle_arm_right?.toString() ?? '',
      seg_muscle_trunk: l.seg_muscle_trunk?.toString() ?? '',
      seg_muscle_leg_left: l.seg_muscle_leg_left?.toString() ?? '',
      seg_muscle_leg_right: l.seg_muscle_leg_right?.toString() ?? '',
      notes: l.notes ?? '',
    })
    setActiveTab('input')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
              { type: 'image', source: { type: 'base64', media_type: aiFile.type as 'image/jpeg' | 'image/png', data: base64 } },
              { type: 'text', text: `Extract body composition data from this BIA report image. Return ONLY a JSON object with these keys (use null if not found):
weight_kg, body_fat_pct, skeletal_muscle_pct, visceral_fat_index, bmr_kcal, body_water_pct, lean_body_mass_kg, smi, health_score, protein_pct, waist_cm,
seg_arm_left, seg_arm_right, seg_trunk, seg_leg_left, seg_leg_right,
seg_muscle_arm_left, seg_muscle_arm_right, seg_muscle_trunk, seg_muscle_leg_left, seg_muscle_leg_right.
seg_arm_*/seg_trunk/seg_leg_* = segmental FAT mass (kg) per body segment.
seg_muscle_* = segmental SKELETAL MUSCLE mass (kg) per body segment.
All values must be numbers or null. No other text.` }
            ]
          }]
        })
      })
      const data = await res.json()
      const text = data.content?.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '').join('') ?? ''
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
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
        seg_arm_left: parsed.seg_arm_left?.toString() ?? prev.seg_arm_left,
        seg_arm_right: parsed.seg_arm_right?.toString() ?? prev.seg_arm_right,
        seg_trunk: parsed.seg_trunk?.toString() ?? prev.seg_trunk,
        seg_leg_left: parsed.seg_leg_left?.toString() ?? prev.seg_leg_left,
        seg_leg_right: parsed.seg_leg_right?.toString() ?? prev.seg_leg_right,
        seg_muscle_arm_left: parsed.seg_muscle_arm_left?.toString() ?? prev.seg_muscle_arm_left,
        seg_muscle_arm_right: parsed.seg_muscle_arm_right?.toString() ?? prev.seg_muscle_arm_right,
        seg_muscle_trunk: parsed.seg_muscle_trunk?.toString() ?? prev.seg_muscle_trunk,
        seg_muscle_leg_left: parsed.seg_muscle_leg_left?.toString() ?? prev.seg_muscle_leg_left,
        seg_muscle_leg_right: parsed.seg_muscle_leg_right?.toString() ?? prev.seg_muscle_leg_right,
      }))
      showToast('Data berhasil diimpor — mohon verifikasi sebelum menyimpan.')
    } catch { showToast('Gagal mengekstrak data dari foto.') }
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

  // ── Derived ──
  const latest = logs[0] ?? null
  const age = calcAge(profile.birth_date)
  const gender = profile.gender ?? 'male'
  const heightCm = profile.height_cm ?? 170

  const bmi = latest?.weight_kg ? calcBMI(latest.weight_kg, heightCm) : null
  const bmiLabel = bmi ? (bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese') : null
  const bmiColor = bmi ? (bmi < 25 ? '#10b981' : bmi < 30 ? '#f59e0b' : '#ef4444') : '#6b7280'
  const fatMass = latest?.weight_kg && latest?.body_fat_pct ? (latest.body_fat_pct / 100) * latest.weight_kg : null
  const leanMass = latest?.lean_body_mass_kg ?? (latest?.weight_kg && fatMass !== null ? latest.weight_kg - fatMass : null)
  const rcs = calcRCS(latest?.body_fat_pct ?? null, latest?.skeletal_muscle_pct ?? null, latest?.visceral_fat_index ?? null, gender)
  const bodyTypeTag = calcBodyTypeTag(latest?.body_fat_pct ?? null, latest?.skeletal_muscle_pct ?? null, gender)
  const trendMsgs = useMemo(() => buildTrendAnalysis(logs), [logs])

  const targetRace = races.length > 0 ? races[0] : null
  const daysToRace = targetRace?.event_date
    ? Math.ceil((new Date(targetRace.event_date).getTime() - new Date().getTime()) / 86400000)
    : null
  const [bfLow, bfHigh] = idealBFRange(age, gender)
  const defaultTargetBF = targetRace ? runnerNormBF(gender)[0] : bfLow
  const targetBF = targetBFInput ? parseFloat(targetBFInput) : defaultTargetBF
  const effectiveLean = leanMass ?? (latest?.weight_kg ? latest.weight_kg * 0.75 : null)
  const raceWeight = effectiveLean && targetBF ? calcRaceWeight(effectiveLean, targetBF) : null
  const ibw = calcIBW(heightCm, gender)
  const weightGap = raceWeight && latest?.weight_kg ? latest.weight_kg - raceWeight : null
  const rwi = raceWeight && latest?.weight_kg ? calcRWI(latest.weight_kg, raceWeight) : null
  const weeksNeeded = weightGap && weightGap > 0 ? weightGap / 0.5 : null

  const armGap = latest ? segGap(latest.seg_arm_left, latest.seg_arm_right) : null
  const legGap = latest ? segGap(latest.seg_leg_left, latest.seg_leg_right) : null
  const muscleArmGap  = latest ? segGap(latest.seg_muscle_arm_left, latest.seg_muscle_arm_right) : null
  const muscleLegGap  = latest ? segGap(latest.seg_muscle_leg_left, latest.seg_muscle_leg_right) : null

  const chartData = useMemo(() => [...logs].reverse().map(l => ({
    date: new Date(l.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    'Lean Mass (kg)': l.lean_body_mass_kg ?? undefined,
    'Fat Mass (kg)': (l.body_fat_pct && l.weight_kg) ? parseFloat(((l.body_fat_pct / 100) * l.weight_kg).toFixed(1)) : undefined,
    'Berat (kg)': l.weight_kg ?? undefined,
  })), [logs])

  // ── Styles ──
  const sectionCls = 'bg-white rounded-xl shadow-sm p-5 mb-5'
  const headerCls  = 'font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4'
  const labelCls   = 'block text-xs font-medium text-gray-500 uppercase mb-1'
  const valueCls   = 'text-sm font-bold text-gray-800'
  const inputCls   = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300'
  const cardCls    = 'bg-gray-50 rounded-lg p-3'

  if (loading) return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      <p className="text-gray-400 text-sm">Memuat data...</p>
    </div>
  )

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg">{toast}</div>
      )}

      <div>
        <h1 className="font-gsans text-2xl text-gray-900">Body Metrics</h1>
        <p className="text-sm text-gray-500 mt-1">Monitoring komposisi tubuh & proyeksi berat ideal</p>
      </div>

      <div className="flex gap-2">
        {[{ key: 'overview', label: 'Overview' }, { key: 'input', label: 'Input Data' }, { key: 'history', label: 'Riwayat' }].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      {activeTab === 'overview' && (
        <>
          {!latest ? (
            <div className={sectionCls}>
              <p className="text-center text-gray-400 py-8">Belum ada data. Mulai input pengukuran pertama.</p>
            </div>
          ) : (
            <>
              {/* Pengukuran Terkini — 2 kolom kiri/kanan */}
              <div className={sectionCls}>
                <h2 className={headerCls}>Pengukuran Terkini</h2>
                <p className="text-xs text-gray-400 mb-4">
                  {new Date(latest.recorded_date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="grid grid-cols-2 gap-6">
                  {/* Kolom kiri: data utama */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-400 uppercase mb-2">Komposisi Utama</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Berat Badan', value: latest.weight_kg ? `${latest.weight_kg} kg` : '—', color: '#4f46e5' },
                        { label: 'BMI', value: bmi ? `${bmi.toFixed(1)} · ${bmiLabel}` : '—', color: bmiColor },
                        { label: 'Body Fat %', value: latest.body_fat_pct ? `${latest.body_fat_pct}%` : '—', color: '#ef4444' },
                        { label: 'Fat Mass', value: fatMass ? `${fatMass.toFixed(1)} kg` : '—', color: '#f59e0b' },
                        { label: 'Lean Mass', value: leanMass ? `${leanMass.toFixed(1)} kg` : '—', color: '#10b981' },
                        { label: 'Skeletal Muscle', value: latest.skeletal_muscle_pct ? `${latest.skeletal_muscle_pct}%` : '—', color: '#8b5cf6' },
                      ].map(c => (
                        <div key={c.label} className={cardCls}>
                          <p className={labelCls}>{c.label}</p>
                          <p className="text-sm font-bold" style={{ color: c.color }}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Kolom kanan: data sekunder */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-400 uppercase mb-2">Data Timbangan</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Visceral Fat Index', value: latest.visceral_fat_index ? `${latest.visceral_fat_index}` : '—', color: '#6b7280' },
                        { label: 'BMR', value: latest.bmr_kcal ? `${latest.bmr_kcal} kcal` : '—', color: '#6b7280' },
                        { label: 'Body Water %', value: latest.body_water_pct ? `${latest.body_water_pct}%` : '—', color: '#0ea5e9' },
                        { label: 'Protein %', value: latest.protein_pct ? `${latest.protein_pct}%` : '—', color: '#6b7280' },
                        { label: 'SMI', value: latest.smi ? `${latest.smi}` : '—', color: '#6b7280' },
                        { label: 'Health Score', value: latest.health_score ? `${latest.health_score}` : '—', color: '#4f46e5' },
                        { label: 'Lingkar Perut', value: latest.waist_cm ? `${latest.waist_cm} cm` : '—', color: '#6b7280' },
                      ].map(c => (
                        <div key={c.label} className={cardCls}>
                          <p className={labelCls}>{c.label}</p>
                          <p className="text-sm font-bold" style={{ color: c.color }}>{c.value}</p>
                        </div>
                      ))}
                      {/* Resting HR — dari EWS / profil, bukan dari body_metrics */}
                      <div className={cardCls}>
                        <p className={labelCls}>Resting HR</p>
                        <p className="text-sm font-bold" style={{ color: effectiveRHR ? '#ef4444' : '#6b7280' }}>
                          {effectiveRHR ? `${effectiveRHR} bpm` : '—'}
                        </p>
                        {rhrSource && (
                          <p className="text-xs text-gray-400 mt-0.5">{rhrSource}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Baris 1: VFI + RCS */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

                {/* VFI Alert */}
                {latest.visceral_fat_index !== null && (
                  <div className={sectionCls + ' !mb-0'}>
                    <h2 className={headerCls}>Visceral Fat Alert</h2>
                    {(() => {
                      const vs = vfiStatus(latest.visceral_fat_index!)
                      return (
                        <div className="flex items-center gap-4 p-3 rounded-lg" style={{ backgroundColor: vs.bg }}>
                          <div>
                            <p className="text-3xl font-bold" style={{ color: vs.color }}>VFI {latest.visceral_fat_index}</p>
                            <p className="text-sm font-bold mt-1" style={{ color: vs.color }}>{vs.label}</p>
                          </div>
                          <div className="border-l pl-4" style={{ borderColor: vs.color + '40' }}>
                            <p className="text-xs text-gray-600">≤9 Aman · 10–14 Risiko Sedang · ≥15 Risiko Tinggi</p>
                            <p className="text-xs text-gray-400 mt-1">Despres et al. 2006; Tanaka et al. 2014</p>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* RCS */}
                {rcs !== null && (
                  <div className={sectionCls + ' !mb-0'}>
                    <h2 className={headerCls}>Runner's Composition Score</h2>
                    <div className="flex items-center gap-4 mb-3">
                      <div className="text-5xl font-bold shrink-0" style={{ color: rcsLabel(rcs).color }}>{rcs}</div>
                      <div>
                        <p className="text-base font-bold" style={{ color: rcsLabel(rcs).color }}>{rcsLabel(rcs).label}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {rcs >= 85 ? 'Komposisi tubuh sangat mendukung performa lari.' : rcs >= 65 ? 'Komposisi tubuh sudah mendukung performa optimal.' : rcs >= 40 ? 'Ada ruang untuk perbaikan komposisi tubuh.' : 'Perlu perbaikan komposisi untuk mendukung performa.'}
                        </p>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
                      <div className="h-full rounded-full" style={{ width: `${rcs}%`, backgroundColor: rcsLabel(rcs).color }} />
                    </div>
                    <p className="text-xs text-gray-400">BF% (40%) · SM% (40%) · VFI (20%) — Lohman 1992; Tanaka & Swensen 1998</p>
                  </div>
                )}
              </div>

              {/* Baris 2: Body Type + Muscle Balance */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

                {/* Body Type */}
                {bodyTypeTag && (
                  <div className={sectionCls + ' !mb-0'}>
                    <h2 className={headerCls}>Body Type</h2>
                    <div className="flex items-center gap-4">
                      <div className="px-4 py-3 bg-indigo-50 rounded-lg">
                        <p className="text-lg font-bold text-indigo-700">{bodyTypeTag}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">Berdasarkan kombinasi Skeletal Muscle % dan Body Fat % relatif terhadap norma gender.</p>
                        <p className="text-xs text-gray-400 mt-1">Gallagher et al. 2000; sistem InBody/Tanita</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Segmental Fat Analysis */}
                <div className={sectionCls + ' !mb-0'}>
                  <h2 className={headerCls}>Segmental Fat Analysis</h2>
                  {latest.seg_arm_left || latest.seg_arm_right || latest.seg_leg_left || latest.seg_leg_right ? (
                    <>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        {[
                          { label: 'Lemak Lengan Kiri', value: latest.seg_arm_left ? `${latest.seg_arm_left} kg` : '—' },
                          { label: 'Lemak Lengan Kanan', value: latest.seg_arm_right ? `${latest.seg_arm_right} kg` : '—' },
                          { label: 'Gap Lemak Lengan', value: armGap ? `${armGap.pct}%` : '—', flag: armGap?.flag },
                          { label: 'Lemak Tungkai Kiri', value: latest.seg_leg_left ? `${latest.seg_leg_left} kg` : '—' },
                          { label: 'Lemak Tungkai Kanan', value: latest.seg_leg_right ? `${latest.seg_leg_right} kg` : '—' },
                          { label: 'Gap Lemak Tungkai', value: legGap ? `${legGap.pct}%` : '—', flag: legGap?.flag },
                        ].map(s => (
                          <div key={s.label} className={cardCls}>
                            <p className={labelCls}>{s.label}</p>
                            <p className={`text-sm font-bold ${s.flag === true ? 'text-red-500' : s.flag === false ? 'text-green-600' : 'text-gray-800'}`}>
                              {s.value}{s.flag === true ? ' ⚠' : s.flag === false ? ' ✓' : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                      {latest.seg_trunk !== null && (
                        <div className={cardCls + ' mb-3'}>
                          <p className={labelCls}>Lemak Trunk</p>
                          <p className={valueCls}>{latest.seg_trunk} kg</p>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">Distribusi lemak per segmen dari BIA. Gap L/R &gt;15% dapat mengindikasikan asimetri distribusi lemak.</p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">Input data segmental fat di tab Input Data.</p>
                  )}
                </div>

                {/* Muscle Balance */}
                <div className={sectionCls + ' !mb-0'}>
                  <h2 className={headerCls}>Muscle Balance</h2>
                  {latest.seg_muscle_leg_left || latest.seg_muscle_leg_right || latest.seg_muscle_arm_left || latest.seg_muscle_arm_right ? (
                    <>
                      {/* Tungkai — paling kritis untuk runner */}
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Tungkai (kritis untuk runner)</p>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        {[
                          { label: 'Otot Tungkai Kiri', value: latest.seg_muscle_leg_left ? `${latest.seg_muscle_leg_left} kg` : '—' },
                          { label: 'Otot Tungkai Kanan', value: latest.seg_muscle_leg_right ? `${latest.seg_muscle_leg_right} kg` : '—' },
                          { label: 'Gap Tungkai', value: muscleLegGap ? `${muscleLegGap.pct}%` : '—', flag: muscleLegGap?.flag },
                        ].map(s => (
                          <div key={s.label} className={cardCls}>
                            <p className={labelCls}>{s.label}</p>
                            <p className={`text-sm font-bold ${s.flag === true ? 'text-red-500' : s.flag === false ? 'text-green-600' : 'text-gray-800'}`}>
                              {s.value}{s.flag === true ? ' ⚠' : s.flag === false ? ' ✓' : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Visual bar asimetri tungkai */}
                      {muscleLegGap && (
                        <div className="mb-3 p-3 rounded-lg bg-gray-50">
                          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                            <span>Kiri {latest.seg_muscle_leg_left} kg</span>
                            <span>Kanan {latest.seg_muscle_leg_right} kg</span>
                          </div>
                          <div className="flex h-3 rounded-full overflow-hidden bg-gray-200">
                            {(() => {
                              const l = latest.seg_muscle_leg_left ?? 0
                              const r = latest.seg_muscle_leg_right ?? 0
                              const total = l + r
                              const leftPct = total ? (l / total) * 100 : 50
                              return <>
                                <div className="h-full transition-all" style={{ width: `${leftPct}%`, background: muscleLegGap.flag ? '#ef4444' : '#6366f1' }} />
                                <div className="h-full flex-1" style={{ background: muscleLegGap.flag ? '#fca5a5' : '#a5b4fc' }} />
                              </>
                            })()}
                          </div>
                          <div className="mt-1.5">
                            {muscleLegGap.flag
                              ? <p className="text-xs text-red-600 font-medium">⚠ Gap {muscleLegGap.pct}% — asimetri tungkai berisiko cedera overuse (Croisier et al. 2008). Konsultasikan dengan fisioterapis.</p>
                              : <p className="text-xs text-green-600 font-medium">✓ Gap {muscleLegGap.pct}% — asimetri tungkai dalam batas normal (&lt;10%).</p>
                            }
                          </div>
                        </div>
                      )}
                      {/* Lengan */}
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-1">Lengan</p>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        {[
                          { label: 'Otot Lengan Kiri', value: latest.seg_muscle_arm_left ? `${latest.seg_muscle_arm_left} kg` : '—' },
                          { label: 'Otot Lengan Kanan', value: latest.seg_muscle_arm_right ? `${latest.seg_muscle_arm_right} kg` : '—' },
                          { label: 'Gap Lengan', value: muscleArmGap ? `${muscleArmGap.pct}%` : '—', flag: muscleArmGap?.flag },
                        ].map(s => (
                          <div key={s.label} className={cardCls}>
                            <p className={labelCls}>{s.label}</p>
                            <p className={`text-sm font-bold ${s.flag === true ? 'text-amber-500' : s.flag === false ? 'text-green-600' : 'text-gray-800'}`}>
                              {s.value}{s.flag === true ? ' ⚠' : s.flag === false ? ' ✓' : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                      {/* Trunk */}
                      {latest.seg_muscle_trunk !== null && (
                        <div className={cardCls + ' mb-3'}>
                          <p className={labelCls}>Otot Trunk</p>
                          <p className={valueCls}>{latest.seg_muscle_trunk} kg</p>
                        </div>
                      )}
                      <p className="text-xs text-gray-400">Threshold: gap tungkai &gt;10% = risiko cedera overuse (Croisier et al. 2008; Niemuth et al. 2005). Data skeletal muscle mass dari BIA segmental.</p>
                    </>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-400">Input data skeletal muscle per segmen di tab Input Data.</p>
                      <p className="text-xs text-gray-400 mt-0.5">Croisier et al. 2008; Niemuth et al. 2005</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Race Weight Estimator */}
              <div className={sectionCls}>
                <h2 className={headerCls}>Race Weight Estimator</h2>
                <p className="text-xs text-gray-400 mb-3">
                  Race Weight = Lean Mass ÷ (1 − Target BF%) · Matt Fitzgerald "Racing Weight" 2009
                </p>
                {targetRace ? (
                  <div className="mb-3 p-3 bg-indigo-50 rounded-lg text-sm flex items-center gap-3 flex-wrap">
                    <span className="font-semibold text-indigo-700">Race A: {targetRace.name}</span>
                    <span className="text-gray-500">{targetRace.event_date ? new Date(targetRace.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
                    {daysToRace !== null && <span className="text-indigo-600 font-medium">{daysToRace} hari lagi</span>}
                  </div>
                ) : (
                  <div className="mb-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                    Tidak ada Race A aktif — target berat ideal umum (Devine Formula). IBW: <strong>{ibw.toFixed(1)} kg</strong>
                  </div>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div>
                    <label className={labelCls}>Target BF %</label>
                    <input type="number" step="0.1" min="5" max="35" placeholder={defaultTargetBF.toString()}
                      value={targetBFInput} onChange={e => setTargetBFInput(e.target.value)}
                      className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  </div>
                  <div className="text-xs text-gray-400 mt-4">
                    Runner: <strong>{runnerNormBF(gender)[0]}–{runnerNormBF(gender)[1]}%</strong>
                    &nbsp;·&nbsp;Umum: <strong>{bfLow}–{bfHigh}%</strong>
                  </div>
                </div>
                {latest?.weight_kg && effectiveLean && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className={cardCls}><p className={labelCls}>Berat Terkini</p><p className={`${valueCls} text-lg`}>{latest.weight_kg} kg</p></div>
                    <div className="bg-indigo-50 rounded-lg p-3"><p className={labelCls}>Race Weight Target</p><p className="text-lg font-bold text-indigo-700">{raceWeight?.toFixed(1) ?? '—'} kg</p></div>
                    <div className={cardCls}>
                      <p className={labelCls}>Gap</p>
                      <p className={`text-lg font-bold ${weightGap && weightGap > 0 ? 'text-red-500' : 'text-green-600'}`}>
                        {weightGap !== null ? (weightGap > 0 ? `−${weightGap.toFixed(1)} kg` : '✓ Tercapai') : '—'}
                      </p>
                    </div>
                    <div className={cardCls}>
                      <p className={labelCls}>Estimasi Waktu Aman</p>
                      <p className={valueCls}>{weeksNeeded ? `${weeksNeeded.toFixed(1)} minggu` : (weightGap !== null && weightGap <= 0 ? 'Tercapai' : '—')}</p>
                      <p className="text-xs text-gray-400">≤0.5 kg/minggu (ACSM)</p>
                    </div>
                  </div>
                )}
                {rwi !== null && rwi > 0 && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg text-xs text-green-800">
                    Running Weight Index: Jika target tercapai, estimasi pace improvement
                    <strong className="text-green-700"> ~{rwi.toFixed(0)} detik/km</strong>
                    <span className="text-green-600 ml-1">(Joyner 1991)</span>
                    {daysToRace !== null && weeksNeeded !== null && weeksNeeded * 7 > daysToRace && (
                      <span className="block text-amber-600 mt-1">⚠ Waktu yang dibutuhkan ({weeksNeeded.toFixed(1)} minggu) melebihi sisa hari menuju race.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Trend Komposisi */}
              {chartData.filter(d => d['Lean Mass (kg)'] || d['Fat Mass (kg)']).length > 1 && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Trend Komposisi Tubuh</h2>
                  <ResponsiveContainer width="100%" height={220}>
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

              {/* Trend Analisis */}
              {trendMsgs.length > 0 && (
                <div className={sectionCls}>
                  <h2 className={headerCls}>Analisis Trend (4 Minggu)</h2>
                  <ul className="space-y-2">
                    {trendMsgs.map((msg, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-indigo-400 mt-0.5">→</span><span>{msg}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ══ INPUT DATA ══ */}
      {activeTab === 'input' && (
        <div className={sectionCls}>
          <h2 className={headerCls}>Input Pengukuran Baru</h2>

          {/* AI Import */}
          <div className="mb-5 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
            <p className="text-xs font-medium text-indigo-700 mb-1 uppercase tracking-wide">Import dari Foto Laporan (AI)</p>
            <p className="text-xs text-gray-500 mb-3">Upload foto laporan timbangan bioimpedansi — data diekstrak otomatis. Verifikasi sebelum menyimpan.</p>
            <div className="flex items-center gap-3">
              <input type="file" accept="image/*" onChange={e => setAiFile(e.target.files?.[0] ?? null)}
                className="text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer" />
              <button onClick={handleAIImport} disabled={!aiFile || aiLoading}
                className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {aiLoading ? 'Mengekstrak...' : 'Ekstrak Data'}
              </button>
            </div>
          </div>

          {/* Form — Data Komposisi (resting_hr dihapus dari form) */}
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Data Komposisi Tubuh</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            {[
              { key: 'recorded_date', label: 'Tanggal *', type: 'date', ph: '' },
              { key: 'weight_kg', label: 'Berat (kg) *', type: 'number', ph: '69.5' },
              { key: 'body_fat_pct', label: 'Body Fat %', type: 'number', ph: '24.7' },
              { key: 'skeletal_muscle_pct', label: 'Skeletal Muscle %', type: 'number', ph: '42.2' },
              { key: 'visceral_fat_index', label: 'Visceral Fat Index', type: 'number', ph: '6' },
              { key: 'lean_body_mass_kg', label: 'Lean Body Mass (kg)', type: 'number', ph: '52.6' },
              { key: 'bmr_kcal', label: 'BMR (kcal)', type: 'number', ph: '1507' },
              { key: 'body_water_pct', label: 'Body Water %', type: 'number', ph: '55.3' },
              { key: 'protein_pct', label: 'Protein %', type: 'number', ph: '14.9' },
              { key: 'smi', label: 'SMI', type: 'number', ph: '8.2' },
              { key: 'health_score', label: 'Health Score', type: 'number', ph: '79' },
              { key: 'waist_cm', label: 'Lingkar Perut (cm)', type: 'number', ph: '82' },
            ].map(f => (
              <div key={f.key}>
                <label className={labelCls}>{f.label}</label>
                <input type={f.type} step="0.1" placeholder={f.ph}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>

          {/* Info: Resting HR otomatis dari EWS */}
          <div className="mb-5 p-3 bg-blue-50 rounded-lg border border-blue-100 text-xs text-blue-700">
            <span className="font-medium">Resting HR</span> diambil otomatis dari data EWS (rata-rata 7 hari terakhir).
            {effectiveRHR
              ? <span className="ml-1">Nilai saat ini: <strong>{effectiveRHR} bpm</strong> ({rhrSource})</span>
              : <span className="ml-1 text-blue-500">Belum ada data EWS — input RHR pagi di halaman EWS Tracker.</span>
            }
          </div>

          {/* Form — Segmental Fat Analysis */}
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Segmental Fat Analysis (dari timbangan)</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            {[
              { key: 'seg_arm_left', label: 'Lemak Lengan Kiri (kg)', ph: '1.0' },
              { key: 'seg_arm_right', label: 'Lemak Lengan Kanan (kg)', ph: '1.0' },
              { key: 'seg_trunk', label: 'Lemak Trunk (kg)', ph: '9.1' },
              { key: 'seg_leg_left', label: 'Lemak Tungkai Kiri (kg)', ph: '2.6' },
              { key: 'seg_leg_right', label: 'Lemak Tungkai Kanan (kg)', ph: '2.6' },
            ].map(f => (
              <div key={f.key}>
                <label className={labelCls}>{f.label}</label>
                <input type="number" step="0.1" placeholder={f.ph}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>

          {/* Form — Segmental Skeletal Muscle (Muscle Balance) */}
          <p className="text-xs font-medium text-gray-500 uppercase mb-3">Skeletal Muscle per Segmen — Muscle Balance (dari timbangan)</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
            {[
              { key: 'seg_muscle_arm_left', label: 'Otot Lengan Kiri (kg)', ph: '2.8' },
              { key: 'seg_muscle_arm_right', label: 'Otot Lengan Kanan (kg)', ph: '2.9' },
              { key: 'seg_muscle_trunk', label: 'Otot Trunk (kg)', ph: '24.5' },
              { key: 'seg_muscle_leg_left', label: 'Otot Tungkai Kiri (kg)', ph: '9.1' },
              { key: 'seg_muscle_leg_right', label: 'Otot Tungkai Kanan (kg)', ph: '9.3' },
            ].map(f => (
              <div key={f.key}>
                <label className={labelCls}>{f.label}</label>
                <input type="number" step="0.1" placeholder={f.ph}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className={inputCls} />
              </div>
            ))}
          </div>

          {/* Catatan */}
          <div className="mb-5">
            <label className={labelCls}>Catatan</label>
            <input type="text" placeholder="Catatan opsional..." value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className={inputCls} />
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
                      <div className={cardCls}><p className={labelCls}>BMI</p><p className={valueCls}>{bmiVal.toFixed(1)}</p></div>
                      {fatMassVal !== null && <div className={cardCls}><p className={labelCls}>Fat Mass</p><p className={valueCls}>{fatMassVal.toFixed(1)} kg</p></div>}
                      {leanVal !== null && <div className={cardCls}><p className={labelCls}>Lean Mass</p><p className={valueCls}>{leanVal.toFixed(1)} kg</p></div>}
                      {rcsVal !== null && <div className={cardCls}><p className={labelCls}>RCS</p><p className="text-sm font-bold" style={{ color: rcsLabel(rcsVal).color }}>{rcsVal} — {rcsLabel(rcsVal).label}</p></div>}
                      {tagVal && <div className={`${cardCls} col-span-2`}><p className={labelCls}>Body Type</p><p className={valueCls}>{tagVal}</p></div>}
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
          {!canEdit && <p className="text-xs text-gray-400 mt-2">Hanya coach atau admin yang dapat menyimpan data.</p>}
        </div>
      )}

      {/* ══ RIWAYAT ══ */}
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
                    {['Tanggal','Berat','BF%','Fat Mass','Lean Mass','BMI','SM%','VFI','BMR','Waist','Score','Fat Arm L/R','Fat Leg L/R','Otot Arm L/R','Otot Leg L/R',''].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 uppercase pb-2 pr-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => {
                    const bmiV = l.weight_kg ? calcBMI(l.weight_kg, heightCm) : null
                    const fatMV = l.body_fat_pct && l.weight_kg ? (l.body_fat_pct / 100) * l.weight_kg : null
                    const leanV = l.lean_body_mass_kg ?? (l.weight_kg && fatMV !== null ? l.weight_kg - fatMV : null)
                    const aGap  = segGap(l.seg_arm_left, l.seg_arm_right)
                    const lGap  = segGap(l.seg_leg_left, l.seg_leg_right)
                    const maGap = segGap(l.seg_muscle_arm_left, l.seg_muscle_arm_right)
                    const mlGap = segGap(l.seg_muscle_leg_left, l.seg_muscle_leg_right)
                    return (
                      <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-600 text-xs">
                          {new Date(l.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="py-2 pr-3 font-bold text-indigo-700">{l.weight_kg ?? '—'}</td>
                        <td className="py-2 pr-3">{l.body_fat_pct ? `${l.body_fat_pct}%` : '—'}</td>
                        <td className="py-2 pr-3">{fatMV ? `${fatMV.toFixed(1)}` : '—'}</td>
                        <td className="py-2 pr-3 text-green-600 font-medium">{leanV ? `${leanV.toFixed(1)}` : '—'}</td>
                        <td className="py-2 pr-3" style={{ color: bmiV ? (bmiV < 25 ? '#10b981' : bmiV < 30 ? '#f59e0b' : '#ef4444') : '#6b7280' }}>
                          {bmiV ? bmiV.toFixed(1) : '—'}
                        </td>
                        <td className="py-2 pr-3">{l.skeletal_muscle_pct ? `${l.skeletal_muscle_pct}%` : '—'}</td>
                        <td className="py-2 pr-3">{l.visceral_fat_index ?? '—'}</td>
                        <td className="py-2 pr-3">{l.bmr_kcal ?? '—'}</td>
                        <td className="py-2 pr-3">{l.waist_cm ? `${l.waist_cm}` : '—'}</td>
                        <td className="py-2 pr-3">{l.health_score ?? '—'}</td>
                        <td className="py-2 pr-3 text-xs">
                          {l.seg_arm_left || l.seg_arm_right
                            ? <span className={aGap?.flag ? 'text-red-500 font-medium' : 'text-gray-600'}>{l.seg_arm_left ?? '—'} / {l.seg_arm_right ?? '—'}{aGap ? ` (${aGap.pct}%)` : ''}</span>
                            : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {l.seg_leg_left || l.seg_leg_right
                            ? <span className={lGap?.flag ? 'text-red-500 font-medium' : 'text-gray-600'}>{l.seg_leg_left ?? '—'} / {l.seg_leg_right ?? '—'}{lGap ? ` (${lGap.pct}%)` : ''}</span>
                            : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {l.seg_muscle_arm_left || l.seg_muscle_arm_right
                            ? <span className={maGap?.flag ? 'text-amber-500 font-medium' : 'text-gray-600'}>{l.seg_muscle_arm_left ?? '—'} / {l.seg_muscle_arm_right ?? '—'}{maGap ? ` (${maGap.pct}%)` : ''}</span>
                            : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {l.seg_muscle_leg_left || l.seg_muscle_leg_right
                            ? <span className={mlGap?.flag ? 'text-red-500 font-medium' : 'text-gray-600'}>{l.seg_muscle_leg_left ?? '—'} / {l.seg_muscle_leg_right ?? '—'}{mlGap ? ` (${mlGap.pct}%)` : ''}</span>
                            : '—'}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-1">
                            <button onClick={() => handleEdit(l)}
                              className="border border-indigo-500 text-indigo-600 text-xs px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors">
                              Edit
                            </button>
                            <button onClick={() => handleDelete(l.id)}
                              className="border border-red-200 text-red-500 text-xs px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                              Hapus
                            </button>
                          </div>
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
