import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface EwsEntry {
  id: string
  athlete_id: string
  entry_date: string
  resting_hr: number | null
  hrv: number | null
  sleep_hours: number | null
  sleep_quality: number | null
  muscle_soreness: number | null
  motivation: number | null
  mood: number | null
  fatigue: number | null
  stress: number | null
  composite_score: number | null
  notes: string | null
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

const FORM_BLANK: EwsForm = {
  entry_date: new Date().toISOString().slice(0, 10),
  resting_hr: '', hrv: '', sleep_str: '', sleep_hours: '',
  sleep_quality: '', muscle_soreness: '', motivation: '',
  mood: '', fatigue: '', stress: '', notes: ''
}

const STATUS_CONFIG = [
  { max: 15,  label: 'Sangat Prima',             color: '#6366f1', bg: '#eef2ff', icon: '🛡️', rec: 'Pemulihan sangat tuntas. Tubuh dalam keadaan optimal untuk menyerap beban latihan berat (Long Run atau Interval). Lanjutkan sesuai program dengan percaya diri!' },
  { max: 30,  label: 'Kondisi Baik',              color: '#10b981', bg: '#ecfdf5', icon: '✅', rec: 'Kelelahan berada pada tingkat normal dan dapat ditoleransi. Anda masih dalam zona produktif untuk melanjutkan program mingguan.' },
  { max: 45,  label: 'Waspada Kelelahan',         color: '#f59e0b', bg: '#fffbeb', icon: '⚠️', rec: 'Tubuh menunjukkan tanda kelelahan yang mulai menumpuk. Rekomendasi: Kurangi intensitas lari 10–15% hari ini, atau ganti Quality Run menjadi Easy RWR pace.' },
  { max: 60,  label: 'Kelelahan Tingkat Tinggi',  color: '#ef4444', bg: '#fef2f2', icon: '🚨', rec: 'Peringatan! Risiko cedera dan overtraining meningkat drastis. Sangat disarankan mengganti sesi lari dengan Active Recovery atau pilih Full Rest.' },
  { max: 101, label: 'Danger Zone / Overreaching',color: '#1e293b', bg: '#f8fafc', icon: '💀', rec: 'DANGER! Sistem saraf pusat kelelahan ekstrim. Segera hentikan seluruh aktivitas latihan. Wajib Full Rest 1–2 hari, prioritaskan hidrasi dan tidur ekstra.' },
]

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

function calculateEWS(
  dateStr: string, rhr: number, hrv: number,
  sleep: number, sleepQual: number, doms: number, energy: number,
  history: EwsEntry[], profileHRrest: number
): EwsResult {
  const past = history.filter(e => e.entry_date < dateStr).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
  let baseRhr = profileHRrest || 55, baseHrv = 50, baseSource = 'default profil'
  if (past.length >= 3) {
    const last5 = past.slice(0, 5)
    const rhrV = last5.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = last5.map(e => e.hrv).filter((v): v is number => v != null)
    if (rhrV.length) baseRhr = rhrV.reduce((a, b) => a + b, 0) / rhrV.length
    if (hrvV.length) baseHrv = hrvV.reduce((a, b) => a + b, 0) / hrvV.length
    baseSource = `rata-rata ${Math.min(past.length, 5)} entri terakhir`
  } else if (past.length > 0) {
    const rhrV = past.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvV = past.map(e => e.hrv).filter((v): v is number => v != null)
    if (rhrV.length) baseRhr = (rhrV.reduce((a, b) => a + b, 0) / rhrV.length * 0.7) + (profileHRrest * 0.3)
    if (hrvV.length) baseHrv = (hrvV.reduce((a, b) => a + b, 0) / hrvV.length * 0.7) + (50 * 0.3)
    baseSource = `${past.length} entri (blended dengan profil)`
  }
  let scoreRhr = 0, scoreHrv = 0
  if (rhr > 0 && baseRhr > 0) scoreRhr = Math.min(Math.max(((rhr - baseRhr) / baseRhr) * 200, 0), 100)
  if (hrv > 0 && baseHrv > 0) scoreHrv = Math.min(Math.max(((hrv - baseHrv) / baseHrv) * -200, 0), 100)
  const scorePhys  = (0.6 * scoreHrv) + (0.4 * scoreRhr)
  const scoreSleep = Math.min(100, ((Math.max(0, 7 - sleep) / 7) * 60) + ((Math.max(0, 5 - sleepQual) / 5) * 40))
  const scoreDoms  = (doms / 10) * 100
  const scoreEnergy = ((10 - energy) / 10) * 100
  const totalScore = (0.35 * scorePhys) + (0.3 * scoreSleep) + (0.2 * scoreDoms) + (0.15 * scoreEnergy)
  return { baseRhr, baseHrv, baseSource, scorePhys, scoreSleep, scoreDoms, scoreEnergy, totalScore }
}

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
  const [filterWeek, setFilterWeek] = useState<string>('ALL')
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
    const { data } = await (supabase as any).from('ews_entries').select('*').eq('athlete_id', athId).order('entry_date', { ascending: false })
    setEntries(data || [])
  }

  // Real-time calc
  useEffect(() => {
    const rhr = parseFloat(form.resting_hr), hrv = parseFloat(form.hrv)
    const sleep = parseSleepStr(form.sleep_str) ?? parseFloat(form.sleep_hours)
    const sq = parseFloat(form.sleep_quality), doms = parseFloat(form.muscle_soreness), energy = parseFloat(form.motivation)
    if (!form.entry_date || isNaN(rhr) || isNaN(hrv) || isNaN(sleep) || isNaN(sq) || isNaN(doms) || isNaN(energy)) { setResult(null); return }
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
      if (editingId) { await (supabase as any).from('ews_entries').update(payload).eq('id', editingId); showToast('Entri diperbarui') }
      else { await (supabase as any).from('ews_entries').insert(payload); showToast('Entri disimpan') }
      setForm(FORM_BLANK); setEditingId(null)
      await loadEntries(athleteId)
    } catch (e: any) { showToast('Gagal: ' + e.message, false) }
    finally { setSaving(false) }
  }

  function editEntry(e: EwsEntry) {
    const h = Math.floor(e.sleep_hours ?? 0), m = Math.round(((e.sleep_hours ?? 0) - h) * 60)
    const sleepStr = (e.sleep_hours ?? 0) > 0 ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}` : ''
    setForm({ entry_date: e.entry_date, resting_hr: e.resting_hr?.toString() || '', hrv: e.hrv?.toString() || '', sleep_str: sleepStr, sleep_hours: (e.sleep_hours ?? 0) > 0 ? (e.sleep_hours!).toFixed(2) : '', sleep_quality: e.sleep_quality?.toString() || '', muscle_soreness: e.muscle_soreness?.toString() || '', motivation: e.motivation?.toString() || '', mood: e.mood?.toString() || '', fatigue: e.fatigue?.toString() || '', stress: e.stress?.toString() || '', notes: e.notes || '' })
    setEditingId(e.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteEntry(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await (supabase as any).from('ews_entries').delete().eq('id', id)
    await loadEntries(athleteId!); showToast('Entri dihapus')
  }

  // Filter & stats
  const filteredEntries = useCallback(() => {
    if (filterWeek === 'ALL') return [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    const [y, w] = filterWeek.split('-W').map(Number)
    return entries.filter(e => {
      const d = new Date(e.entry_date)
      const jan4 = new Date(y, 0, 4)
      const wn = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
      return d.getFullYear() === y && wn === w
    }).sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  }, [entries, filterWeek])

  const filtered = filteredEntries()
  const avg = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

  const avgPhysio = avg(filtered.map(e => { if (!e.resting_hr || !e.hrv || !e.composite_score) return null; return e.composite_score > 0 ? null : null; return null }))
  // Simpler: compute from composite if available
  const avgFatigue = avg(filtered.map(e => e.composite_score))
  const avgSleep   = avg(filtered.map(e => e.sleep_hours))
  const avgDoms    = avg(filtered.map(e => e.muscle_soreness))
  const avgEnergy  = avg(filtered.map(e => e.motivation))

  // Chart data
  const chartData = filtered.map(e => ({
    date: new Date(e.entry_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
    fatigue: e.composite_score != null ? parseFloat(e.composite_score.toFixed(1)) : null,
    rhr: e.resting_hr,
    hrv: e.hrv,
    energy: e.motivation != null ? e.motivation * 10 : null
  }))

  // Week filter options
  const weekOptions = Array.from(new Set(entries.map(e => {
    const d = new Date(e.entry_date)
    const jan4 = new Date(d.getFullYear(), 0, 4)
    const wn = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${wn.toString().padStart(2,'0')}`
  }))).sort().reverse()

  const status = result ? getStatus(result.totalScore) : null

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {toast && <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>{toast.msg}</div>}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h1 className="font-gsans text-xl text-indigo-700 uppercase">Early Warning System (EWS) Tracker</h1>
        <p className="text-xs text-gray-400 mt-0.5">Algoritma Penilaian Kelelahan Otomatis (Total Fatigue Score) berdasarkan Metrik Fisik & Perasaan</p>
      </div>

      {/* Mini Dashboard */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700">Rata-Rata Metrik Kelelahan</h3>
          <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="ALL">Semua Waktu</option>
            {weekOptions.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Avg Physiology Score', val: avgPhysio, icon: '❤️', color: '#6366f1' },
            { label: 'Avg Sleep Score',       val: avgSleep ? Math.min(100, (Math.max(0, 7 - avgSleep) / 7) * 100) : null, icon: '😴', color: '#8b5cf6' },
            { label: 'Avg DOMS Score',        val: avgDoms != null ? (avgDoms / 10) * 100 : null, icon: '🔥', color: '#ef4444' },
            { label: 'Avg Energy Score',      val: avgEnergy != null ? ((10 - avgEnergy) / 10) * 100 : null, icon: '⚡', color: '#f59e0b' },
            { label: 'Avg Fatigue Score',     val: avgFatigue, icon: '🔋', color: '#1e293b' },
          ].map(({ label, val, icon, color }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
              <span className="text-2xl">{icon}</span>
              <div>
                <div className="text-xs text-gray-400 leading-tight">{label}</div>
                <div className="text-lg font-bold" style={{ color }}>{val != null ? val.toFixed(1) : '—'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend Chart */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Tren Metrik Kelelahan Harian</h2>
        {chartData.length < 2 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <div className="text-4xl mb-3">📈</div>
            <div>Belum ada data EWS. Simpan minimal 2 entri untuk melihat tren.</div>
          </div>
        ) : (
          <>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4 text-xs font-semibold">
              {[['#6366f1','Fatigue Score'],['#ef4444','RHR (bpm)'],['#10b981','HRV (ms)'],['#f59e0b','Energy (×10)']].map(([c,l]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className="inline-block w-4 h-0.5 rounded" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="score" domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="hr" orientation="right" domain={['auto','auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <ReferenceLine yAxisId="score" y={15} stroke="#6366f1" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <ReferenceLine yAxisId="score" y={30} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <ReferenceLine yAxisId="score" y={45} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <ReferenceLine yAxisId="score" y={60} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
                  <Line yAxisId="score" type="monotone" dataKey="fatigue" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} name="Fatigue Score" connectNulls />
                  <Line yAxisId="hr" type="monotone" dataKey="rhr" stroke="#ef4444" strokeWidth={1.8} dot={{ r: 3 }} name="RHR (bpm)" connectNulls />
                  <Line yAxisId="hr" type="monotone" dataKey="hrv" stroke="#10b981" strokeWidth={1.8} dot={{ r: 3 }} name="HRV (ms)" connectNulls />
                  <Line yAxisId="score" type="monotone" dataKey="energy" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="5 5" dot={{ r: 3 }} name="Energy (×10)" connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Zone badges */}
            <div className="flex flex-wrap gap-2 mt-4">
              {[['#eef2ff','#6366f1','≤15 Sangat Prima'],['#ecfdf5','#065f46','≤30 Kondisi Baik'],['#fffbeb','#92400e','≤45 Waspada'],['#fef2f2','#991b1b','≤60 Kelelahan Tinggi'],['#1e293b','#f8fafc','>60 Danger Zone']].map(([bg,col,lbl]) => (
                <span key={lbl} className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: bg, color: col }}>{lbl}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Input Form */}
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
            <span>✏️ Mode Edit — perubahan akan recalculate skor</span>
            <button onClick={() => { setForm(FORM_BLANK); setEditingId(null) }}
              className="border border-red-200 text-red-600 text-xs px-3 py-1 rounded-lg hover:bg-red-50">Batal</button>
          </div>
        )}

        {/* Row 1: Tanggal, Sleep, Sleep Quality */}
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
            <input type="number" min={1} max={5} value={form.sleep_quality} onChange={e => setForm(f => ({ ...f, sleep_quality: e.target.value }))}
              placeholder="4" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>

        {/* Row 2: DOMS, Energy, RHR, HRV */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">DOMS / Nyeri (1–10)</div>
            <input type="number" min={0} max={10} value={form.muscle_soreness} onChange={e => setForm(f => ({ ...f, muscle_soreness: e.target.value }))}
              placeholder="1" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">Energy Level (1–10)</div>
            <input type="number" min={1} max={10} value={form.motivation} onChange={e => setForm(f => ({ ...f, motivation: e.target.value }))}
              placeholder="8" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">RHR Pagi (bpm) *</div>
            <input type="number" value={form.resting_hr} onChange={e => setForm(f => ({ ...f, resting_hr: e.target.value }))}
              placeholder="62" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">HRV (ms) *</div>
            <input type="number" value={form.hrv} onChange={e => setForm(f => ({ ...f, hrv: e.target.value }))}
              placeholder="65" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>

        {/* Baseline info */}
        {result && (
          <div className="mb-4 px-3 py-2 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-xs text-gray-600">
            ℹ️ Base RHR: <strong>{result.baseRhr.toFixed(0)} bpm</strong> &nbsp;·&nbsp; Base HRV: <strong>{result.baseHrv.toFixed(0)} ms</strong> &nbsp;·&nbsp; Sumber: <em>{result.baseSource}</em>
          </div>
        )}

        {/* Extra fields */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">Mood (1–5)</div>
            <input type="number" min={1} max={5} value={form.mood} onChange={e => setForm(f => ({ ...f, mood: e.target.value }))}
              placeholder="4" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">Kelelahan (1–5)</div>
            <input type="number" min={1} max={5} value={form.fatigue} onChange={e => setForm(f => ({ ...f, fatigue: e.target.value }))}
              placeholder="2" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">Stres (1–5)</div>
            <input type="number" min={1} max={5} value={form.stress} onChange={e => setForm(f => ({ ...f, stress: e.target.value }))}
              placeholder="2" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
          <input type="text" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Kondisi khusus, cedera, keluhan..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
        </div>

        {/* EWS Auto Status */}
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-2">Analisis Algoritma: Total Skor Fatigue & Rekomendasi (Otomatis)</div>
          {!result ? (
            <div className="border border-gray-200 rounded-lg px-4 py-4 text-sm text-gray-400">
              ℹ️ Silakan lengkapi semua metrik untuk melihat analisis algoritma EWS Anda.
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
        {entries.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">Belum ada entri EWS.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  {['Tanggal','Sleep (Jam)','Sleep Qual','DOMS','Energy','RHR','HRV','Fatigue Score','Aksi'].map(h => (
                    <th key={h} className="text-xs font-medium text-gray-500 uppercase pb-2 pr-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
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
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>
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
        )}
      </div>
    </div>
  )
}
