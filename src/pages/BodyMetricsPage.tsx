import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'

interface BodyMetric {
  id: string
  recorded_date: string
  weight_kg: number | null
  waist_cm: number | null
  resting_hr: number | null
  notes: string | null
}

interface HrHistory {
  id: string
  recorded_date: string
  hr_value: number
  hr_type: string | null
  notes: string | null
}

const HR_TYPE_LABELS: Record<string, string> = {
  resting: 'Resting HR',
  max:     'HR Max',
  lthr:    'LTHR',
}

const HR_TYPE_COLORS: Record<string, string> = {
  resting: '#4f46e5',
  max:     '#ef4444',
  lthr:    '#f59e0b',
}

const emptyBodyForm = {
  recorded_date: new Date().toISOString().split('T')[0],
  weight_kg: '',
  waist_cm: '',
  resting_hr: '',
  notes: '',
}

const emptyHrForm = {
  recorded_date: new Date().toISOString().split('T')[0],
  hr_value: '',
  hr_type: 'resting',
  notes: '',
}

export default function BodyMetricsPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [activeTab, setActiveTab] = useState<'body' | 'hr'>('body')
  const [bodyLogs, setBodyLogs] = useState<BodyMetric[]>([])
  const [hrLogs, setHrLogs] = useState<HrHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [showBodyForm, setShowBodyForm] = useState(false)
  const [showHrForm, setShowHrForm] = useState(false)
  const [bodyForm, setBodyForm] = useState(emptyBodyForm)
  const [hrForm, setHrForm] = useState(emptyHrForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false
    loadAll(cancelled)
    return () => { cancelled = true }
  }, [athleteId])

  async function loadAll(cancelled = false) {
    setLoading(true)
    await Promise.all([loadBodyMetrics(cancelled), loadHrHistory(cancelled)])
    if (!cancelled) setLoading(false)
  }

  async function loadBodyMetrics(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase
      .from('body_metrics')
      .select('id, recorded_date, weight_kg, waist_cm, resting_hr, notes')
      .eq('athlete_id', athleteId)
      .order('recorded_date', { ascending: false })
      .limit(60)
    if (!cancelled && data) setBodyLogs(data)
  }

  async function loadHrHistory(cancelled = false) {
    if (!athleteId) return
    const { data } = await supabase
      .from('hr_history')
      .select('id, recorded_date, hr_value, hr_type, notes')
      .eq('athlete_id', athleteId)
      .order('recorded_date', { ascending: false })
      .limit(60)
    if (!cancelled && data) setHrLogs(data)
  }

  async function saveBody() {
    if (!athleteId) return
    setError(null)
    setSaving(true)
    const { error: err } = await supabase.from('body_metrics').upsert({
      athlete_id: athleteId,
      recorded_date: bodyForm.recorded_date,
      weight_kg: bodyForm.weight_kg ? parseFloat(bodyForm.weight_kg) : null,
      waist_cm: bodyForm.waist_cm ? parseFloat(bodyForm.waist_cm) : null,
      resting_hr: bodyForm.resting_hr ? parseInt(bodyForm.resting_hr) : null,
      notes: bodyForm.notes || null,
    }, { onConflict: 'athlete_id,recorded_date' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setBodyForm(emptyBodyForm)
    setShowBodyForm(false)
    await loadBodyMetrics()
  }

  async function saveHr() {
    if (!athleteId || !hrForm.hr_value) { setError('HR value wajib diisi.'); return }
    setError(null)
    setSaving(true)
    const { error: err } = await supabase.from('hr_history').insert({
      athlete_id: athleteId,
      recorded_date: hrForm.recorded_date,
      hr_value: parseInt(hrForm.hr_value),
      hr_type: hrForm.hr_type,
      notes: hrForm.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setHrForm(emptyHrForm)
    setShowHrForm(false)
    await loadHrHistory()
  }

  async function deleteBody(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await supabase.from('body_metrics').delete().eq('id', id)
    await loadBodyMetrics()
  }

  async function deleteHr(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await supabase.from('hr_history').delete().eq('id', id)
    await loadHrHistory()
  }

  const bodyChartData = [...bodyLogs].reverse().map(b => ({
    date: new Date(b.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
    weight: b.weight_kg,
  }))

  const latestBody = bodyLogs[0]
  const latestRhr  = hrLogs.find(h => h.hr_type === 'resting')
  const latestMax  = hrLogs.find(h => h.hr_type === 'max')
  const latestLthr = hrLogs.find(h => h.hr_type === 'lthr')

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  const labelCls = "block text-xs text-gray-500 mb-1"

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Body Metrics" subtitle="Log berat badan dan HR history" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Body Metrics" subtitle="Log berat badan dan HR history" />

      <div className="flex gap-2 mb-6">
        {[
          { key: 'body', label: '⚖️ Body Metrics' },
          { key: 'hr',   label: '❤️ HR History' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      {/* ── Body Metrics Tab ── */}
      {activeTab === 'body' && (
        <>
          {latestBody && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-white rounded-xl shadow-sm p-4 text-center">
                <p className="text-2xl font-bold text-indigo-600">{latestBody.weight_kg ?? '—'}</p>
                <p className="text-xs text-gray-400">kg (terakhir)</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center">
                <p className="text-2xl font-bold text-amber-500">{latestBody.waist_cm ?? '—'}</p>
                <p className="text-xs text-gray-400">cm pinggang</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{latestBody.resting_hr ?? '—'}</p>
                <p className="text-xs text-gray-400">bpm RHR</p>
              </div>
            </div>
          )}

          {bodyChartData.length > 1 && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Trend Berat Badan</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={bodyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="weight" name="Berat (kg)" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mb-4">
            <button onClick={() => { setShowBodyForm(v => !v); setError(null) }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              {showBodyForm ? 'Batal' : '+ Input Body Metrics'}
            </button>
          </div>

          {showBodyForm && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className={labelCls}>Tanggal</label>
                  <input type="date" value={bodyForm.recorded_date} className={inputCls}
                    onChange={e => setBodyForm(p => ({ ...p, recorded_date: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Berat (kg)</label>
                  <input type="number" step="0.1" value={bodyForm.weight_kg} placeholder="58.5" className={inputCls}
                    onChange={e => setBodyForm(p => ({ ...p, weight_kg: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Pinggang (cm)</label>
                  <input type="number" step="0.5" value={bodyForm.waist_cm} placeholder="72" className={inputCls}
                    onChange={e => setBodyForm(p => ({ ...p, waist_cm: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Resting HR (bpm)</label>
                  <input type="number" value={bodyForm.resting_hr} placeholder="48" className={inputCls}
                    onChange={e => setBodyForm(p => ({ ...p, resting_hr: e.target.value }))} />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label className={labelCls}>Catatan</label>
                  <input type="text" value={bodyForm.notes} className={inputCls}
                    onChange={e => setBodyForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={saveBody} disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button onClick={() => setShowBodyForm(false)}
                  className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                  Batal
                </button>
              </div>
            </div>
          )}

          {bodyLogs.length === 0 ? (
            <EmptyState title="Belum ada data body metrics" description="Mulai tracking berat badan dan RHR harianmu." />
          ) : (
            <div className="space-y-2">
              {bodyLogs.map(b => (
                <div key={b.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-xs text-gray-400">
                        {new Date(b.recorded_date).toLocaleDateString('id-ID', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                        })}
                      </span>
                      {b.weight_kg && <span className="text-sm font-semibold text-indigo-600">⚖️ {b.weight_kg} kg</span>}
                      {b.waist_cm && <span className="text-sm text-gray-600">📏 {b.waist_cm} cm</span>}
                      {b.resting_hr && <span className="text-sm text-gray-600">❤️ {b.resting_hr} bpm</span>}
                      {b.notes && <span className="text-xs text-gray-400 italic">{b.notes}</span>}
                    </div>
                    <button onClick={() => deleteBody(b.id)}
                      className="text-xs text-red-400 hover:text-red-600 ml-4 transition-colors">
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HR History Tab ── */}
      {activeTab === 'hr' && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white rounded-xl shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{latestRhr?.hr_value ?? '—'}</p>
              <p className="text-xs text-gray-400">Resting HR (bpm)</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-red-500">{latestMax?.hr_value ?? '—'}</p>
              <p className="text-xs text-gray-400">HR Max (bpm)</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-4 text-center">
              <p className="text-2xl font-bold text-amber-500">{latestLthr?.hr_value ?? '—'}</p>
              <p className="text-xs text-gray-400">LTHR (bpm)</p>
            </div>
          </div>

          {hrLogs.filter(h => h.hr_type === 'resting').length > 1 && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Trend Resting HR</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={[...hrLogs].filter(h => h.hr_type === 'resting').reverse().map(h => ({
                  date: new Date(h.recorded_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
                  resting: h.hr_value,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="resting" name="Resting HR" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mb-4">
            <button onClick={() => { setShowHrForm(v => !v); setError(null) }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              {showHrForm ? 'Batal' : '+ Input HR'}
            </button>
          </div>

          {showHrForm && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className={labelCls}>Tanggal</label>
                  <input type="date" value={hrForm.recorded_date} className={inputCls}
                    onChange={e => setHrForm(p => ({ ...p, recorded_date: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Tipe HR</label>
                  <select value={hrForm.hr_type} className={inputCls}
                    onChange={e => setHrForm(p => ({ ...p, hr_type: e.target.value }))}>
                    <option value="resting">Resting HR</option>
                    <option value="max">HR Max</option>
                    <option value="lthr">LTHR</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Nilai (bpm) *</label>
                  <input type="number" value={hrForm.hr_value} placeholder="48" className={inputCls}
                    onChange={e => setHrForm(p => ({ ...p, hr_value: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Catatan</label>
                  <input type="text" value={hrForm.notes} className={inputCls}
                    onChange={e => setHrForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={saveHr} disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button onClick={() => setShowHrForm(false)}
                  className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                  Batal
                </button>
              </div>
            </div>
          )}

          {hrLogs.length === 0 ? (
            <EmptyState title="Belum ada HR history" description="Log HR untuk tracking tren kebugaran kardiovaskular." />
          ) : (
            <div className="space-y-2">
              {hrLogs.map(h => {
                const hrType = h.hr_type ?? 'resting'
                const color = HR_TYPE_COLORS[hrType] ?? '#6b7280'
                return (
                  <div key={h.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-xs text-gray-400">
                          {new Date(h.recorded_date).toLocaleDateString('id-ID', {
                            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                          })}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ color, backgroundColor: color + '20' }}>
                          {HR_TYPE_LABELS[hrType] ?? hrType}
                        </span>
                        <span className="text-sm font-bold" style={{ color }}>
                          {h.hr_value} bpm
                        </span>
                        {h.notes && <span className="text-xs text-gray-400 italic">{h.notes}</span>}
                      </div>
                      <button onClick={() => deleteHr(h.id)}
                        className="text-xs text-red-400 hover:text-red-600 ml-4 transition-colors">
                        Hapus
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}