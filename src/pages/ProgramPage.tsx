import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface Program {
  id: string
  name: string
  date_start: string | null
  date_end: string | null
  status: string | null
}

interface ProgramWeek {
  id: string
  week_number: number
  phase: string | null
  date_start: string | null
  date_end: string | null
  target_distance_km: number | null
  focus: string | null
  notes: string | null
}

interface ProgramSession {
  id: string
  session_date: string | null
  day_of_week: number | null
  session_type: string | null
  distance_km: number | null
  duration_min: number | null
  target_pace_min: number | null
  target_pace_sec: number | null
  hr_zone: number | null
  rwr_run_sec: number | null
  rwr_walk_sec: number | null
  coach_notes: string | null
  sort_order: number | null
}

const DAY_NAMES = ['', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']

const SESSION_TYPE_STYLE: Record<string, string> = {
  'easy':     'bg-blue-50 text-blue-700 border-blue-200',
  'tempo':    'bg-yellow-50 text-yellow-700 border-yellow-200',
  'interval': 'bg-red-50 text-red-700 border-red-200',
  'long':     'bg-green-50 text-green-700 border-green-200',
  'rest':     'bg-gray-50 text-gray-400 border-gray-200',
  'race':     'bg-purple-50 text-purple-700 border-purple-200',
  'recovery': 'bg-teal-50 text-teal-700 border-teal-200',
}

function sessionStyle(type: string | null): string {
  if (!type) return 'bg-gray-50 text-gray-500 border-gray-200'
  return SESSION_TYPE_STYLE[type.toLowerCase()] ?? 'bg-indigo-50 text-indigo-700 border-indigo-200'
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function isCurrentWeek(dateStart: string | null, dateEnd: string | null): boolean {
  if (!dateStart || !dateEnd) return false
  const today = new Date()
  return today >= new Date(dateStart) && today <= new Date(dateEnd)
}

// Simple markdown renderer (bold, italic, code)
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>')
    .replace(/\n/g, '<br/>')
}

export default function ProgramPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [programs, setPrograms] = useState<Program[]>([])
  const [weeks, setWeeks] = useState<ProgramWeek[]>([])
  const [sessions, setSessions] = useState<ProgramSession[]>([])
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null)
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingWeeks, setLoadingWeeks] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)

  useEffect(() => {
    if (!athleteId) return
    loadPrograms()
  }, [athleteId])

  useEffect(() => {
    if (!selectedProgramId) return
    loadWeeks(selectedProgramId)
  }, [selectedProgramId])

  useEffect(() => {
    if (!selectedWeekId) return
    loadSessions(selectedWeekId)
  }, [selectedWeekId])

  async function loadPrograms() {
    if (!athleteId) return
    setLoading(true)
    const { data } = await supabase
      .from('programs')
      .select('id, name, date_start, date_end, status')
      .eq('athlete_id', athleteId)
      .order('date_start', { ascending: true })
    if (data) {
      setPrograms(data)
      if (data.length > 0) setSelectedProgramId(data[0].id)
    }
    setLoading(false)
  }

  async function loadWeeks(programId: string) {
    if (!athleteId) return
    setLoadingWeeks(true)
    const { data } = await supabase
      .from('program_weeks')
      .select('id, week_number, phase, date_start, date_end, target_distance_km, focus, notes')
      .eq('program_id', programId)
      .eq('athlete_id', athleteId)
      .order('week_number', { ascending: true })
    if (data) {
      setWeeks(data)
      // Auto-select current week or first week
      const current = data.find(w => isCurrentWeek(w.date_start, w.date_end))
      setSelectedWeekId(current?.id ?? (data.length > 0 ? data[0].id : null))
    }
    setLoadingWeeks(false)
  }

  async function loadSessions(weekId: string) {
    if (!athleteId) return
    setLoadingSessions(true)
    const { data } = await supabase
      .from('program_sessions')
      .select('id, session_date, day_of_week, session_type, distance_km, duration_min, target_pace_min, target_pace_sec, hr_zone, rwr_run_sec, rwr_walk_sec, coach_notes, sort_order')
      .eq('program_week_id', weekId)
      .eq('athlete_id', athleteId)
      .order('sort_order', { ascending: true })
    if (data) setSessions(data)
    setLoadingSessions(false)
  }

  const selectedWeek = weeks.find(w => w.id === selectedWeekId)

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Program Detail" subtitle="Detail sesi per minggu" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Program Detail" subtitle="Detail sesi per minggu" />

      {programs.length === 0 ? (
        <EmptyState
          title="Belum ada program"
          description="Buat program di menu Roadmap & Milestone terlebih dahulu."
        />
      ) : (
        <>
          {/* Program selector */}
          <div className="flex items-center gap-3 mb-5">
            <label className="text-xs text-gray-500 shrink-0">Program:</label>
            <select
              value={selectedProgramId ?? ''}
              onChange={e => setSelectedProgramId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {programs.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {loadingWeeks ? (
            <p className="text-gray-400 text-sm">Memuat minggu...</p>
          ) : weeks.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-5 text-center text-gray-400 text-sm">
              Program ini belum punya minggu. Tambahkan via coach atau import program.
            </div>
          ) : (
            <div className="flex gap-5">
              {/* Week list */}
              <div className="w-44 shrink-0">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Minggu</h3>
                <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
                  {weeks.map(w => {
                    const isCurrent = isCurrentWeek(w.date_start, w.date_end)
                    return (
                      <button
                        key={w.id}
                        onClick={() => setSelectedWeekId(w.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          selectedWeekId === w.id
                            ? 'bg-indigo-600 text-white'
                            : isCurrent
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                            : 'bg-white text-gray-600 border border-gray-100 hover:bg-gray-50'
                        }`}
                      >
                        <p className="font-medium">W{w.week_number}</p>
                        {w.phase && (
                          <p className={`text-xs mt-0.5 truncate ${selectedWeekId === w.id ? 'text-indigo-200' : 'text-gray-400'}`}>
                            {w.phase}
                          </p>
                        )}
                        {isCurrent && selectedWeekId !== w.id && (
                          <p className="text-xs text-indigo-500 font-semibold">← Now</p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Session cards */}
              <div className="flex-1 min-w-0">
                {selectedWeek && (
                  <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-gray-800">
                          Minggu {selectedWeek.week_number}
                          {selectedWeek.phase ? ` — ${selectedWeek.phase}` : ''}
                          {isCurrentWeek(selectedWeek.date_start, selectedWeek.date_end) && (
                            <span className="ml-2 text-xs text-indigo-500 font-semibold">📍 Minggu Ini</span>
                          )}
                        </h3>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-400">
                          <span>{formatDate(selectedWeek.date_start)} – {formatDate(selectedWeek.date_end)}</span>
                          {selectedWeek.target_distance_km && <span>Target: {selectedWeek.target_distance_km} km</span>}
                          {selectedWeek.focus && <span>Fokus: {selectedWeek.focus}</span>}
                        </div>
                        {selectedWeek.notes && (
                          <p className="text-xs text-gray-400 mt-1 italic">{selectedWeek.notes}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {loadingSessions ? (
                  <p className="text-gray-400 text-sm">Memuat sesi...</p>
                ) : sessions.length === 0 ? (
                  <div className="bg-white rounded-xl shadow-sm p-5 text-center text-gray-400 text-sm">
                    Belum ada sesi di minggu ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessions.map(s => (
                      <div key={s.id} className={`bg-white rounded-xl border shadow-sm p-4 ${sessionStyle(s.session_type)}`}>
                        <div className="flex items-start gap-3">
                          {/* Day badge */}
                          <div className="shrink-0 text-center">
                            {s.day_of_week && (
                              <div className="w-10 h-10 rounded-lg bg-white border border-current flex items-center justify-center">
                                <span className="text-xs font-bold">{DAY_NAMES[s.day_of_week]}</span>
                              </div>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {s.session_type && (
                                <span className="text-xs font-bold uppercase tracking-wide">
                                  {s.session_type}
                                </span>
                              )}
                              {s.session_date && (
                                <span className="text-xs opacity-60">{formatDate(s.session_date)}</span>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-3 text-xs mb-2">
                              {s.distance_km && <span>📍 {s.distance_km} km</span>}
                              {s.duration_min && <span>⏱ {s.duration_min} menit</span>}
                              {s.target_pace_min !== null && s.target_pace_sec !== null && (
                                <span>🎯 {s.target_pace_min}:{String(s.target_pace_sec).padStart(2,'0')} /km</span>
                              )}
                              {s.hr_zone && <span>❤️ Z{s.hr_zone}</span>}
                              {s.rwr_run_sec && s.rwr_walk_sec && (
                                <span>🏃 RWR {s.rwr_run_sec}:{s.rwr_walk_sec}</span>
                              )}
                            </div>

                            {s.coach_notes && (
                              <div
                                className="text-xs text-current opacity-80 bg-white bg-opacity-60 rounded-lg px-3 py-2"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(s.coach_notes) }}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}