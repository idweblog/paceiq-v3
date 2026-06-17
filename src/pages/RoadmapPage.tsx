import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface Program {
  id: string
  name: string
  phase: string | null
  date_start: string | null
  date_end: string | null
  status: string | null
  notes: string | null
  race_id: string | null
}

interface ProgramWeek {
  id: string
  program_id: string
  week_number: number
  phase: string | null
  date_start: string | null
  date_end: string | null
  target_distance_km: number | null
  actual_distance_km: number | null
  focus: string | null
  notes: string | null
}

interface Race {
  id: string
  name: string
  event_date: string | null
  status: string | null
}

const PHASE_COLORS: Record<string, string> = {
  'Base':    'bg-blue-100 text-blue-700 border-blue-200',
  'Build':   'bg-yellow-100 text-yellow-700 border-yellow-200',
  'Peak':    'bg-orange-100 text-orange-700 border-orange-200',
  'Taper':   'bg-purple-100 text-purple-700 border-purple-200',
  'Race':    'bg-red-100 text-red-700 border-red-200',
  'Recovery':'bg-green-100 text-green-700 border-green-200',
}

function phaseColor(phase: string | null): string {
  if (!phase) return 'bg-gray-100 text-gray-600 border-gray-200'
  for (const key of Object.keys(PHASE_COLORS)) {
    if (phase.toLowerCase().includes(key.toLowerCase())) return PHASE_COLORS[key]
  }
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

function isCurrentWeek(dateStart: string | null, dateEnd: string | null): boolean {
  if (!dateStart || !dateEnd) return false
  const today = new Date()
  return today >= new Date(dateStart) && today <= new Date(dateEnd)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

const emptyProgramForm = {
  name: '',
  phase: '',
  date_start: '',
  date_end: '',
  notes: '',
  race_id: '',
}

export default function RoadmapPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [programs, setPrograms] = useState<Program[]>([])
  const [weeks, setWeeks] = useState<ProgramWeek[]>([])
  const [races, setRaces] = useState<Race[]>([])
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showProgramForm, setShowProgramForm] = useState(false)
  const [programForm, setProgramForm] = useState(emptyProgramForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [programsResult, racesResult] = await Promise.all([
        supabase
          .from('programs')
          .select('id, name, phase, date_start, date_end, status, notes, race_id')
          .eq('athlete_id', athleteId!)
          .order('date_start', { ascending: true }),
        supabase
          .from('races')
          .select('id, name, event_date, status')
          .eq('athlete_id', athleteId!)
          .order('event_date', { ascending: true })
      ])
      if (!cancelled) {
        if (programsResult.error) console.error('[PaceIQ] programs:', programsResult.error.message)
        if (racesResult.error) console.error('[PaceIQ] races:', racesResult.error.message)
        if (programsResult.data) {
          setPrograms(programsResult.data)
          if (programsResult.data.length > 0) setSelectedProgramId(programsResult.data[0].id)
        }
        if (racesResult.data) setRaces(racesResult.data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  useEffect(() => {
    if (!selectedProgramId || !athleteId) return
    let cancelled = false

    async function load() {
      const { data, error: err } = await supabase
        .from('program_weeks')
        .select('id, program_id, week_number, phase, date_start, date_end, target_distance_km, actual_distance_km, focus, notes')
        .eq('program_id', selectedProgramId!)
        .eq('athlete_id', athleteId!)
        .order('week_number', { ascending: true })
      if (!cancelled) {
        if (err) console.error('[PaceIQ] program_weeks:', err.message)
        if (data) setWeeks(data)
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedProgramId, athleteId])

  async function reloadPrograms() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('programs')
      .select('id, name, phase, date_start, date_end, status, notes, race_id')
      .eq('athlete_id', athleteId!)
      .order('date_start', { ascending: true })
    if (err) console.error('[PaceIQ] programs:', err.message)
    if (data) setPrograms(data)
  }

  async function saveProgram() {
    if (!athleteId || !programForm.name.trim()) { setError('Nama program wajib diisi.'); return }
    setSaving(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('programs')
      .insert({
        athlete_id: athleteId,
        name: programForm.name.trim(),
        phase: programForm.phase || null,
        date_start: programForm.date_start || null,
        date_end: programForm.date_end || null,
        notes: programForm.notes || null,
        race_id: programForm.race_id || null,
        status: 'active',
      })
      .select('id')
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowProgramForm(false)
    setProgramForm(emptyProgramForm)
    await reloadPrograms()
    if (data && data[0]) setSelectedProgramId(data[0].id)
  }

  async function deleteProgram(id: string) {
    if (!confirm('Hapus program ini beserta semua minggunya?')) return
    const { error: err } = await supabase.from('programs').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete program:', err.message); return }
    setSelectedProgramId(null)
    setWeeks([])
    await reloadPrograms()
  }

  const selectedProgram = programs.find(p => p.id === selectedProgramId)
  const linkedRace = selectedProgram?.race_id ? races.find(r => r.id === selectedProgram.race_id) : null
  const totalTargetKm = weeks.reduce((sum, w) => sum + (w.target_distance_km ?? 0), 0)
  const totalActualKm = weeks.reduce((sum, w) => sum + (w.actual_distance_km ?? 0), 0)
  const currentWeek = weeks.find(w => isCurrentWeek(w.date_start, w.date_end))

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Roadmap & Milestone" subtitle="Timeline program training" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader
        title="Roadmap & Milestone"
        subtitle="Timeline program training"
        action={
          <button onClick={() => { setShowProgramForm(v => !v); setError(null) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            {showProgramForm ? 'Batal' : '+ Program Baru'}
          </button>
        }
      />

      {showProgramForm && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Program Baru</h3>
          {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-gray-500 mb-1">Nama Program *</label>
              <input type="text" value={programForm.name} placeholder="HM Training 18 Weeks"
                onChange={e => setProgramForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Fase</label>
              <input type="text" value={programForm.phase} placeholder="Base / Build / Peak"
                onChange={e => setProgramForm(p => ({ ...p, phase: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tanggal Mulai</label>
              <input type="date" value={programForm.date_start}
                onChange={e => setProgramForm(p => ({ ...p, date_start: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tanggal Selesai</label>
              <input type="date" value={programForm.date_end}
                onChange={e => setProgramForm(p => ({ ...p, date_end: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Linked Race</label>
              <select value={programForm.race_id}
                onChange={e => setProgramForm(p => ({ ...p, race_id: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">— Tidak ada —</option>
                {races.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Catatan</label>
              <input type="text" value={programForm.notes}
                onChange={e => setProgramForm(p => ({ ...p, notes: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveProgram} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setShowProgramForm(false)}
              className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Batal
            </button>
          </div>
        </div>
      )}

      {programs.length === 0 ? (
        <EmptyState title="Belum ada program" description="Buat program training pertama untuk mulai tracking roadmap." />
      ) : (
        <div className="flex gap-6">
          <div className="w-56 shrink-0">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Program</h3>
            <div className="space-y-1">
              {programs.map(p => (
                <div key={p.id} onClick={() => setSelectedProgramId(p.id)}
                  className={`px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors ${
                    selectedProgramId === p.id
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-100'
                  }`}>
                  <p className="font-medium truncate">{p.name}</p>
                  {p.date_start && (
                    <p className={`text-xs mt-0.5 ${selectedProgramId === p.id ? 'text-indigo-200' : 'text-gray-400'}`}>
                      {formatDate(p.date_start)} – {formatDate(p.date_end)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {selectedProgram && (
              <>
                <div className="bg-white rounded-xl shadow-sm p-5 mb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-base font-bold text-gray-900">{selectedProgram.name}</h2>
                      {linkedRace && <p className="text-xs text-indigo-500 mt-0.5">🏁 {linkedRace.name}</p>}
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        {selectedProgram.date_start && (
                          <span>📅 {formatDate(selectedProgram.date_start)} – {formatDate(selectedProgram.date_end)}</span>
                        )}
                        <span>📊 {weeks.length} minggu</span>
                        <span>🎯 Target: {totalTargetKm.toFixed(0)} km</span>
                        <span>✅ Actual: {totalActualKm.toFixed(0)} km</span>
                      </div>
                      {selectedProgram.notes && <p className="text-xs text-gray-400 mt-2 italic">{selectedProgram.notes}</p>}
                    </div>
                    <button onClick={() => deleteProgram(selectedProgram.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors ml-4">
                      Hapus
                    </button>
                  </div>
                </div>

                {currentWeek && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-4">
                    <p className="text-xs font-semibold text-indigo-600 mb-1">📍 MINGGU SAAT INI</p>
                    <p className="text-sm font-bold text-indigo-800">
                      Minggu {currentWeek.week_number} {currentWeek.phase ? `— ${currentWeek.phase}` : ''}
                    </p>
                    {currentWeek.focus && <p className="text-xs text-indigo-600 mt-0.5">Fokus: {currentWeek.focus}</p>}
                    <p className="text-xs text-indigo-400 mt-1">
                      {formatDate(currentWeek.date_start)} – {formatDate(currentWeek.date_end)} ·
                      Target: {currentWeek.target_distance_km ?? '—'} km
                    </p>
                  </div>
                )}

                {weeks.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-sm p-5 text-center text-gray-400 text-sm">
                    Belum ada minggu di program ini. Tambahkan via Program Detail.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {weeks.map(w => {
                      const isCurrent = isCurrentWeek(w.date_start, w.date_end)
                      const isPast = w.date_end ? new Date(w.date_end) < new Date() : false
                      const progress = w.target_distance_km && w.actual_distance_km
                        ? Math.min(100, Math.round((w.actual_distance_km / w.target_distance_km) * 100))
                        : null
                      return (
                        <div key={w.id} className={`bg-white rounded-xl border shadow-sm p-4 ${isCurrent ? 'border-indigo-300' : 'border-gray-100'}`}>
                          <div className="flex items-start gap-4">
                            <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                              isCurrent ? 'bg-indigo-600 text-white' : isPast ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {w.week_number}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                {w.phase && (
                                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${phaseColor(w.phase)}`}>
                                    {w.phase}
                                  </span>
                                )}
                                {w.focus && <span className="text-sm text-gray-700">{w.focus}</span>}
                                {isCurrent && <span className="text-xs text-indigo-500 font-semibold">← Sekarang</span>}
                              </div>
                              <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                                <span>{formatDate(w.date_start)} – {formatDate(w.date_end)}</span>
                                {w.target_distance_km && <span>Target: {w.target_distance_km} km</span>}
                                {w.actual_distance_km && <span>Actual: {w.actual_distance_km} km</span>}
                              </div>
                              {progress !== null && (
                                <div className="mt-2">
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-40">
                                    <div className={`h-1.5 rounded-full ${progress >= 100 ? 'bg-green-400' : 'bg-indigo-400'}`}
                                      style={{ width: `${progress}%` }} />
                                  </div>
                                  <p className="text-xs text-gray-400 mt-0.5">{progress}% volume</p>
                                </div>
                              )}
                              {w.notes && <p className="text-xs text-gray-400 mt-1 italic">{w.notes}</p>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
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