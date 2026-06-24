import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface EwsForm {
  entry_date: string
  resting_hr: string
  hrv: string
  sleep_str: string   // HH:MM display
  sleep_hours: string // decimal
  sleep_quality: string
  muscle_soreness: string
  motivation: string
  mood: string
  fatigue: string
  stress: string
  notes: string
}

interface EwsResult {
  baseRhr: number
  baseHrv: number
  baseSource: string
  scorePhys: number
  scoreSleep: number
  scoreDoms: number
  scoreEnergy: number
  totalScore: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FORM_BLANK: EwsForm = {
  entry_date: new Date().toISOString().slice(0, 10),
  resting_hr: '', hrv: '',
  sleep_str: '', sleep_hours: '',
  sleep_quality: '', muscle_soreness: '',
  motivation: '', mood: '', fatigue: '', stress: '',
  notes: ''
}

const STATUS_CONFIG = [
  { max: 15,  label: 'Sangat Prima',          color: '#6366f1', bg: '#eef2ff', icon: '🛡️', rec: 'Pemulihan sangat tuntas. Tubuh dalam keadaan optimal untuk menyerap beban latihan berat (Long Run atau Interval). Lanjutkan sesuai program dengan percaya diri!' },
  { max: 30,  label: 'Kondisi Baik',           color: '#10b981', bg: '#ecfdf5', icon: '✅', rec: 'Kelelahan berada pada tingkat normal dan dapat ditoleransi. Anda masih dalam zona produktif untuk melanjutkan program mingguan.' },
  { max: 45,  label: 'Waspada Kelelahan',      color: '#f59e0b', bg: '#fffbeb', icon: '⚠️', rec: 'Tubuh menunjukkan tanda kelelahan yang mulai menumpuk. Rekomendasi: Kurangi intensitas lari 10–15% hari ini, atau ganti Quality Run menjadi Easy RWR pace.' },
  { max: 60,  label: 'Kelelahan Tingkat Tinggi', color: '#ef4444', bg: '#fef2f2', icon: '🚨', rec: 'Peringatan! Risiko cedera dan overtraining meningkat drastis. Sangat disarankan mengganti sesi lari dengan Active Recovery atau pilih Full Rest.' },
  { max: 101, label: 'Danger Zone / Overreaching', color: '#1e293b', bg: '#f1f5f9', icon: '💀', rec: 'DANGER! Sistem saraf pusat kelelahan ekstrim. Segera hentikan seluruh aktivitas latihan. Wajib Full Rest 1–2 hari, prioritaskan hidrasi dan tidur ekstra.' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getStatus(score: number) {
  return STATUS_CONFIG.find(s => score <= s.max) || STATUS_CONFIG[STATUS_CONFIG.length - 1]
}

function parseSleepStr(str: string): number | null {
  if (!str || !str.includes(':')) return null
  const [h, m] = str.split(':').map(Number)
  if (isNaN(h)) return null
  return h + (isNaN(m) ? 0 : m / 60)
}

// ── Core Algorithm (v2.11 locked) ─────────────────────────────────────────────

function calculateEWS(
  dateStr: string,
  rhr: number, hrv: number,
  sleep: number, sleepQual: number,
  doms: number, energy: number,
  history: EwsEntry[],
  profileHRrest: number
): EwsResult {
  const past = history
    .filter(e => e.entry_date < dateStr)
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date))

  let baseRhr = profileHRrest || 55
  let baseHrv = 50
  let baseSource = 'default profil'

  if (past.length >= 3) {
    const last5 = past.slice(0, 5)
    const rhrVals = last5.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvVals = last5.map(e => e.hrv).filter((v): v is number => v != null)
    if (rhrVals.length) baseRhr = rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length
    if (hrvVals.length) baseHrv = hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length
    baseSource = `rata-rata ${Math.min(past.length, 5)} entri terakhir`
  } else if (past.length > 0) {
    const rhrVals = past.map(e => e.resting_hr).filter((v): v is number => v != null)
    const hrvVals = past.map(e => e.hrv).filter((v): v is number => v != null)
    if (rhrVals.length) baseRhr = (rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length * 0.7) + (profileHRrest * 0.3)
    if (hrvVals.length) baseHrv = (hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length * 0.7) + (50 * 0.3)
    baseSource = `${past.length} entri (blended dengan profil)`
  }

  let scoreRhr = 0, scoreHrv = 0
  if (rhr > 0 && baseRhr > 0) scoreRhr = Math.min(Math.max(((rhr - baseRhr) / baseRhr) * 200, 0), 100)
  if (hrv > 0 && baseHrv > 0) scoreHrv = Math.min(Math.max(((hrv - baseHrv) / baseHrv) * -200, 0), 100)

  const scorePhys  = (0.6 * scoreHrv) + (0.4 * scoreRhr)
  const sleepDeficit = Math.max(0, 7 - sleep)
  const qualDeficit  = Math.max(0, 5 - sleepQual)
  const scoreSleep = Math.min(100, ((sleepDeficit / 7) * 60) + ((qualDeficit / 5) * 40))
  const scoreDoms   = (doms / 10) * 100
  const scoreEnergy = ((10 - energy) / 10) * 100
  const totalScore  = (0.35 * scorePhys) + (0.3 * scoreSleep) + (0.2 * scoreDoms) + (0.15 * scoreEnergy)

  return { baseRhr, baseHrv, baseSource, scorePhys, scoreSleep, scoreDoms, scoreEnergy, totalScore }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EwsPage() {
  const [athleteId, setAthleteId] = useState<string | null>(null)
  const [entries, setEntries]     = useState<EwsEntry[]>([])
  const [form, setForm]           = useState<EwsForm>(FORM_BLANK)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [result, setResult]       = useState<EwsResult | null>(null)
  const [profileHRrest, setProfileHRrest] = useState(55)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<{ msg: string; ok: boolean } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // ── Init ──
  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
      if (!ath) return
      setAthleteId(ath.id)

      // Load profile HRrest
      const { data: settings } = await supabase
        .from('athlete_settings').select('resting_hr').eq('athlete_id', ath.id).single()
      if (settings?.resting_hr) setProfileHRrest(settings.resting_hr)

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

  // ── Real-time calc on form change ──
  useEffect(() => {
    const rhr   = parseFloat(form.resting_hr)
    const hrv   = parseFloat(form.hrv)
    const sleep = parseSleepStr(form.sleep_str) ?? parseFloat(form.sleep_hours)
    const sq    = parseFloat(form.sleep_quality)
    const doms  = parseFloat(form.muscle_soreness)
    const energy = parseFloat(form.motivation)

    if (!form.entry_date || isNaN(rhr) || isNaN(hrv) || isNaN(sleep) || isNaN(sq) || isNaN(doms) || isNaN(energy)) {
      setResult(null); return
    }
    const res = calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, entries, profileHRrest)
    setResult(res)
  }, [form, entries, profileHRrest])

  // ── Sleep time converter ──
  function handleSleepStr(val: string) {
    let cleaned = val.replace(/\D/g, '')
    if (cleaned.length >= 3) cleaned = cleaned.slice(0, 2) + ':' + cleaned.slice(2, 4)
    const hours = parseSleepStr(cleaned)
    setForm(f => ({ ...f, sleep_str: cleaned, sleep_hours: hours != null ? hours.toFixed(2) : '' }))
  }

  // ── Save ──
  async function saveEntry() {
    if (!athleteId) return
    if (!form.entry_date || !form.resting_hr || !form.hrv) {
      showToast('Tanggal, RHR, dan HRV wajib diisi', false); return
    }
    setSaving(true)
    const sleep = parseSleepStr(form.sleep_str) ?? (form.sleep_hours ? parseFloat(form.sleep_hours) : null)
    const rhr = parseFloat(form.resting_hr)
    const hrv = parseFloat(form.hrv)
    const sq = form.sleep_quality ? parseInt(form.sleep_quality) : null
    const doms = form.muscle_soreness ? parseFloat(form.muscle_soreness) : null
    const energy = form.motivation ? parseFloat(form.motivation) : null

    let score: number | null = null
    if (rhr && hrv && sleep != null && sq != null && doms != null && energy != null) {
      const res = calculateEWS(form.entry_date, rhr, hrv, sleep, sq, doms, energy, entries, profileHRrest)
      score = res.totalScore
    }

    const payload = {
      athlete_id: athleteId,
      entry_date: form.entry_date,
      resting_hr: rhr || null,
      hrv: hrv || null,
      sleep_hours: sleep,
      sleep_quality: sq,
      muscle_soreness: doms,
      motivation: energy,
      mood: form.mood ? parseInt(form.mood) : null,
      fatigue: form.fatigue ? parseInt(form.fatigue) : null,
      stress: form.stress ? parseInt(form.stress) : null,
      composite_score: score,
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
      setForm(FORM_BLANK)
      setEditingId(null)
      await loadEntries(athleteId)
    } catch (e: any) {
      showToast('Gagal: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  function editEntry(e: EwsEntry) {
    const sleepH = e.sleep_hours ?? 0
    const h = Math.floor(sleepH)
    const m = Math.round((sleepH - h) * 60)
    const sleepStr = sleepH > 0 ? `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}` : ''
    setForm({
      entry_date: e.entry_date,
      resting_hr: e.resting_hr?.toString() || '',
      hrv: e.hrv?.toString() || '',
      sleep_str: sleepStr,
      sleep_hours: sleepH > 0 ? sleepH.toFixed(2) : '',
      sleep_quality: e.sleep_quality?.toString() || '',
      muscle_soreness: e.muscle_soreness?.toString() || '',
      motivation: e.motivation?.toString() || '',
      mood: e.mood?.toString() || '',
      fatigue: e.fatigue?.toString() || '',
      stress: e.stress?.toString() || '',
      notes: e.notes || ''
    })
    setEditingId(e.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function deleteEntry(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await (supabase as any).from('ews_entries').delete().eq('id', id)
    await loadEntries(athleteId!)
    showToast('Entri dihapus')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  const status = result ? getStatus(result.totalScore) : null
  const latest = entries[0]
  const latestStatus = latest?.composite_score != null ? getStatus(latest.composite_score) : null

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">EWS Tracker</h1>
            <p className="text-xs text-gray-400 mt-0.5">Early Warning System — monitor kesiapan tubuh harian</p>
          </div>
          {latestStatus && latest && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl border" style={{ background: latestStatus.bg, borderColor: latestStatus.color + '40' }}>
              <span className="text-xl">{latestStatus.icon}</span>
              <div>
                <div className="text-xs text-gray-500">Status Terakhir ({fmtDate(latest.entry_date)})</div>
                <div className="text-sm font-bold" style={{ color: latestStatus.color }}>{latestStatus.label}</div>
                <div className="text-xs text-gray-400">Skor: {latest.composite_score?.toFixed(1)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">

        {/* LEFT: Form */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
              {editingId ? 'Edit Entri' : 'Input Harian'}
            </h2>

            {/* Date */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
              <input type="date" value={form.entry_date}
                onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>

            {/* Physiological */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">📊 Data Fisiologis</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">RHR (bpm) *</div>
                  <input type="number" value={form.resting_hr}
                    onChange={e => setForm(f => ({ ...f, resting_hr: e.target.value }))}
                    placeholder="cth. 52" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HRV (ms) *</div>
                  <input type="number" value={form.hrv}
                    onChange={e => setForm(f => ({ ...f, hrv: e.target.value }))}
                    placeholder="cth. 65" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              {result && (
                <div className="mt-2 text-[10px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  Baseline → RHR: <strong>{result.baseRhr.toFixed(0)} bpm</strong> · HRV: <strong>{result.baseHrv.toFixed(0)} ms</strong> · Sumber: <em>{result.baseSource}</em>
                </div>
              )}
            </div>

            {/* Sleep */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">😴 Tidur</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Durasi (HH:MM)</div>
                  <input type="text" value={form.sleep_str} maxLength={5}
                    onChange={e => handleSleepStr(e.target.value)}
                    placeholder="07:30"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  {form.sleep_hours && <div className="text-[10px] text-gray-400 mt-1">{parseFloat(form.sleep_hours).toFixed(2)} jam</div>}
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Kualitas (1–5)</div>
                  <div className="flex gap-1.5 mt-1">
                    {[1,2,3,4,5].map(v => (
                      <button key={v} onClick={() => setForm(f => ({ ...f, sleep_quality: String(v) }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${form.sleep_quality === String(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-0.5">
                    <span>Buruk</span><span>Sangat Baik</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Subjective */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-2">🎯 Kondisi Subjektif</div>
              <div className="space-y-3">
                {[
                  { key: 'muscle_soreness', label: 'DOMS / Nyeri Otot', left: 'Tidak Nyeri', right: 'Sangat Nyeri', max: 10 },
                  { key: 'motivation',      label: 'Energi / Motivasi', left: 'Sangat Rendah', right: 'Sangat Tinggi', max: 10 },
                  { key: 'mood',            label: 'Mood', left: 'Buruk', right: 'Sangat Baik', max: 5 },
                  { key: 'fatigue',         label: 'Kelelahan', left: 'Tidak Lelah', right: 'Sangat Lelah', max: 5 },
                  { key: 'stress',          label: 'Stres', left: 'Tenang', right: 'Sangat Stres', max: 5 },
                ].map(({ key, label, left, right, max }) => {
                  const val = form[key as keyof EwsForm] as string
                  const options = Array.from({ length: max }, (_, i) => i + 1)
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
                        {val && <div className="text-xs font-bold text-indigo-600">{val} / {max}</div>}
                      </div>
                      <div className="flex gap-1">
                        {options.map(v => (
                          <button key={v} onClick={() => setForm(f => ({ ...f, [key]: String(v) }))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${val === String(v) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:border-indigo-300'}`}>
                            {v}
                          </button>
                        ))}
                      </div>
                      <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-0.5">
                        <span>{left}</span><span>{right}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Kondisi khusus, cedera baru, keluhan..." rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
            </div>

            <div className="flex gap-2">
              {editingId && (
                <button onClick={() => { setForm(FORM_BLANK); setEditingId(null) }}
                  className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              )}
              <button onClick={saveEntry} disabled={saving}
                className="flex-1 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : editingId ? 'Perbarui Entri' : 'Simpan Entri'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: Status + Breakdown + History */}
        <div className="space-y-4">
          {/* EWS Status */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Status EWS</h2>
            {!result ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                <div className="text-4xl mb-3">📊</div>
                <div>Lengkapi semua metrik untuk melihat analisis EWS</div>
              </div>
            ) : (
              <>
                {/* Status card */}
                <div className="rounded-xl p-4 mb-4 flex items-start gap-3" style={{ background: status!.bg }}>
                  <span className="text-3xl">{status!.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-bold" style={{ color: status!.color }}>{status!.label}</span>
                      <span className="text-sm font-bold text-gray-600">(Skor: {result.totalScore.toFixed(1)})</span>
                    </div>
                    <div className="text-xs text-gray-600 leading-relaxed">{status!.rec}</div>
                  </div>
                </div>

                {/* Score breakdown */}
                <div className="space-y-2">
                  {[
                    { label: 'Physiological (RHR+HRV)', val: result.scorePhys,  weight: '35%', color: '#6366f1' },
                    { label: 'Sleep Quality',             val: result.scoreSleep, weight: '30%', color: '#8b5cf6' },
                    { label: 'DOMS / Nyeri Otot',         val: result.scoreDoms,  weight: '20%', color: '#f97316' },
                    { label: 'Energi / Motivasi',         val: result.scoreEnergy,weight: '15%', color: '#10b981' },
                  ].map(({ label, val, weight, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-500">{label} <span className="text-gray-300">({weight})</span></span>
                        <span className="font-bold text-gray-700">{val.toFixed(1)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(val, 100)}%`, background: color }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Zone reference */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="text-xs font-medium text-gray-500 uppercase mb-2">Referensi Zona</div>
                  <div className="space-y-1">
                    {STATUS_CONFIG.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span>{s.icon}</span>
                        <span className="font-medium" style={{ color: s.color }}>{s.label}</span>
                        <span className="text-gray-400 ml-auto">
                          {i === 0 ? '≤15' : i === STATUS_CONFIG.length - 1 ? '>60' : `≤${s.max}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* History */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4 flex items-center justify-between">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Riwayat</h2>
              <button onClick={() => setShowHistory(h => !h)}
                className="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-50">
                {showHistory ? '▲ Sembunyikan' : '▼ Tampilkan'}
              </button>
            </div>

            {/* Always show last 3 */}
            {entries.length === 0 ? (
              <div className="text-center py-6 text-gray-400 text-xs">Belum ada entri.</div>
            ) : (
              <div className="space-y-2">
                {(showHistory ? entries : entries.slice(0, 7)).map(e => {
                  const st = e.composite_score != null ? getStatus(e.composite_score) : null
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div className="flex-shrink-0 text-center w-14">
                        <div className="text-[10px] text-gray-400">{new Date(e.entry_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</div>
                      </div>
                      {st && (
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{st.icon}</span>
                            <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
                            <span className="text-xs text-gray-400 ml-auto">{e.composite_score?.toFixed(1)}</span>
                          </div>
                          <div className="flex gap-3 text-[10px] text-gray-400 mt-0.5">
                            {e.resting_hr && <span>RHR {e.resting_hr}</span>}
                            {e.hrv && <span>HRV {e.hrv}</span>}
                            {e.sleep_hours && <span>😴 {e.sleep_hours.toFixed(1)}j</span>}
                            {e.muscle_soreness != null && <span>DOMS {e.muscle_soreness}/10</span>}
                          </div>
                          {e.notes && <div className="text-[10px] text-gray-400 italic mt-0.5 truncate">{e.notes}</div>}
                        </div>
                      )}
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => editEntry(e)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                        <button onClick={() => deleteEntry(e.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                      </div>
                    </div>
                  )
                })}
                {!showHistory && entries.length > 7 && (
                  <button onClick={() => setShowHistory(true)} className="w-full text-xs text-indigo-500 hover:text-indigo-700 pt-2">
                    Tampilkan {entries.length - 7} entri lainnya ▼
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
