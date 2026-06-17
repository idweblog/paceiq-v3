import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface Race {
  id: string
  slug: string
  name: string
  event_date: string | null
  distance_km: number | null
  event_type: string | null
  status: string
  target_finish: string | null
  actual_finish: string | null
}

const EVENT_TYPES = ['5K', '10K', 'HM', 'Marathon', 'Ultra', 'Custom']
const STATUS_OPTIONS = [
  { value: 'A', label: 'Goal Race (A)' },
  { value: 'B', label: 'Tune-up (B)' },
  { value: 'planned', label: 'Planned' },
  { value: 'done', label: 'Done' },
]

const STATUS_STYLE: Record<string, string> = {
  A: 'bg-indigo-50 text-indigo-700',
  B: 'bg-amber-50 text-amber-700',
  planned: 'bg-gray-100 text-gray-600',
  done: 'bg-green-50 text-green-700',
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const suffix = Date.now().toString().slice(-5)
  return `${base}-${suffix}`
}

const emptyForm = {
  name: '',
  event_date: '',
  distance_km: '',
  event_type: 'HM',
  status: 'planned',
  target_finish: '',
  actual_finish: '',
}

export default function RacesPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [races, setRaces] = useState<Race[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      if (!athleteId) return
      setLoading(true)
      const { data, error: err } = await supabase
        .from('races')
        .select('id, slug, name, event_date, distance_km, event_type, status, target_finish, actual_finish')
        .eq('athlete_id', athleteId!)
        .order('event_date', { ascending: true })
      if (err) console.error('[PaceIQ] races:', err.message)
      if (!cancelled && data) setRaces(data)
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  async function loadRaces() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('races')
      .select('id, slug, name, event_date, distance_km, event_type, status, target_finish, actual_finish')
      .eq('athlete_id', athleteId!)
      .order('event_date', { ascending: true })
    if (err) console.error('[PaceIQ] races:', err.message)
    if (data) setRaces(data)
  }

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setError(null)
    setShowModal(true)
  }

  function openEdit(race: Race) {
    setForm({
      name: race.name,
      event_date: race.event_date ?? '',
      distance_km: race.distance_km?.toString() ?? '',
      event_type: race.event_type ?? 'HM',
      status: race.status,
      target_finish: race.target_finish ?? '',
      actual_finish: race.actual_finish ?? '',
    })
    setEditingId(race.id)
    setError(null)
    setShowModal(true)
  }

  function handleChange(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    if (!athleteId) return
    if (!form.name.trim()) { setError('Nama race wajib diisi.'); return }
    setError(null)
    setSaving(true)

    const payload = {
      athlete_id: athleteId,
      slug: slugify(form.name),
      name: form.name.trim(),
      event_date: form.event_date || null,
      distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
      event_type: form.event_type || null,
      status: form.status,
      target_finish: form.target_finish || null,
      actual_finish: form.actual_finish || null,
    }

    let err
    if (editingId) {
      ;({ error: err } = await supabase.from('races').update(payload).eq('id', editingId))
    } else {
      ;({ error: err } = await supabase.from('races').insert(payload))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    await loadRaces()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus race ini?')) return
    const { error: err } = await supabase.from('races').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete race:', err.message); return }
    await loadRaces()
  }

  function daysUntil(dateStr: string): number {
    const today = new Date(); today.setHours(0,0,0,0)
    const target = new Date(dateStr); target.setHours(0,0,0,0)
    return Math.ceil((target.getTime() - today.getTime()) / 86400000)
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Race Management" subtitle="Daftar dan kelola event race" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Race Management"
        subtitle="Daftar dan kelola event race"
        action={
          <button onClick={openAdd}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            + Tambah Race
          </button>
        }
      />

      {races.length === 0 ? (
        <EmptyState title="Belum ada race terdaftar" description="Tambahkan race pertamamu untuk mulai tracking." />
      ) : (
        <div className="space-y-3">
          {races.map(race => {
            const days = race.event_date ? daysUntil(race.event_date) : null
            return (
              <div key={race.id} className="bg-white rounded-xl shadow-sm p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[race.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_OPTIONS.find(s => s.value === race.status)?.label ?? race.status}
                      </span>
                      {race.event_type && (
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">{race.event_type}</span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-gray-900">{race.name}</h3>
                    <div className="flex flex-wrap gap-4 mt-1 text-sm text-gray-500">
                      {race.event_date && (
                        <span>
                          📅 {new Date(race.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                          {days !== null && race.status !== 'done' && (
                            <span className="ml-1 text-xs text-gray-400">
                              ({days > 0 ? `${days} hari lagi` : 'sudah lewat'})
                            </span>
                          )}
                        </span>
                      )}
                      {race.distance_km && <span>📍 {race.distance_km} km</span>}
                      {race.target_finish && <span>🎯 Target: {race.target_finish}</span>}
                      {race.actual_finish && <span>✅ Hasil: {race.actual_finish}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4 shrink-0">
                    <button onClick={() => openEdit(race)} className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors">Edit</button>
                    <button onClick={() => handleDelete(race.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Hapus</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4">
              {editingId ? 'Edit Race' : 'Tambah Race Baru'}
            </h3>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Nama Race *</label>
                <input type="text" value={form.name} onChange={e => handleChange('name', e.target.value)}
                  placeholder="Pocari Sweat Run Bandung 2026"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tanggal</label>
                <input type="date" value={form.event_date} onChange={e => handleChange('event_date', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Status</label>
                <select value={form.status} onChange={e => handleChange('status', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipe Event</label>
                <select value={form.event_type} onChange={e => handleChange('event_type', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jarak (km)</label>
                <input type="number" step="0.1" value={form.distance_km} onChange={e => handleChange('distance_km', e.target.value)}
                  placeholder="21.1"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target Finish</label>
                <input type="text" value={form.target_finish} onChange={e => handleChange('target_finish', e.target.value)}
                  placeholder="2:15:00"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hasil Aktual</label>
                <input type="text" value={form.actual_finish} onChange={e => handleChange('actual_finish', e.target.value)}
                  placeholder="2:18:45"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={handleSubmit} disabled={saving}
                className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button onClick={() => setShowModal(false)}
                className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}