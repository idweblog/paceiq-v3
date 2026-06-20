import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'

interface Race {
  id: string
  slug: string
  name: string
  event_date: string | null
  distance_km: number | null
  event_type: string | null
  status: string
  target_finish: string | null
  target_pace: string | null
  actual_finish: string | null
  city: string | null
  notes: string | null
}

const RM_STATUS: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  A:       { label: 'Goal Race',  color: '#4f46e5', bg: '#ede9fe', border: '#c7d2fe', icon: '🏆' },
  B:       { label: 'Tune-up',   color: '#0369a1', bg: '#e0f2fe', border: '#bae6fd', icon: '🏁' },
  planned: { label: 'Planned',   color: '#92400e', bg: '#fef3c7', border: '#fde68a', icon: '📅' },
  done:    { label: 'Done',      color: '#166534', bg: '#dcfce7', border: '#bbf7d0', icon: '✅' },
}

const EVENT_KM: Record<string, number> = {
  '5K': 5, '10K': 10, 'HM': 21.0975, 'Marathon': 42.195, 'Ultra': 50, 'Custom': 0
}

const EVENT_TYPES = ['5K', '10K', 'HM', 'Marathon', 'Ultra', 'Custom']

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base}-${Date.now().toString().slice(-5)}`
}

function calcPace(targetFinish: string, distanceKm: number): string {
  const parts = targetFinish.split(':').map(Number)
  if (parts.some(isNaN)) return ''
  let totalSec = 0
  if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
  else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1]
  if (!totalSec || !distanceKm) return ''
  const secPerKm = totalSec / distanceKm
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function daysUntil(dateStr: string): { days: number; label: string; color: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0)
  const days = Math.ceil((target.getTime() - today.getTime()) / 86400000)
  const label = days > 0 ? `${days} hari lagi` : days === 0 ? 'Hari ini!' : `${Math.abs(days)} hari lalu`
  const color = days <= 14 ? '#ef4444' : days <= 30 ? '#f59e0b' : '#22c55e'
  return { days, label, color }
}

const emptyForm = {
  name: '', event_date: '', city: '', target_finish: '', target_pace: '',
  event_type: 'HM', distance_km: '', status: 'planned', actual_finish: '', notes: '',
}

export default function RacesPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id
  const cancelledRef = useRef(false)

  const [races, setRaces] = useState<Race[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('races')
        .select('id,slug,name,event_date,distance_km,event_type,status,target_finish,target_pace,actual_finish,city,notes')
        .eq('athlete_id', athleteId as string)
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
    const { data } = await supabase
      .from('races')
      .select('id,slug,name,event_date,distance_km,event_type,status,target_finish,target_pace,actual_finish,city,notes')
      .eq('athlete_id', athleteId as string)
      .order('event_date', { ascending: true })
    if (data) setRaces(data)
  }

  function getDistanceKm(eventType: string, customKm: string): number {
    if (eventType === 'Custom') return parseFloat(customKm) || 0
    return EVENT_KM[eventType] ?? 0
  }

  function onEventTypeChange(val: string) {
    const km = EVENT_KM[val] ?? 0
    setForm(p => {
      const distKm = val === 'Custom' ? parseFloat(p.distance_km) || 0 : km
      const pace = p.target_finish && distKm ? calcPace(p.target_finish, distKm) : ''
      return { ...p, event_type: val, distance_km: val === 'Custom' ? p.distance_km : km.toString(), target_pace: pace }
    })
  }

  function onTargetFinishChange(val: string) {
    const distKm = getDistanceKm(form.event_type, form.distance_km)
    const pace = val && distKm ? calcPace(val, distKm) : ''
    setForm(p => ({ ...p, target_finish: val, target_pace: pace }))
  }

  function onDistanceKmChange(val: string) {
    const distKm = parseFloat(val) || 0
    const pace = form.target_finish && distKm ? calcPace(form.target_finish, distKm) : ''
    setForm(p => ({ ...p, distance_km: val, target_pace: pace }))
  }

  function openAdd() {
    setForm(emptyForm)
    setEditingId(null)
    setError(null)
    setShowModal(true)
  }

  function openEdit(race: Race) {
    const eventType = (() => {
      if (!race.distance_km) return 'HM'
      const match = Object.entries(EVENT_KM).find(([, km]) => km > 0 && Math.abs(km - race.distance_km!) < 0.05)
      return match ? match[0] : 'Custom'
    })()
    setForm({
      name: race.name,
      event_date: race.event_date ?? '',
      city: race.city ?? '',
      target_finish: race.target_finish ?? '',
      target_pace: race.target_pace ?? '',
      event_type: eventType,
      distance_km: race.distance_km?.toString() ?? '',
      status: race.status,
      actual_finish: race.actual_finish ?? '',
      notes: race.notes ?? '',
    })
    setEditingId(race.id)
    setError(null)
    setShowModal(true)
  }

  async function handleSubmit() {
    if (!athleteId) return
    if (!form.name.trim()) { setError('Nama race wajib diisi.'); return }
    if (!form.event_date) { setError('Tanggal race wajib diisi.'); return }
    setError(null)
    setSaving(true)

    const distKm = getDistanceKm(form.event_type, form.distance_km)
    const basePayload = {
      athlete_id: athleteId,
      name: form.name.trim(),
      event_date: form.event_date || null,
      city: form.city || null,
      distance_km: distKm || null,
      event_type: form.event_type || null,
      status: form.status,
      target_finish: form.target_finish || null,
      target_pace: form.target_pace || null,
      actual_finish: form.status === 'done' ? (form.actual_finish || null) : null,
      notes: form.notes || null,
      updated_at: new Date().toISOString(),
    }


    // Jika set ke A, downgrade A lain ke B
    if (form.status === 'A' && !editingId) {
      const currentA = races.find(r => r.status === 'A')
      if (currentA) {
        await supabase.from('races').update({ status: 'B' }).eq('id', currentA.id)
      }
    }
    if (form.status === 'A' && editingId) {
      const currentA = races.find(r => r.status === 'A' && r.id !== editingId)
      if (currentA) {
        await supabase.from('races').update({ status: 'B' }).eq('id', currentA.id)
      }
    }

    let err
    if (editingId) {
      ;({ error: err } = await supabase.from('races').update(basePayload).eq('id', editingId))
    } else {
      ;({ error: err } = await supabase.from('races').insert({ ...basePayload, slug: slugify(form.name) }))
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    await loadRaces()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus race ini?')) return
    await supabase.from('races').delete().eq('id', id)
    await loadRaces()
  }

  const goalRace = races.find(r => r.status === 'A') ?? null
  const tuneups = races.filter(r => r.status === 'B').sort((a, b) => (a.event_date ?? '') < (b.event_date ?? '') ? -1 : 1)
  const planned = races.filter(r => r.status === 'planned').sort((a, b) => (a.event_date ?? '') < (b.event_date ?? '') ? -1 : 1)
  const done = races.filter(r => r.status === 'done')

  function RaceRowActive({ race, isTuneup }: { race: Race; isTuneup: boolean }) {
    const st = RM_STATUS[race.status] ?? RM_STATUS['planned']
    const d = race.event_date ? daysUntil(race.event_date) : null
    return (
      <div className={`flex items-center gap-3 flex-wrap ${isTuneup ? 'pl-10 py-3 bg-indigo-50/40' : 'p-4'}`}
        style={isTuneup ? { borderTop: '1px solid #e0e7ff' } : {}}>
        {isTuneup && <span className="text-xs text-gray-400 min-w-[56px]">↳ Tune-up</span>}
        <div className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0 text-lg"
          style={{ background: st.bg }}>{st.icon}</div>
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`font-bold text-gray-900 ${isTuneup ? 'text-sm' : 'text-base'}`}>{race.name}</span>
            {race.distance_km && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: st.bg, color: st.color }}>{race.distance_km} km</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {race.event_date && (
              <span>📅 {new Date(race.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            )}
            {d && <span className="font-bold" style={{ color: d.color }}>{d.label}</span>}
            {race.city && <span>📍 {race.city}</span>}
            {race.target_finish && <span>🎯 <strong>{race.target_finish}</strong></span>}
            {race.target_pace && (
              <span className="px-2 py-0.5 rounded-full font-bold"
                style={{ background: st.bg, color: st.color }}>⚡ {race.target_pace}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => openEdit(race)}
            className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-indigo-600 hover:border-indigo-300 text-xs transition-colors flex items-center justify-center">✏️</button>
          <button onClick={() => handleDelete(race.id)}
            className="w-8 h-8 rounded-lg border border-red-100 bg-red-50 text-red-400 hover:text-red-600 text-xs transition-colors flex items-center justify-center">🗑️</button>
        </div>
      </div>
    )
  }

  function RaceCard({ race }: { race: Race }) {
    const st = RM_STATUS[race.status] ?? RM_STATUS['planned']
    const d = race.event_date ? daysUntil(race.event_date) : null
    return (
      <div className="bg-white rounded-xl p-4 flex items-center gap-3 flex-wrap"
        style={{ border: `1.5px solid ${st.border}` }}>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 text-base"
          style={{ background: st.bg }}>{st.icon}</div>
        <div className="flex-1 min-w-[160px]">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-bold text-gray-900 text-sm">{race.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: st.bg, color: st.color }}>{st.label}</span>
            {race.distance_km && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-gray-200 text-gray-500">{race.distance_km} km</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            {race.event_date && (
              <span>📅 {new Date(race.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                {d && race.status !== 'done' && <span className="ml-1 font-bold" style={{ color: d.color }}> · {d.label}</span>}
              </span>
            )}
            {race.city && <span>📍 {race.city}</span>}
            {race.target_finish && <span>🎯 {race.target_finish}</span>}
            {race.target_pace && <span style={{ color: st.color, fontWeight: 600 }}>⚡ {race.target_pace}</span>}
            {race.actual_finish && <span className="text-green-600 font-semibold">✅ Hasil: {race.actual_finish}</span>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => openEdit(race)}
            className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-indigo-600 text-xs transition-colors flex items-center justify-center">✏️</button>
          <button onClick={() => handleDelete(race.id)}
            className="w-8 h-8 rounded-lg border border-red-100 bg-red-50 text-red-400 hover:text-red-600 text-xs transition-colors flex items-center justify-center">🗑️</button>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="p-6 max-w-6xl">
      <PageHeader title="Race Management" subtitle="Kelola race registry, program aktif, dan tune-up races" />
      <p className="text-gray-400 text-sm">Memuat data...</p>
    </div>
  )

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <PageHeader
        title="Race Management"
        subtitle="Kelola race registry, program aktif, dan tune-up races"
        action={
          <button onClick={openAdd}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors">
            + Tambah Race
          </button>
        }
      />

      {/* PROGRAM AKTIF */}
      <section>
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest pb-2 border-b border-indigo-100 mb-3">
          🏃 Program Aktif
        </div>
        <p className="text-xs text-indigo-500 mb-3">Goal race dan tune-up races yang sedang berjalan</p>
        {!goalRace && tuneups.length === 0 ? (
          <div className="bg-white rounded-xl p-7 text-center border-2 border-dashed border-gray-200">
            <div className="text-3xl mb-2">🏁</div>
            <p className="text-sm text-gray-500">Belum ada race dalam program aktif.</p>
            <p className="text-xs text-gray-400 mt-1">Tambah race dan set role-nya sebagai <strong>Goal Race</strong>.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden border border-indigo-200 shadow-sm">
            {goalRace && <RaceRowActive race={goalRace} isTuneup={false} />}
            {tuneups.map(r => <RaceRowActive key={r.id} race={r} isTuneup={true} />)}
          </div>
        )}
      </section>

      {/* RACE TERDAFTAR */}
      <section>
        <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest pb-2 border-b border-indigo-100 mb-3">
          📋 Race Terdaftar
        </div>
        <p className="text-xs text-gray-400 mb-3">Race yang sudah didaftar, program belum dibuat</p>
        {planned.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center border-2 border-dashed border-gray-200">
            <p className="text-sm text-gray-400">Belum ada race yang didaftarkan.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {planned.map(r => <RaceCard key={r.id} race={r} />)}
          </div>
        )}
      </section>

      {/* RACE SELESAI */}
      {done.length > 0 && (
        <section>
          <div className="text-sm font-bold text-indigo-700 uppercase tracking-widest pb-2 border-b border-indigo-100 mb-3">
            ✅ Race Selesai
          </div>
          <div className="space-y-2">
            {done.map(r => <RaceCard key={r.id} race={r} />)}
          </div>
        </section>
      )}

      {/* MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-bold text-gray-900">
                  🏁 {editingId ? 'Edit Race' : 'Tambah Race Baru'}
                </h3>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
              </div>

              {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}

              {/* Nama Race */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-2">Nama Race *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="cth: Maybank Marathon Bali"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>

              {/* Jenis Event */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-2">Jenis Event *</label>
                <select value={form.event_type} onChange={e => onEventTypeChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Pilih jenis —</option>
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {form.event_type === 'Custom' && (
                  <input type="number" step="0.1" value={form.distance_km}
                    onChange={e => onDistanceKmChange(e.target.value)}
                    placeholder="Jarak (km)"
                    className="w-full mt-2 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                )}
              </div>

              {/* Tanggal & Kota */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-2">Tanggal Race *</label>
                  <input type="date" value={form.event_date} onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Kota</label>
                  <input type="text" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                    placeholder="cth: Denpasar"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>

              {/* Target Finish & Pace */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Target Finish</label>
                  <input type="text" value={form.target_finish} onChange={e => onTargetFinishChange(e.target.value)}
                    placeholder="cth: 2:15:00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Target Pace</label>
                  <input type="text" value={form.target_pace} readOnly placeholder="— otomatis —"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-indigo-600 font-semibold" />
                </div>
              </div>

              {/* Role dalam Program */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-2">Role dalam Program</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'planned', label: 'Planned',  sub: 'Belum ada program' },
                    { value: 'A',       label: 'Goal Race', sub: 'Race utama program' },
                    { value: 'B',       label: 'Tune-up',  sub: 'Race sela dalam program' },
                    { value: 'done',    label: 'Done',     sub: 'Race sudah selesai' },
                  ].map(opt => {
                    const st = RM_STATUS[opt.value]
                    const selected = form.status === opt.value
                    return (
                      <button key={opt.value} onClick={() => setForm(p => ({ ...p, status: opt.value }))}
                        className="text-left p-3 rounded-xl border-2 transition-all"
                        style={{
                          borderColor: selected ? st.border : '#e5e7eb',
                          background: selected ? st.bg : 'white',
                        }}>
                        <div className="text-sm font-bold" style={{ color: selected ? st.color : '#374151' }}>
                          {st.icon} {opt.label}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: selected ? st.color : '#9ca3af' }}>{opt.sub}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Actual Finish — hanya saat done */}
              {form.status === 'done' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">Hasil Aktual</label>
                  <input type="text" value={form.actual_finish} onChange={e => setForm(p => ({ ...p, actual_finish: e.target.value }))}
                    placeholder="cth: 2:18:45"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleSubmit} disabled={saving}
                  className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  💾 {saving ? 'Menyimpan...' : 'Simpan Race'}
                </button>
                <button onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200">
                  Batal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
