import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EwsEntry {
  id: string; athlete_id: string; entry_date: string
  resting_hr: number | null; hrv: number | null; sleep_hours: number | null
  sleep_quality: number | null; muscle_soreness: number | null; motivation: number | null
  mood: number | null; fatigue: number | null; stress: number | null
  composite_score: number | null; notes: string | null
}

interface EwsResult {
  baseRhr: number; baseHrv: number; baseSource: string
  scorePhys: number; scoreSleep: number; scoreDoms: number; scoreEnergy: number; totalScore: number
}

interface EwsForm {
  entry_date: string; resting_hr: string; hrv: string
  sleep_str: string; sleep_hours: string; sleep_quality: string
  muscle_soreness: string; motivation: string
  mood: string; fatigue: string; stress: string; notes: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FORM_BLANK: EwsForm = {
  entry_date: new Date().toISOString().slice(0, 10),
  resting_hr: '', hrv: '', sleep_str: '', sleep_hours: '',
  sleep_quality: '', muscle_soreness: '', motivation: '',
  mood: '', fatigue: '', stress: '', notes: ''
}

const STATUS_CONFIG = [
  { max: 15,  label: 'Sangat Prima',              color: '#6366f1', bg: '#eef2ff', icon: '🛡️', rec: 'Pemulihan sangat tuntas. Tubuh dalam keadaan optimal untuk menyerap beban latihan berat (Long Run atau Interval). Lanjutkan sesuai program dengan percaya diri!' },
  { max: 30,  label: 'Kondisi Baik',               color: '#10b981', bg: '#ecfdf5', icon: '✅', rec: 'Kelelahan berada pada tingkat normal dan dapat ditoleransi. Anda masih dalam zona produktif untuk melanjutkan program mingguan.' },
  { max: 45,  label: 'Waspada Kelelahan',          color: '#f59e0b', bg: '#fffbeb', icon: '⚠️', rec: 'Tubuh menunjukkan tanda kelelahan yang mulai menumpuk. Rekomendasi: Kurangi intensitas lari 10–15% hari ini, atau ganti Quality Run menjadi Easy RWR pace.' },
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

// ── Algorithm (v2.11 locked) ──────────────────────────────────────────────────

function calculateEWS(
  dateStr: string, rhr: number, hrv: number,
  sleep: number, sleepQual: number, doms: number, energy: number,
  history: EwsEntry[], _profileHRrest: number
): EwsResult {
  const past = history.filter(e => e.entry_date < dateStr).sort((a, b) => b.entry_date.localeCompare(a.entry_date))

  // Baseline strategy (Kiviniemi et al. 2007 / Plews et al. 2013):
  // Measure deviation relative to individual baseline, not population norms.
  // Entri ke-1 : baseline = nilai hari itu sendiri (scoreRHR/HRV = 0, no false alarm)
  // Entri ke-2+: blended avg entri sebelumnya (70%) + hari itu (30%)
  // Entri ke-3+: rolling avg 5 entri terakhir (fully data-driven)
  let baseRhr = rhr   // default: hari itu sendiri (entri pertama)
  let baseHrv = hrv   // default: hari itu sendiri (entri pertama)
  let baseSource = 'hari ini (entri pertama — baseline akan akurat setelah 5–7 entri)'

  if (past.length >= 3) {
    const last5 = past.slice(0, 5)
    const rhrV = last5.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = last5.map(e => e.hrv).filter((v): v is number => v != null)
    if (rhrV.length) baseRhr = rhrV.reduce((a, b) => a + b, 0) / rhrV.length
    if (hrvV.length) baseHrv = hrvV.reduce((a, b) => a + b, 0) / hrvV.length
    baseSource = `rolling avg ${Math.min(past.length, 5)} entri terakhir`
  } else if (past.length > 0) {
    const rhrV = past.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = past.map(e => e.hrv).filter((v): v is number => v != null)
    const avgPastRhr = rhrV.length ? rhrV.reduce((a, b) => a + b, 0) / rhrV.length : rhr
    const avgPastHrv = hrvV.length ? hrvV.reduce((a, b) => a + b, 0) / hrvV.length : hrv
    baseRhr = avgPastRhr * 0.7 + rhr * 0.3
    baseHrv = avgPastHrv * 0.7 + hrv * 0.3
    baseSource = `${past.length} entri (blended, baseline berkembang)`
  }

  let scoreRhr = 0, scoreHrv = 0
  if (rhr > 0 && baseRhr > 0) scoreRhr = Math.min(Math.max(((rhr - baseRhr) / baseRhr) * 200, 0), 100)
  if (hrv > 0 && baseHrv > 0) scoreHrv = Math.min(Math.max(((hrv - baseHrv) / baseHrv) * -200, 0), 100)

  const scorePhys   = (0.6 * scoreHrv) + (0.4 * scoreRhr)
  const scoreSleep  = Math.min(100, ((Math.max(0, 7 - sleep) / 7) * 60) + ((Math.max(0, 5 - sleepQual) / 5) * 40))
  const scoreDoms   = (doms / 10) * 100
  const scoreEnergy = ((10 - energy) / 10) * 100
  const totalScore  = (0.35 * scorePhys) + (0.3 * scoreSleep) + (0.2 * scoreDoms) + (0.15 * scoreEnergy)

  return { baseRhr, baseHrv, baseSource, scorePhys, scoreSleep, scoreDoms, scoreEnergy, totalScore }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EwsPage() {
  const [athleteId, setAthleteId]   = useState<string | null>(null)
  const [entries, setEntries]       = useState<EwsEntry[]>([])
  const [form, setForm]             = useState<EwsForm>(FORM_BLANK)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [result, setResult]         = useState<EwsResult | null>(null)
  const [profileHRrest, setProfileHRrest] = useState(55)
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
      const { data: settings } = await supabase.from('athlete_settings').select('resting_hr').eq('athlete_id', ath.id).single()
      if ((settings as any)?.resting_hr) setProfileHRrest((settings as any).resting_hr)
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

  // Real-time calc
  useEffect(() => {
    const rhr = parseFloat(form.resting_hr), hrv = parseFloat(form.hrv)
    const sleep = parseSleepStr(form.sleep_str) ?? parseFloat(form.sleep_hours)
    const sq = parseFloat(form.sleep_quality), doms = parseFloat(form.muscle_soreness), energy = parseFloat(form.motivation)
    if (!form.entry_date || isNaN(rhr) || isNaN(hrv) || isNaN(sleep) || isNaN(sq) || isNaN(doms) || isNaN(energy)) {
      setResult(null); return
    }
    setResult(calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, entries, profileHRrest))
  }, [form, entries, profileHRrest])

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
    let score: number | null = null
    if (rhr && hrv && sleep != null && sq != null && doms != null && energy != null)
      score = calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, entries, profileHRrest).totalScore
    const payload = {
      athlete_id: athleteId, entry_date: form.entry_date,
      resting_hr: rhr || null, hrv: hrv || null, sleep_hours: sleep,
      sleep_quality: sq, muscle_soreness: doms, motivation: energy,
      mood: form.mood ? parseInt(form.mood) : null,
      fatigue: form.fatigue ? parseInt(form.fatigue) : null,
      stress: form.stress ? parseInt(form.stress) : null,
      composite_score: score, notes: form.notes || null
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
      sleep_quality: e.sleep_quality?.toString() || '', muscle_soreness: e.muscle_soreness?.toString() || '',
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

  const avgPhysioScore = (() => {
    const vals = filtered.filter(e => e.composite_score != null).map(e => {
      const rhr = e.resting_hr ?? 0, hrv = e.hrv ?? 0
      if (!rhr || !hrv) return null
      const past5 = entries.filter(x => x.entry_date < e.entry_date)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 5)
      const bRhr = past5.length >= 1 ? (avg(past5.map(x => x.resting_hr)) ?? rhr) : rhr
      const bHrv = past5.length >= 1 ? (avg(past5.map(x => x.hrv)) ?? hrv) : hrv
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
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Early Warning System (EWS) Tracker</h1>
            <p className="text-xs text-gray-400 mt-0.5">Algoritma Penilaian Kelelahan Otomatis berdasarkan Metrik Fisik & Perasaan</p>
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
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl flex-shrink-0" style={{ background: latestStatus.bg }}>
                    {latestStatus.icon}
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Entri terakhir · {fmtDate(latest.entry_date)}</div>
                    <div className="text-xl font-bold" style={{ color: latestStatus.color }}>{latestStatus.label}</div>
                    <div className="text-xs text-gray-500 mt-1 leading-relaxed max-w-lg">{latestStatus.rec}</div>
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl px-6 py-4 min-w-[120px]">
                  <div className="text-3xl font-bold" style={{ color: latestStatus.color }}>
                    {latest.composite_score?.toFixed(1)}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Fatigue Score</div>
                  <div className="mt-2 h-1.5 w-20 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(latest.composite_score ?? 0, 100)}%`, background: latestStatus.color }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Filter + 5 Stat Cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-700">Rata-Rata Metrik Kelelahan</h3>
              <select value={filterWeek} onChange={e => { setFilterWeek(e.target.value); setPage(1) }}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                <option value="ALL">Semua Waktu</option>
                {weekOptions.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: 'Avg Physio Score',  val: avgPhysioScore, icon: '❤️', color: '#6366f1' },
                { label: 'Avg Sleep Score',   val: avgSleepH != null ? Math.min(100, (Math.max(0, 7 - avgSleepH) / 7) * 100) : null, icon: '😴', color: '#8b5cf6' },
                { label: 'Avg DOMS Score',    val: avgDoms != null ? (avgDoms / 10) * 100 : null, icon: '🔥', color: '#ef4444' },
                { label: 'Avg Energy Score',  val: avgEnergy != null ? ((10 - avgEnergy) / 10) * 100 : null, icon: '⚡', color: '#f59e0b' },
                { label: 'Avg Fatigue Score', val: avgFatigue, icon: '🔋', color: '#1e293b' },
              ].map(({ label, val, icon, color }) => (
                <div key={label} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <div className="text-[10px] text-gray-400 leading-tight">{label}</div>
                    <div className="text-lg font-bold" style={{ color }}>{val != null ? val.toFixed(1) : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Streak + Konsistensi + RHR/HRV Trend */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Streak */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-xs font-medium text-gray-500 uppercase mb-3">🔥 Streak & Konsistensi</div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-orange-500">{streak}</div>
                  <div className="text-xs text-gray-400">Hari Berturut</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div className="text-center">
                  <div className="text-3xl font-bold text-indigo-600">{goodPct}%</div>
                  <div className="text-xs text-gray-400">Hari Kondisi Baik</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-700">{filtered.length}</div>
                  <div className="text-xs text-gray-400">Total Entri</div>
                </div>
              </div>
            </div>

            {/* RHR Trend */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-xs font-medium text-gray-500 uppercase mb-3">💓 Tren RHR (7 hari terakhir)</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-800">{avgRhr != null ? avgRhr.toFixed(0) : '—'}</span>
                    <span className="text-2xl font-bold" style={{ color: rhrTrend.color }}>{rhrTrend.arrow}</span>
                  </div>
                  <div className="text-xs text-gray-400">bpm avg sekarang</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div>
                  <div className="text-xl font-bold text-gray-500">{avg(prev7.map(e => e.resting_hr))?.toFixed(0) ?? '—'}</div>
                  <div className="text-xs text-gray-400">bpm avg sebelumnya</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                {rhrTrend.color === '#10b981' ? '✅ RHR membaik (turun)' : rhrTrend.color === '#ef4444' ? '⚠️ RHR meningkat — monitor' : '→ RHR stabil'}
              </div>
            </div>

            {/* HRV Trend */}
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-xs font-medium text-gray-500 uppercase mb-3">📡 Tren HRV (7 hari terakhir)</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-800">{avg(last7.map(e => e.hrv))?.toFixed(0) ?? '—'}</span>
                    <span className="text-2xl font-bold" style={{ color: hrvTrend.color }}>{hrvTrend.arrow}</span>
                  </div>
                  <div className="text-xs text-gray-400">ms avg sekarang</div>
                </div>
                <div className="h-10 w-px bg-gray-100" />
                <div>
                  <div className="text-xl font-bold text-gray-500">{avg(prev7.map(e => e.hrv))?.toFixed(0) ?? '—'}</div>
                  <div className="text-xs text-gray-400">ms avg sebelumnya</div>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-400">
                {hrvTrend.color === '#10b981' ? '✅ HRV membaik (naik)' : hrvTrend.color === '#ef4444' ? '⚠️ HRV menurun — butuh recovery' : '→ HRV stabil'}
              </div>
            </div>
          </div>

          {/* Distribusi Status */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Distribusi Status</h2>
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
                <div className="flex flex-wrap gap-4 mb-4 text-xs font-semibold">
                  {[['#6366f1','Fatigue Score'],['#ef4444','RHR (bpm)'],['#10b981','HRV (ms)'],['#f59e0b','Energy (×10)']].map(([c,l]) => (
                    <span key={l} className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-0.5 rounded" style={{ background: c }} />{l}
                    </span>
                  ))}
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <YAxis yAxisId="hr" orientation="right" domain={['auto','auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                      <ReferenceLine yAxisId="score" y={15} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={30} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={45} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <ReferenceLine yAxisId="score" y={60} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.3} />
                      <Line yAxisId="score" type="monotone" dataKey="fatigue" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} name="Fatigue Score" connectNulls />
                      <Line yAxisId="hr"    type="monotone" dataKey="rhr"     stroke="#ef4444" strokeWidth={1.8} dot={{ r: 3 }} name="RHR (bpm)" connectNulls />
                      <Line yAxisId="hr"    type="monotone" dataKey="hrv"     stroke="#10b981" strokeWidth={1.8} dot={{ r: 3 }} name="HRV (ms)" connectNulls />
                      <Line yAxisId="score" type="monotone" dataKey="energy"  stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 5" dot={{ r: 3 }} name="Energy (×10)" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {[['#eef2ff','#6366f1','≤15 Sangat Prima'],['#ecfdf5','#065f46','≤30 Kondisi Baik'],['#fffbeb','#92400e','≤45 Waspada'],['#fef2f2','#991b1b','≤60 Kelelahan Tinggi'],['#1e293b','#f8fafc','>60 Danger Zone']].map(([bg,col,lbl]) => (
                    <span key={lbl} className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: bg, color: col }}>{lbl}</span>
                  ))}
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

            {/* Row 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
                <input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
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

            {/* Row 3: extra */}
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

            {/* Auto Status */}
            <div>
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">Analisis Algoritma: Total Skor Fatigue & Rekomendasi (Otomatis)</div>
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
                  <div className="flex flex-wrap gap-4 text-xs bg-white/60 rounded-lg px-3 py-2">
                    <span><strong>Scr Physio:</strong> {result.scorePhys.toFixed(1)}</span>
                    <span><strong>Scr Sleep:</strong> {result.scoreSleep.toFixed(1)}</span>
                    <span><strong>Scr DOMS:</strong> {result.scoreDoms.toFixed(1)}</span>
                    <span><strong>Scr Energy:</strong> {result.scoreEnergy.toFixed(1)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* History Table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Riwayat EWS & Fatigue Score</h2>
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
                        {['Tanggal','Sleep','S.Qual','DOMS','Energy','RHR','HRV','Fatigue Score',''].map(h => (
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
