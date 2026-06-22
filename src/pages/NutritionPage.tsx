import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface NutritionSection {
  key: string
  defaultTitle: string
  icon: string
  color: string
  bgColor: string
  borderColor: string
  defaultContent: string
}

interface NutritionRow {
  id: string
  section_key: string
  title: string | null
  content: string | null
  updated_at: string
}

interface BodyMetricLatest {
  weight_kg: number | null
  bmr_kcal: number | null
}

interface AthleteProfile {
  height_cm: number | null
  birth_date: string | null
  gender: string | null
  weight_kg: number | null
}

interface RaceActive {
  name: string
  event_date: string | null
  distance_km: number | null
  target_finish: string | null
}

// ─── Algorithms ──────────────────────────────────────────────────────────────

function calcAge(birthDate: string | null): number {
  if (!birthDate) return 30
  const today = new Date(), birth = new Date(birthDate)
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/**
 * Mifflin-St Jeor BMR (1990) — lebih akurat dari Harris-Benedict
 * Male:   BMR = 10×W + 6.25×H − 5×A + 5
 * Female: BMR = 10×W + 6.25×H − 5×A − 161
 */
function calcBMR(weightKg: number, heightCm: number, age: number, gender: string): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return Math.round(gender === 'female' ? base - 161 : base + 5)
}

/**
 * TDEE = BMR × Activity Factor
 * Ainsworth et al. (2011) Compendium of Physical Activities
 */
const ACTIVITY_FACTORS: Record<string, { label: string; factor: number; desc: string }> = {
  sedentary:  { label: 'Ringan',       factor: 1.2,  desc: 'Kerja duduk, tidak ada olahraga' },
  light:      { label: 'Sedang',       factor: 1.375, desc: 'Latihan ringan 1–3 hari/minggu' },
  moderate:   { label: 'Aktif',        factor: 1.55,  desc: 'Latihan 3–5 hari/minggu' },
  active:     { label: 'Sangat Aktif', factor: 1.725, desc: 'Latihan intensif 6–7 hari/minggu' },
  veryactive: { label: 'Atlet',        factor: 1.9,   desc: 'Latihan 2× sehari / pekerjaan fisik berat' },
}

/**
 * MET Values untuk lari — Ainsworth et al. (2011)
 */
const SESSION_MET: Record<string, { label: string; met: number }> = {
  easy:    { label: 'Easy Run / Recovery', met: 8.0  },
  lr:      { label: 'Long Run',            met: 9.0  },
  tempo:   { label: 'Tempo / Threshold',   met: 11.0 },
  interval:{ label: 'Interval / VO₂Max',  met: 13.5 },
  race:    { label: 'Race Pace',           met: 14.5 },
}

/**
 * Kalori terbakar = MET × berat (kg) × durasi (jam)
 */
function calcCaloriesBurned(met: number, weightKg: number, durationMin: number): number {
  return Math.round(met * weightKg * (durationMin / 60))
}

/**
 * Distribusi makronutrien untuk runner endurance
 * Burke et al. (2011); Phillips & Van Loon (2011)
 */
function calcMacros(weightKg: number, tdee: number, goal: string, isTrainingDay: boolean) {
  // Protein g/kg
  const proteinPerKg = isTrainingDay ? (goal === 'muscle' ? 2.0 : 1.8) : 1.4
  const proteinG = Math.round(proteinPerKg * weightKg)
  const proteinKcal = proteinG * 4

  // Karbohidrat g/kg
  const carbPerKg = isTrainingDay ? 6.5 : 4.0
  const carbG = Math.round(carbPerKg * weightKg)
  const carbKcal = carbG * 4

  // Kalori target berdasarkan goal
  const targetKcal = goal === 'loss' ? Math.round(tdee - 400)
    : goal === 'muscle' ? Math.round(tdee + 250)
    : tdee

  // Lemak = sisa kalori, minimum 20% TDEE
  const fatKcal = Math.max(Math.round(tdee * 0.20), targetKcal - proteinKcal - carbKcal)
  const fatG = Math.round(fatKcal / 9)

  // Serat — Institute of Medicine: 25–38 g/hari
  const fiberG = weightKg > 70 ? 38 : 25

  return { proteinG, proteinPerKg, carbG, carbPerKg, fatG, fatKcal, targetKcal, fiberG, proteinKcal, carbKcal }
}

