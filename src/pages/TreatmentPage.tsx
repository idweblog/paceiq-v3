import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface TreatmentLog {
  id: string
  log_date: string
  treatment_type: string | null
  duration_min: number | null
  body_part: string | null
  notes: string | null
}

const TREATMENT_TYPES = [
  { value: 'ice',         label: '🧊 Ice / Cold Therapy' },
  { value: 'compression', label: '🩹 Compression' },
  { value: 'massage',     label: '💆 Massage / Foam Roll' },
  { value: 'stretch',     label: '🧘 Stretching' },
  { value: 'rest',        label: '😴 Rest / Active Recovery' },
  { value: 'physio',      label: '🏥 Fisioterapi' },
  { value: 'other',       label: '➕ Lainnya' },
]

const BODY_PARTS = [
  'Betis kiri', 'Betis kanan', 'Hamstring kiri', 'Hamstring kanan',
  'Quadriceps kiri', 'Quadriceps kanan', 'IT Band kiri', 'IT Band kanan',
  'Lutut kiri', 'Lutut kanan', 'Plantar fascia kiri', 'Plantar fascia kanan',
  'Achilles kiri', 'Achilles kanan', 'Pinggul kiri', 'Pinggul kanan',
  'Punggung bawah', 'Bahu', 'Seluruh tubuh',
]

const TYPE_STYLE: Record<string, string> = {
  ice:         'bg-blue-50 text-blue-700 border-blue-200',
  compression: 'bg-purple-50 text-purple-700 border-purple-200',
  massage:     'bg-amber-50 text-amber-700 border-amber-200',
  stretch:     'bg-green-50 text-green-700 border-green-200',
  rest:        'bg-gray-50 text-gray-500 border-gray-200',
  physio:      'bg-red-50 text-red-700 border-red-200',
  other:       'bg-indigo-50 text-indigo-700 border-indigo-200',
}

function typeLabel(val: string | null): string {
  return TREATMENT_TYPES.find(t => t.value === val)?.label ?? val ?? '—'
}

const emptyForm = {
  log_date: new Date().toISOString().split('T')[0],
  treatment_type: 'massage',
  duration_min: '',
  body_part: '',
  notes: '',
}

export default function TreatmentPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [logs, setLogs] = useState<TreatmentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string>('all')

  useEffect(() => {
    if (!athleteId) return
    loadLogs()
  }, [athleteId])

  async function loadLogs() {
    if (!athleteId) return
    setLoading(true)
    const { data } = await supabase
      .from('treatment_log')
      .select('id, log_date, treatment_type, duration_min, body_part, notes')
      .eq('athlete_id', athleteId)
      .order('log_date', { ascending: false })
      .limit(50)
    if (data) setLogs(data)
    setLoading(false)
  }

  async function handleSubmit() {
    if (!athleteId) return
    setError(null)
    setSaving(true)
    const { error: err } = await supabase.from('treatment_log').insert({
      athlete_id: athleteId,
      log_date: form.log_date,
      treatment_type: form.treatment_type || null,
      duration_min: form.duration_min ? parseInt(form.duration_min) : null,
      body_part: form.body_part || null,
      notes: form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(emptyForm)
    setShowForm(false)
    await loadLogs()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus entri ini?')) return
    await supabase.from('treatment_log').delete().eq('id', id)
    await loadLogs()
  }

  const filteredLogs = filterType === 'all'
    ? logs
    : logs.filter(l => l.treatment_type === filterType)

  // Summary stats
  const totalSessions = logs.length
  const totalMinutes = logs.reduce((sum, l) => sum + (l.duration_min ?? 0), 0)
  const typeCount = TREATMENT_TYPES.reduce((acc, t) => {
    acc[t.value] = logs.filter(l => l.treatment_type === t.value).length
    return acc
  }, {} as Record<string, number>)

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  const labelCls = "block text-xs text-gray-500 mb-1"

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Treatment Protocol" subtitle="Log recovery dan treatment" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Treatment Protocol"
        subtitle="Log recovery dan treatment"
        action={
          <button onClick={() => { setShowForm(v => !v); setError(null) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            {showForm ? 'Batal' : '+ Tambah Treatment'}
          </button>
        }
      />

      {/* Summary */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-indigo-600">{totalSessions}</p>
            <p className="text-xs text-gray-400">Total Sesi</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-3 text-center">
            <p className="text-2xl font-bold text-green-600">{totalMinutes}</p>
            <p className="text-xs text-gray-400">Total Menit</p>
          </div>
          {Object.entries(typeCount)
            .filter(([, count]) => count > 0)
            .slice(0, 2)
            .map(([type, count]) => (
              <div key={type} className="bg-white rounded-xl shadow-sm p-3 text-center">
                <p className="text-2xl font-bold text-gray-700">{count}x</p>
                <p className="text-xs text-gray-400">{TREATMENT_TYPES.find(t => t.value === type)?.label.split(' ').slice(1).join(' ')}</p>
              </div>
            ))}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Treatment Baru</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className={labelCls}>Tanggal</label>
              <input type="date" value={form.log_date} className={inputCls}
                onChange={e => setForm(p => ({ ...p, log_date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Tipe Treatment</label>
              <select value={form.treatment_type} className={inputCls}
                onChange={e => setForm(p => ({ ...p, treatment_type: e.target.value }))}>
                {TREATMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Durasi (menit)</label>
              <input type="number" value={form.duration_min} placeholder="20" className={inputCls}
                onChange={e => setForm(p => ({ ...p, duration_min: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Bagian Tubuh</label>
              <select value={form.body_part} className={inputCls}
                onChange={e => setForm(p => ({ ...p, body_part: e.target.value }))}>
                <option value="">— Pilih —</option>
                {BODY_PARTS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Catatan</label>
              <input type="text" value={form.notes} className={inputCls}
                placeholder="Intensitas, sensasi, efek setelah treatment..."
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={handleSubmit} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap mb-4">
        <button onClick={() => setFilterType('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filterType === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'
          }`}>
          Semua
        </button>
        {TREATMENT_TYPES.filter(t => typeCount[t.value] > 0).map(t => (
          <button key={t.value} onClick={() => setFilterType(t.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterType === t.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'
            }`}>
            {t.label} ({typeCount[t.value]})
          </button>
        ))}
      </div>

      {/* Log list */}
      {filteredLogs.length === 0 ? (
        <EmptyState title="Belum ada treatment tercatat" description="Log treatment untuk tracking recovery." />
      ) : (
        <div className="space-y-2">
          {filteredLogs.map(log => (
            <div key={log.id} className={`bg-white rounded-xl border shadow-sm p-4 ${TYPE_STYLE[log.treatment_type ?? ''] ?? 'border-gray-100'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs text-gray-400">
                      {new Date(log.log_date).toLocaleDateString('id-ID', {
                        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </span>
                    <span className="text-sm font-semibold">{typeLabel(log.treatment_type)}</span>
                    {log.duration_min && (
                      <span className="text-xs opacity-70">⏱ {log.duration_min} menit</span>
                    )}
                  </div>
                  {log.body_part && (
                    <p className="text-xs opacity-80 mb-0.5">📍 {log.body_part}</p>
                  )}
                  {log.notes && (
                    <p className="text-xs opacity-70 italic">{log.notes}</p>
                  )}
                </div>
                <button onClick={() => handleDelete(log.id)}
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