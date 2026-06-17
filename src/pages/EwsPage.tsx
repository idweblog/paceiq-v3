import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

interface EwsEntry {
  id: string
  entry_date: string
  mood: number | null
  fatigue: number | null
  stress: number | null
  sleep_quality: number | null
  muscle_soreness: number | null
  motivation: number | null
  resting_hr: number | null
  hrv: number | null
  composite_score: number | null
  notes: string | null
}

function calcComposite(form: Record<string, string>): number | null {
  const fields = ['mood', 'fatigue', 'stress', 'sleep_quality', 'muscle_soreness', 'motivation']
  const vals = fields.map(f => parseInt(form[f])).filter(v => !isNaN(v))
  if (vals.length === 0) return null
  return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
}

function scoreColor(score: number | null): string {
  if (!score) return 'text-gray-400'
  if (score >= 4) return 'text-green-600'
  if (score >= 3) return 'text-amber-500'
  return 'text-red-500'
}

function scoreBg(score: number | null): string {
  if (!score) return 'bg-gray-100'
  if (score >= 4) return 'bg-green-50 border-green-200'
  if (score >= 3) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

const METRIC_LABELS: Record<string, string> = {
  mood: 'Mood',
  fatigue: 'Kelelahan',
  stress: 'Stres',
  sleep_quality: 'Kualitas Tidur',
  muscle_soreness: 'Nyeri Otot',
  motivation: 'Motivasi',
}

const SCALE_LABELS: Record<string, { lo: string; hi: string }> = {
  mood:             { lo: 'Buruk', hi: 'Sangat Baik' },
  fatigue:          { lo: 'Segar', hi: 'Sangat Lelah' },
  stress:           { lo: 'Tenang', hi: 'Sangat Stres' },
  sleep_quality:    { lo: 'Buruk', hi: 'Sangat Baik' },
  muscle_soreness:  { lo: 'Tidak Nyeri', hi: 'Sangat Nyeri' },
  motivation:       { lo: 'Rendah', hi: 'Sangat Tinggi' },
}

const emptyForm = {
  entry_date: new Date().toISOString().split('T')[0],
  mood: '', fatigue: '', stress: '',
  sleep_quality: '', muscle_soreness: '', motivation: '',
  resting_hr: '', hrv: '', notes: '',
}

export default function EwsPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [entries, setEntries] = useState<EwsEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('ews_entries')
        .select('id, entry_date, mood, fatigue, stress, sleep_quality, muscle_soreness, motivation, resting_hr, hrv, composite_score, notes')
        .eq('athlete_id', athleteId!)
        .order('entry_date', { ascending: false })
        .limit(60)
      if (!cancelled) {
        if (err) console.error('[PaceIQ] ews_entries:', err.message)
        if (data) setEntries(data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  async function reloadEntries() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('ews_entries')
      .select('id, entry_date, mood, fatigue, stress, sleep_quality, muscle_soreness, motivation, resting_hr, hrv, composite_score, notes')
      .eq('athlete_id', athleteId!)
      .order('entry_date', { ascending: false })
      .limit(60)
    if (err) console.error('[PaceIQ] ews_entries:', err.message)
    if (data) setEntries(data)
  }

  async function handleSubmit() {
    if (!athleteId) return
    setError(null)
    const exists = entries.find(e => e.entry_date === form.entry_date)
    if (exists) { setError(`Entri untuk tanggal ${form.entry_date} sudah ada.`); return }
    const composite = calcComposite(form)
    setSaving(true)
    const { error: err } = await supabase.from('ews_entries').insert({
      athlete_id: athleteId,
      entry_date: form.entry_date,
      mood:             form.mood ? parseInt(form.mood) : null,
      fatigue:          form.fatigue ? parseInt(form.fatigue) : null,
      stress:           form.stress ? parseInt(form.stress) : null,
      sleep_quality:    form.sleep_quality ? parseInt(form.sleep_quality) : null,
      muscle_soreness:  form.muscle_soreness ? parseInt(form.muscle_soreness) : null,
      motivation:       form.motivation ? parseInt(form.motivation) : null,
      resting_hr:       form.resting_hr ? parseInt(form.resting_hr) : null,
      hrv:              form.hrv ? parseInt(form.hrv) : null,
      composite_score:  composite,
      notes:            form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(emptyForm)
    setShowForm(false)
    await reloadEntries()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus entri ini?')) return
    const { error: err } = await supabase.from('ews_entries').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete ews:', err.message); return }
    await reloadEntries()
  }

  const chartData = [...entries].slice(0, 30).reverse().map(e => ({
    date: new Date(e.entry_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    score: e.composite_score,
    rhr: e.resting_hr,
  }))

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="EWS Tracker" subtitle="Early Warning System — monitoring kelelahan harian" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="EWS Tracker"
        subtitle="Early Warning System — monitoring kelelahan harian"
        action={
          <button onClick={() => { setShowForm(v => !v); setError(null) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            {showForm ? 'Batal' : '+ Input Hari Ini'}
          </button>
        }
      />

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Input EWS Harian</h3>
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Tanggal</label>
            <input type="date" value={form.entry_date}
              onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {Object.keys(METRIC_LABELS).map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-500 mb-2">
                  {METRIC_LABELS[field]}
                  <span className="ml-2 text-gray-300">
                    ({SCALE_LABELS[field].lo} = 1 · {SCALE_LABELS[field].hi} = 5)
                  </span>
                </label>
                <div className="flex gap-2">
                  {[1,2,3,4,5].map(n => (
                    <button key={n}
                      onClick={() => setForm(p => ({ ...p, [field]: String(n) }))}
                      className={`w-10 h-10 rounded-lg text-sm font-bold border transition-colors ${
                        form[field as keyof typeof form] === String(n)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'
                      }`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Resting HR (bpm)</label>
              <input type="number" value={form.resting_hr} placeholder="48"
                onChange={e => setForm(p => ({ ...p, resting_hr: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">HRV (ms)</label>
              <input type="number" value={form.hrv} placeholder="65"
                onChange={e => setForm(p => ({ ...p, hrv: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-gray-500 mb-1">Catatan</label>
              <input type="text" value={form.notes} placeholder="Kondisi hari ini..."
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          {calcComposite(form) !== null && (
            <div className="mb-4 p-3 bg-indigo-50 rounded-lg text-sm">
              <span className="text-gray-500">Composite Score: </span>
              <span className={`font-bold text-lg ${scoreColor(calcComposite(form))}`}>{calcComposite(form)}</span>
              <span className="text-gray-400"> / 5</span>
            </div>
          )}
          <button onClick={handleSubmit} disabled={saving}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      )}

      {chartData.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Trend Composite Score (30 hari)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis domain={[1, 5]} ticks={[1,2,3,4,5]} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(val) => [val, 'Score']} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={3} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Warning', fontSize: 10, fill: '#f59e0b' }} />
              <Line type="monotone" dataKey="score" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState title="Belum ada entri EWS" description="Input kondisi harianmu untuk mulai monitoring kelelahan." />
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className={`bg-white rounded-xl border shadow-sm p-4 ${scoreBg(e.composite_score)}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-700">
                      {new Date(e.entry_date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {e.composite_score !== null && (
                      <span className={`text-base font-bold ${scoreColor(e.composite_score)}`}>{e.composite_score} / 5</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    {e.mood           !== null && <span>Mood: <b>{e.mood}</b></span>}
                    {e.fatigue        !== null && <span>Lelah: <b>{e.fatigue}</b></span>}
                    {e.stress         !== null && <span>Stres: <b>{e.stress}</b></span>}
                    {e.sleep_quality  !== null && <span>Tidur: <b>{e.sleep_quality}</b></span>}
                    {e.muscle_soreness !== null && <span>Nyeri: <b>{e.muscle_soreness}</b></span>}
                    {e.motivation     !== null && <span>Motivasi: <b>{e.motivation}</b></span>}
                    {e.resting_hr     !== null && <span>RHR: <b>{e.resting_hr} bpm</b></span>}
                    {e.hrv            !== null && <span>HRV: <b>{e.hrv} ms</b></span>}
                  </div>
                  {e.notes && <p className="text-xs text-gray-400 mt-1 italic">{e.notes}</p>}
                </div>
                <button onClick={() => handleDelete(e.id)}
                  className="text-xs text-red-400 hover:text-red-600 ml-4 shrink-0 transition-colors">
                  Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}