// ─── Default content sections ─────────────────────────────────────────────────
const SECTIONS: NutritionSection[] = [
  {
    key: 'daily',
    defaultTitle: 'Daily Nutrition (Non-LR Days)',
    icon: '🍽️',
    color: '#4f46e5',
    bgColor: '#eef2ff',
    borderColor: '#c7d2fe',
    defaultContent: `## 🍽️ Daily Nutrition (Non-LR Days)

**Karbohidrat** — 4–5 g/kg = 275–345 g/hari
Sumber: Nasi, kentang, oats, ubi, roti gandum, buah

**Protein** — 1.6–1.8 g/kg = 110–125 g/hari
Sumber: Ikan, ayam, telur, tahu/tempe, susu

**Lemak** — 0.8–1.0 g/kg = 55–70 g/hari
Sumber: Alpukat, kacang, minyak zaitun, ikan berlemak

**Hidrasi** — 35–40 ml/kg = 2.5–3 L/hari
Sumber: Air, kuah sayur, buah`
  },
  {
    key: 'daily_lr',
    defaultTitle: 'Daily Nutrition (LR Days)',
    icon: '🏃',
    color: '#7c3aed',
    bgColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    defaultContent: `## 🏃 Daily Nutrition (LR Days)

**Karbohidrat** — 6–7 g/kg = 415–485 g/hari
Tingkatkan porsi karbohidrat pada makan siang dan malam H-1 LR.

**Protein** — 1.6–1.8 g/kg = 110–125 g/hari
Sama dengan non-LR. Fokus pada recovery post-LR.

**Lemak** — 0.8–1.0 g/kg = 55–70 g/hari
Kurangi lemak H-1 LR untuk mempercepat pengosongan lambung.

**Hidrasi** — 40–45 ml/kg = 2.8–3.2 L/hari
Tambahkan 1 sachet elektrolit sore H-1 LR.

> 💡 Mulai tingkatkan karbohidrat sejak makan malam H-1 LR, bukan H-2 jam sebelum lari.`
  },
  {
    key: 'pre',
    defaultTitle: 'Pre-Workout Fueling',
    icon: '⚡',
    color: '#d97706',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    defaultContent: `## ⚡ Pre-Workout Fueling

**Easy run pagi**
H-2 jam: Pisang + roti tawar (ringan)
H-30 menit: Air 200 ml

**Easy run sore**
H-2 jam: Snack 100–150 kcal (kurma 3 buah)
H-30 menit: Air 200 ml + sip elektrolit

**LR / Quality Session**
H-2 jam: Sarapan 300–400 kcal (oats + pisang + selai kacang + susu)
H-30 menit: Pisang + air 300 ml`
  },
  {
    key: 'during',
    defaultTitle: 'During Workout Fueling',
    icon: '💧',
    color: '#0284c7',
    bgColor: '#f0f9ff',
    borderColor: '#bae6fd',
    defaultContent: `## 💧 During Workout Fueling

**< 60 menit**
Carb: Tidak perlu
Hidrasi: 250–400 ml air saja

**60–90 menit**
Carb: Optional 15–20g carb (sip elektrolit ber-karbo)
Hidrasi: 400–600 ml elektrolit

**90–120 menit**
Carb: 30g carb/jam (1 gel atau pisang kecil)
Hidrasi: 600–800 ml elektrolit

**> 120 menit (LR W10+)**
Carb: 40–60g carb/jam
Hidrasi: 800–1000 ml elektrolit`
  },
  {
    key: 'post',
    defaultTitle: 'Post-Workout Recovery',
    icon: '💪',
    color: '#059669',
    bgColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    defaultContent: `## 💪 Post-Workout Recovery (within 30 min)

**Formula 1:1:3** (per 0.3 kg BB):
- ~20g protein
- 150–300 mg sodium replenish
- ~60–80g carb (jika sesi >90 menit)

**Pilihan Praktis:**
- Chocolate milk 300 ml + 1 pisang ✅
- Smoothie: susu + pisang + 1 scoop whey + madu ✅
- Nasi 1 centong + 2 telur + sayur + 1 gelas air kelapa ✅`
  },
  {
    key: 'raceweek',
    defaultTitle: 'Race Week Fueling Protocol',
    icon: '🏁',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fecaca',
    defaultContent: `## 🏁 Race Week Fueling Protocol

**H-7 sampai H-3**
Karbohidrat normal (4–5 g/kg). Hidrasi tinggi.
⚠️ HINDARI: makanan baru, alkohol, makanan pedas/berlemak.

**H-2 (Carb Loading Light)**
Karbohidrat 6–7 g/kg = 415–485g.
Sumber: nasi, pasta, kentang. Protein moderat, lemak rendah, serat MODERAT.

**H-1 (Race Eve)**
Lunch: pasta/nasi besar + protein lean.
Dinner (sebelum jam 19:00): nasi + ayam/ikan + sayur (no kacang-kacangan, no spicy).
Hidrasi 3 L total — terakhir minum besar 2 jam sebelum tidur.

**Race Day Morning (H-3 jam)**
Sarapan 400–500 kcal: oats + pisang + madu + sedikit kopi (jika biasa).
500 ml air + sachet elektrolit.
H-30 menit: 1 pisang + 200 ml air.

**During Race (HM 21.1 km)**
- Km 5: 100 ml elektrolit di water station
- Km 8: 1 gel (~25g carb) + 100 ml air
- Km 12: 100 ml elektrolit
- Km 16: 1 gel + 100 ml air
- Km 19: 100 ml air (jika butuh)

> 🚨 GOLDEN RULE: Jangan coba gel/produk baru di race day. Test semua fueling products mulai W7+ saat LR meningkat durasinya.`
  }
]

// ─── Markdown renderer ────────────────────────────────────────────────────────
function parseMarkdown(text: string): string {
  if (!text) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => `\x00CODEBLOCK\x00${esc(code).trim()}\x00ENDCODE\x00`)
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code style="background:#f3f4f6;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:0.78rem;color:#4f46e5">${esc(code)}</code>`)
  const lines = text.split('\n')
  let html = '', inList = false, inOL = false, inTable = false, tableRows: string[] = []
  function flushList() { if (inList) { html += '</ul>'; inList = false } if (inOL) { html += '</ol>'; inOL = false } }
  function flushTable() {
    if (!tableRows.length) return
    const parseRow = (row: string) => row.split('|').slice(1, -1).map(c => c.trim())
    const header = parseRow(tableRows[0]); const body = tableRows.slice(2)
    html += `<div style="overflow-x:auto;margin:8px 0 12px"><table style="width:100%;border-collapse:collapse;font-size:0.8rem"><thead><tr>${header.map(h => `<th style="background:#eef2ff;color:#4338ca;font-weight:700;padding:6px 10px;text-align:left;border:1px solid #e5e7eb;white-space:nowrap">${h}</th>`).join('')}</tr></thead><tbody>${body.map((row, ri) => { const cells = parseRow(row); const bg = ri % 2 === 0 ? 'white' : '#f9fafb'; return `<tr style="background:${bg}">${cells.map(c => `<td style="padding:5px 10px;border:1px solid #e5e7eb;line-height:1.5">${c}</td>`).join('')}</tr>` }).join('')}</tbody></table></div>`
    tableRows = []; inTable = false
  }
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (/^\s*\|/.test(line)) { flushList(); inTable = true; tableRows.push(line); continue }
    if (inTable) flushTable()
    line = esc(line)
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    if (/^#\s+/.test(line) && !/^##/.test(line)) { flushList(); html += `<div style="font-size:1.1rem;font-weight:700;color:#1e1b4b;margin:14px 0 4px;border-bottom:2px solid #e0e7ff;padding-bottom:4px">${line.replace(/^#\s+/, '')}</div>`; continue }
    if (/^##\s+/.test(line) && !/^###/.test(line)) { flushList(); html += `<div style="font-size:0.9rem;font-weight:700;color:#1f2937;margin:10px 0 3px">${line.replace(/^##\s+/, '')}</div>`; continue }
    if (/^###\s+/.test(line)) { flushList(); html += `<div style="font-size:0.72rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px">${line.replace(/^###\s+/, '')}</div>`; continue }
    if (/^&gt;\s+/.test(line)) { flushList(); html += `<div style="background:#eff6ff;border-left:3px solid #4f46e5;border-radius:0 6px 6px 0;padding:8px 12px;margin:8px 0;font-size:0.8rem;color:#1e40af;line-height:1.6">${line.replace(/^&gt;\s+/, '')}</div>`; continue }
    if (/^-\s+/.test(line)) { if (inOL) { html += '</ol>'; inOL = false } if (!inList) { html += '<ul style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:disc">'; inList = true } html += `<li style="margin-bottom:2px">${line.replace(/^-\s+/, '')}</li>`; continue }
    if (/^\d+\.\s+/.test(line)) { if (inList) { html += '</ul>'; inList = false } if (!inOL) { html += '<ol style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:decimal">'; inOL = true } html += `<li style="margin-bottom:2px">${line.replace(/^\d+\.\s+/, '')}</li>`; continue }
    flushList()
    if (line.trim() === '') { const nextLine = lines[i + 1]?.trim() ?? 'x'; if (nextLine === '') { html += '<div style="margin-bottom:20px"></div>'; i++ } else { html += '<div style="margin-bottom:5px"></div>' }; continue }
    if (line.includes('\x00CODEBLOCK\x00')) { const parts = line.split('\x00CODEBLOCK\x00'); parts.forEach((part, pi) => { if (pi % 2 === 0) { if (part) html += `<div style="font-size:0.83rem;color:#374151;line-height:1.6">${part}</div>` } else { const code = part.replace('\x00ENDCODE\x00', ''); html += `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin:8px 0 12px;overflow-x:auto;font-family:monospace;font-size:0.78rem;color:#1f2937;line-height:1.7;white-space:pre-wrap">${code}</pre>` } }); continue }
    html += `<div style="font-size:0.83rem;color:#374151;line-height:1.6;margin-bottom:1px">${line}</div>`
  }
  flushList(); if (inTable) flushTable()
  return html
}

// ─── Tab config ───────────────────────────────────────────────────────────────
const TABS = [
  { key: 'calorie',    label: '🔢 Kalori & Makro' },
  { key: 'nutrition',  label: '🍽️ Nutrition' },
  { key: 'fueling',    label: '💧 Fueling' },
]

const TAB_SECTIONS: Record<string, string[]> = {
  nutrition: ['daily', 'daily_lr'],
  fueling:   ['pre', 'during', 'post', 'raceweek'],
}

const FORMAT_GUIDE = [
  { syntax: '# Judul',   result: 'Heading besar' },
  { syntax: '## Judul',  result: 'Heading sedang' },
  { syntax: '### Judul', result: 'Heading kecil' },
  { syntax: '**teks**',  result: 'Teks tebal' },
  { syntax: '*teks*',    result: 'Teks miring' },
  { syntax: '- item',    result: 'Bullet list' },
  { syntax: '1. item',   result: 'Numbered list' },
  { syntax: '> catatan', result: 'Callout biru' },
  { syntax: '`kode`',    result: 'Inline code' },
  { syntax: '| A | B |', result: 'Tabel' },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function NutritionPage() {
  const [rows, setRows]         = useState<NutritionRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [editKey, setEditKey]   = useState<string | null>(null)
  const [editTitle, setEditTitle]   = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving]     = useState(false)
  const [activeTab, setActiveTab] = useState<'calorie' | 'nutrition' | 'fueling'>('calorie')
  const [toast, setToast]       = useState('')
  const [myRoles, setMyRoles]   = useState<string[]>([])
  const cancelledRef            = useRef(false)

  // Kalori tab state
  const [bodyLatest, setBodyLatest]   = useState<BodyMetricLatest>({ weight_kg: null, bmr_kcal: null })
  const [profile, setProfile]         = useState<AthleteProfile>({ height_cm: null, birth_date: null, gender: null, weight_kg: null })
  const [raceActive, setRaceActive]   = useState<RaceActive | null>(null)
  const [activityKey, setActivityKey] = useState('moderate')
  const [goal, setGoal]               = useState<'loss' | 'maintenance' | 'muscle'>('maintenance')
  // Seksi 3 — input manual (TODO: ganti fetch dari training_sessions saat DailyLogPage selesai)
  const [sessionType, setSessionType] = useState('easy')
  const [sessionDur, setSessionDur]   = useState('60')

  const canEdit = myRoles.includes('coach') || myRoles.includes('admin')

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    cancelledRef.current = false
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return

      // Roles
      const { data: arData } = await supabase.from('athlete_roles').select('role_id').eq('athlete_id', myId as string)
      if (!cancelledRef.current && arData && (arData as {role_id: number}[]).length > 0) {
        const roleIds = (arData as {role_id: number}[]).map(r => r.role_id)
        const { data: rData } = await supabase.from('roles').select('name').in('id', roleIds)
        if (!cancelledRef.current && rData)
          setMyRoles((rData as {name: string}[]).map(r => r.name).filter(Boolean))
      }

      // Nutrition sections
      const { data: nutData } = await supabase.from('nutrition')
        .select('id, section_key, title, content, updated_at').eq('athlete_id', myId as string)
      if (!cancelledRef.current) setRows((nutData ?? []) as NutritionRow[])

      // Body metrics latest
      const { data: bm } = await supabase.from('body_metrics')
        .select('weight_kg, bmr_kcal').eq('athlete_id', myId as string)
        .order('recorded_date', { ascending: false }).limit(1).single()
      if (!cancelledRef.current && bm) setBodyLatest({ weight_kg: bm.weight_kg, bmr_kcal: bm.bmr_kcal })

      // Athlete settings
      const { data: as_ } = await supabase.from('athlete_settings')
        .select('height_cm, birth_date, weight_kg, gender').eq('athlete_id', myId as string).single()
      if (!cancelledRef.current && as_) setProfile({
        height_cm: as_.height_cm,
        birth_date: as_.birth_date,
        weight_kg: as_.weight_kg,
        gender: (as_ as unknown as { gender: string | null }).gender,
      })

      // Race A aktif terdekat
      const { data: races } = await supabase.from('races')
        .select('name, event_date, distance_km, target_finish')
        .eq('athlete_id', myId as string).eq('status', 'A')
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date', { ascending: true }).limit(1)
      if (!cancelledRef.current && races && races.length > 0) setRaceActive(races[0] as RaceActive)

    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => { cancelledRef.current = true }
  }, [loadData])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getRow(key: string): NutritionRow | null { return rows.find(r => r.section_key === key) ?? null }
  function getContent(key: string): string { return getRow(key)?.content ?? SECTIONS.find(s => s.key === key)?.defaultContent ?? '' }
  function getTitle(key: string): string { return getRow(key)?.title ?? SECTIONS.find(s => s.key === key)?.defaultTitle ?? '' }
  function isCustom(key: string): boolean { return getRow(key) != null }
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function startEdit(key: string) { setEditKey(key); setEditTitle(getTitle(key)); setEditContent(getContent(key)) }
  function cancelEdit() { setEditKey(null) }

  async function saveSection() {
    if (!editKey) return
    setSaving(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId) throw new Error('Athlete ID tidak ditemukan')
      const sec = SECTIONS.find(s => s.key === editKey)!
      const titleToSave = editTitle.trim() || sec.defaultTitle
      const existing = getRow(editKey)
      if (existing) {
        await supabase.from('nutrition').update({ title: titleToSave, content: editContent, updated_at: new Date().toISOString() }).eq('id', existing.id)
      } else {
        await supabase.from('nutrition').insert({ athlete_id: myId as string, section_key: editKey, title: titleToSave, content: editContent })
      }
      await loadData(); setEditKey(null); showToast('✓ Konten berhasil disimpan')
    } catch { showToast('✗ Gagal menyimpan') }
    finally { setSaving(false) }
  }

  async function resetSection(key: string) {
    if (!confirm('Reset ke konten default?')) return
    const existing = getRow(key)
    if (!existing) return
    try { await supabase.from('nutrition').delete().eq('id', existing.id); await loadData(); if (editKey === key) setEditKey(null); showToast('✓ Konten direset') }
    catch { showToast('✗ Gagal mereset') }
  }

  // ── Kalori calculations ───────────────────────────────────────────────────
  const weight = bodyLatest.weight_kg ?? profile.weight_kg ?? 70
  const height = profile.height_cm ?? 170
  const age    = calcAge(profile.birth_date)
  const gender = (profile.gender as string | null) ?? 'male'

  const bmrValue = bodyLatest.bmr_kcal ?? calcBMR(weight, height, age, gender)
  const bmrSource = bodyLatest.bmr_kcal ? 'dari timbangan' : 'estimasi Mifflin-St Jeor'

  const actFactor = ACTIVITY_FACTORS[activityKey]
  const tdee = Math.round(bmrValue * actFactor.factor)

  const macrosTraining = calcMacros(weight, tdee, goal, true)
  const macrosRest     = calcMacros(weight, tdee, goal, false)

  // Seksi 3 — kalori latihan
  const sessMet    = SESSION_MET[sessionType]
  const sessKcal   = calcCaloriesBurned(sessMet.met, weight, parseInt(sessionDur) || 60)
  const netKcal    = macrosTraining.targetKcal - sessKcal
  const needsRefuel = sessKcal > 500

  // Seksi 4 — Race day
  let raceDurationMin: number | null = null
  let raceKcal: number | null = null
  let raceH1Kcal: number | null = null
  if (raceActive?.target_finish) {
    const parts = raceActive.target_finish.split(':').map(Number)
    const raceSec = parts.length === 3 ? parts[0]*3600 + parts[1]*60 + parts[2] : parts[0]*60 + parts[1]
    raceDurationMin = Math.round(raceSec / 60)
    raceKcal = calcCaloriesBurned(SESSION_MET.race.met, weight, raceDurationMin)
    raceH1Kcal = Math.round(tdee * 1.1 + raceKcal * 0.1)
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const sectionCls = 'bg-white rounded-xl shadow-sm p-5'
  const headerCls  = 'font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4'
  const labelCls   = 'block text-xs font-medium text-gray-500 uppercase mb-1'
  const valueCls   = 'text-sm font-bold text-gray-800'
  const cardCls    = 'bg-gray-50 rounded-lg p-3'
  const selectCls  = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white'

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat data nutrisi...</div>
  )

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}

      {/* Tab selector */}
      <div className="flex items-center gap-1 bg-white rounded-xl shadow-sm p-1.5 w-fit">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === tab.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ TAB: KALORI & MAKRO ══ */}
      {activeTab === 'calorie' && (
        <div className="space-y-5">

          {/* Seksi 1 — TDEE */}
          <div className={sectionCls}>
            <h2 className={headerCls}>Kebutuhan Kalori Harian (TDEE)</h2>
            <p className="text-xs text-gray-400 mb-4">
              BMR via Mifflin-St Jeor (1990) jika data timbangan tidak tersedia · TDEE = BMR × Activity Factor
            </p>

            {/* Controls */}
            <div className="flex flex-wrap gap-4 mb-5">
              <div>
                <label className={labelCls}>Level Aktivitas</label>
                <select value={activityKey} onChange={e => setActivityKey(e.target.value)} className={selectCls}>
                  {Object.entries(ACTIVITY_FACTORS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label} — {v.desc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Goal</label>
                <select value={goal} onChange={e => setGoal(e.target.value as typeof goal)} className={selectCls}>
                  <option value="loss">Fat Loss (−400 kcal)</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="muscle">Muscle Gain (+250 kcal)</option>
                </select>
              </div>
            </div>

            {/* Output cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className={cardCls}>
                <p className={labelCls}>BMR</p>
                <p className="text-lg font-bold text-indigo-700">{bmrValue.toLocaleString()} kcal</p>
                <p className="text-xs text-gray-400 mt-0.5">{bmrSource}</p>
              </div>
              <div className={cardCls}>
                <p className={labelCls}>Activity Factor</p>
                <p className="text-lg font-bold text-gray-800">×{actFactor.factor}</p>
                <p className="text-xs text-gray-400 mt-0.5">{actFactor.label}</p>
              </div>
              <div className="bg-indigo-50 rounded-lg p-3">
                <p className={labelCls}>TDEE</p>
                <p className="text-lg font-bold text-indigo-700">{tdee.toLocaleString()} kcal</p>
                <p className="text-xs text-gray-400 mt-0.5">Total kebutuhan harian</p>
              </div>
              <div className={`rounded-lg p-3 ${goal === 'loss' ? 'bg-red-50' : goal === 'muscle' ? 'bg-green-50' : 'bg-gray-50'}`}>
                <p className={labelCls}>Target Kalori</p>
                <p className={`text-lg font-bold ${goal === 'loss' ? 'text-red-600' : goal === 'muscle' ? 'text-green-600' : 'text-gray-800'}`}>
                  {macrosTraining.targetKcal.toLocaleString()} kcal
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {goal === 'loss' ? 'Defisit 400 kcal' : goal === 'muscle' ? 'Surplus 250 kcal' : 'Maintenance'}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Ainsworth et al. (2011) Compendium of Physical Activities · Berat digunakan: <strong>{weight} kg</strong>
            </p>
          </div>

          {/* Seksi 2 — Distribusi Makronutrien */}
          <div className={sectionCls}>
            <h2 className={headerCls}>Distribusi Makronutrien</h2>
            <p className="text-xs text-gray-400 mb-4">
              Burke et al. (2011) Journal of Sports Sciences · Phillips & Van Loon (2011) · Institute of Medicine (serat)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Hari Latihan */}
              <div>
                <p className="text-xs font-medium text-indigo-700 uppercase mb-3">🏃 Hari Latihan</p>
                <div className="space-y-2">
                  {[
                    { label: 'Protein', g: macrosTraining.proteinG, perKg: macrosTraining.proteinPerKg, kcal: macrosTraining.proteinKcal, color: '#8b5cf6', pct: Math.round(macrosTraining.proteinKcal / macrosTraining.targetKcal * 100) },
                    { label: 'Karbohidrat', g: macrosTraining.carbG, perKg: macrosTraining.carbPerKg, kcal: macrosTraining.carbKcal, color: '#f59e0b', pct: Math.round(macrosTraining.carbKcal / macrosTraining.targetKcal * 100) },
                    { label: 'Lemak', g: macrosTraining.fatG, perKg: +(macrosTraining.fatG / weight).toFixed(1), kcal: macrosTraining.fatKcal, color: '#10b981', pct: Math.round(macrosTraining.fatKcal / macrosTraining.targetKcal * 100) },
                    { label: 'Serat', g: macrosTraining.fiberG, perKg: null, kcal: null, color: '#6b7280', pct: null },
                  ].map(m => (
                    <div key={m.label} className={cardCls}>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <p className="text-xs font-medium text-gray-600">{m.label}</p>
                          {m.perKg && <p className="text-xs text-gray-400">{m.perKg} g/kg</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold" style={{ color: m.color }}>{m.g} g</p>
                          {m.kcal && <p className="text-xs text-gray-400">{m.kcal} kcal {m.pct ? `(${m.pct}%)` : ''}</p>}
                        </div>
                      </div>
                      {m.pct && (
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${m.pct}%`, backgroundColor: m.color }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {/* Hari Istirahat */}
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-3">😴 Hari Istirahat</p>
                <div className="space-y-2">
                  {[
                    { label: 'Protein', g: macrosRest.proteinG, perKg: macrosRest.proteinPerKg, kcal: macrosRest.proteinKcal, color: '#8b5cf6', pct: Math.round(macrosRest.proteinKcal / macrosRest.targetKcal * 100) },
                    { label: 'Karbohidrat', g: macrosRest.carbG, perKg: macrosRest.carbPerKg, kcal: macrosRest.carbKcal, color: '#f59e0b', pct: Math.round(macrosRest.carbKcal / macrosRest.targetKcal * 100) },
                    { label: 'Lemak', g: macrosRest.fatG, perKg: +(macrosRest.fatG / weight).toFixed(1), kcal: macrosRest.fatKcal, color: '#10b981', pct: Math.round(macrosRest.fatKcal / macrosRest.targetKcal * 100) },
                    { label: 'Serat', g: macrosRest.fiberG, perKg: null, kcal: null, color: '#6b7280', pct: null },
                  ].map(m => (
                    <div key={m.label} className={cardCls}>
                      <div className="flex justify-between items-start mb-1">
                        <div>
                          <p className="text-xs font-medium text-gray-600">{m.label}</p>
                          {m.perKg && <p className="text-xs text-gray-400">{m.perKg} g/kg</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold" style={{ color: m.color }}>{m.g} g</p>
                          {m.kcal && <p className="text-xs text-gray-400">{m.kcal} kcal {m.pct ? `(${m.pct}%)` : ''}</p>}
                        </div>
                      </div>
                      {m.pct && (
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${m.pct}%`, backgroundColor: m.color }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Seksi 3 — Kalori Latihan */}
          <div className={sectionCls}>
            <h2 className={headerCls}>Kalori dari Latihan</h2>
            <div className="flex items-center gap-2 mb-4 p-2 bg-amber-50 rounded-lg border border-amber-100">
              <span className="text-amber-500 text-xs">⚠</span>
              <p className="text-xs text-amber-700">
                Input manual — akan terhubung otomatis ke Daily Log setelah menu tersebut selesai dibangun.
              </p>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Kalori = MET × berat (kg) × durasi (jam) · Ainsworth et al. (2011)
            </p>

            {/* Input */}
            <div className="flex flex-wrap gap-4 mb-5">
              <div>
                <label className={labelCls}>Tipe Sesi</label>
                <select value={sessionType} onChange={e => setSessionType(e.target.value)} className={selectCls}>
                  {Object.entries(SESSION_MET).map(([k, v]) => (
                    <option key={k} value={k}>{v.label} (MET {v.met})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Durasi (menit)</label>
                <input type="number" min="10" max="360" value={sessionDur}
                  onChange={e => setSessionDur(e.target.value)}
                  className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>

            {/* Output */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <div className={cardCls}>
                <p className={labelCls}>MET Value</p>
                <p className={valueCls}>{sessMet.met}</p>
                <p className="text-xs text-gray-400">{sessMet.label}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-3">
                <p className={labelCls}>Kalori Terbakar</p>
                <p className="text-lg font-bold text-orange-600">{sessKcal.toLocaleString()} kcal</p>
                <p className="text-xs text-gray-400">{sessionDur} menit · {weight} kg</p>
              </div>
              <div className={`rounded-lg p-3 ${netKcal < macrosTraining.targetKcal * 0.7 ? 'bg-red-50' : 'bg-green-50'}`}>
                <p className={labelCls}>Net Kalori Hari Ini</p>
                <p className={`text-lg font-bold ${netKcal < macrosTraining.targetKcal * 0.7 ? 'text-red-600' : 'text-green-600'}`}>
                  {netKcal.toLocaleString()} kcal
                </p>
                <p className="text-xs text-gray-400">Target − Kalori terbakar</p>
              </div>
            </div>
            {needsRefuel && (
              <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                💡 Kalori terbakar &gt;500 kcal — disarankan refuel post-workout dalam 30 menit:
                <strong> ~{Math.round(sessKcal * 0.4)} kcal karbohidrat + {Math.round(weight * 0.3)} g protein.</strong>
              </div>
            )}
          </div>

          {/* Seksi 4 — Race Day Calorie Target */}
          <div className={sectionCls}>
            <h2 className={headerCls}>Race Day Calorie Target</h2>
            {!raceActive ? (
              <p className="text-sm text-gray-400">Tidak ada Race A aktif. Daftarkan race di menu Races untuk melihat kalkulasi ini.</p>
            ) : (
              <>
                <div className="mb-4 p-3 bg-indigo-50 rounded-lg flex flex-wrap gap-3 items-center text-sm">
                  <span className="font-semibold text-indigo-700">{raceActive.name}</span>
                  {raceActive.distance_km && <span className="text-gray-500">{raceActive.distance_km} km</span>}
                  {raceActive.target_finish && <span className="text-indigo-600 font-medium">Target: {raceActive.target_finish}</span>}
                  {raceDurationMin && <span className="text-gray-500">≈ {Math.floor(raceDurationMin/60)}j {raceDurationMin%60}m</span>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div className={cardCls}>
                    <p className={labelCls}>Estimasi Durasi Race</p>
                    <p className={valueCls}>{raceDurationMin ? `${Math.floor(raceDurationMin/60)}j ${raceDurationMin%60}m` : '—'}</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-3">
                    <p className={labelCls}>Kalori Terbakar Race</p>
                    <p className="text-lg font-bold text-red-600">{raceKcal ? raceKcal.toLocaleString() : '—'} kcal</p>
                  </div>
                  <div className="bg-indigo-50 rounded-lg p-3">
                    <p className={labelCls}>Target Kalori H-1</p>
                    <p className="text-lg font-bold text-indigo-700">{raceH1Kcal ? raceH1Kcal.toLocaleString() : '—'} kcal</p>
                    <p className="text-xs text-gray-400">TDEE ×1.1 + 10% race</p>
                  </div>
                  <div className={cardCls}>
                    <p className={labelCls}>Sarapan Race Morning</p>
                    <p className={valueCls}>{raceKcal ? `${Math.round(raceKcal * 0.15)}–${Math.round(raceKcal * 0.20)} kcal` : '—'}</p>
                    <p className="text-xs text-gray-400">H-2.5 jam sebelum start</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  MET race pace {SESSION_MET.race.met} · Kalori during race: gel ~100 kcal/45 menit disarankan jika durasi &gt;75 menit.
                </p>
              </>
            )}
          </div>

        </div>
      )}

      {/* ══ TAB: NUTRITION & FUELING ══ */}
      {(activeTab === 'nutrition' || activeTab === 'fueling') && (
        <>
          {/* Panduan Format */}
          <details className="bg-white rounded-xl shadow-sm overflow-hidden group">
            <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none list-none border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <h2 className="font-gsans text-base text-indigo-700 uppercase">📖 Panduan Format</h2>
              <span className="text-xs text-gray-400 group-open:hidden">Klik untuk lihat</span>
              <span className="text-xs text-gray-400 hidden group-open:inline">Tutup ▲</span>
            </summary>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {FORMAT_GUIDE.map(g => (
                  <div key={g.syntax} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <code className="text-xs font-mono text-indigo-600 block mb-1">{g.syntax}</code>
                    <div className="text-xs text-gray-500">{g.result}</div>
                  </div>
                ))}
              </div>
            </div>
          </details>

          {/* Sections grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {SECTIONS.filter(sec => TAB_SECTIONS[activeTab]?.includes(sec.key)).map(sec => {
              const isEditing  = editKey === sec.key
              const custom     = isCustom(sec.key)
              const lastUpdate = getRow(sec.key)?.updated_at
              return (
                <div key={sec.key} className="bg-white rounded-xl shadow-sm overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
                    style={{ borderLeftWidth: 4, borderLeftColor: sec.color, borderLeftStyle: 'solid' }}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg flex-shrink-0">{sec.icon}</span>
                      <div className="min-w-0">
                        <h2 className="font-gsans text-base text-indigo-700 uppercase truncate">{getTitle(sec.key)}</h2>
                        {custom && lastUpdate && (
                          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                            Diubah {new Date(lastUpdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        )}
                      </div>
                    </div>
                    {canEdit && !isEditing && (
                      <button onClick={() => startEdit(sec.key)}
                        className="text-xs px-3 py-1 rounded-lg border border-indigo-500 text-indigo-600 hover:bg-indigo-50 transition-colors flex-shrink-0 ml-2">
                        Edit
                      </button>
                    )}
                    {canEdit && isEditing && (
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <button onClick={cancelEdit} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">Batal</button>
                        {custom && <button onClick={() => resetSection(sec.key)} className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">Reset</button>}
                        <button onClick={saveSection} disabled={saving} className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors font-medium">{saving ? '...' : 'Simpan'}</button>
                      </div>
                    )}
                  </div>
                  <div className="p-5 flex-1">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Judul Seksi</label>
                          <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder={sec.defaultTitle}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Konten (Markdown)</label>
                          <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={14}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 font-mono focus:outline-none focus:border-indigo-400 resize-y" />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-gray-500 uppercase mb-2">Preview</div>
                          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 min-h-[60px]"
                            dangerouslySetInnerHTML={{ __html: parseMarkdown(editContent) }} />
                        </div>
                      </div>
                    ) : (
                      <div className="min-h-[60px]" dangerouslySetInnerHTML={{ __html: parseMarkdown(getContent(sec.key)) }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

    </div>
  )
}
