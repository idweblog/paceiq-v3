import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { StatCard } from '../components/ui/StatCard'
import { PageHeader } from '../components/ui/PageHeader'

interface Race {
  id: string
  name: string
  event_date: string | null
  distance_km: number | null
  event_type: string | null
  target_finish: string | null
  status: string
}

interface TrainingSession {
  id: string
  session_date: string
  distance_km: number | null
  duration_sec: number | null
  hr_avg: number | null
  pace_avg_min: number | null
  pace_avg_sec: number | null
  session_type: string | null
  trimp: number | null
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatPace(min: number | null, sec: number | null): string {
  if (min === null || sec === null) return '—'
  return `${min}:${String(sec).padStart(2, '0')} /km`
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function RaceCountdownCard({ race }: { race: Race }) {
  const days = race.event_date ? daysUntil(race.event_date) : null
  const isGoal = race.status === 'A'

  return (
    <div className={`bg-white rounded-xl shadow-sm p-5 border-l-4 ${isGoal ? 'border-indigo-500' : 'border-amber-400'}`}>
      <div className="flex items-start justify-between">
        <div>
          <span className={`text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${isGoal ? 'bg-indigo-50 text-indigo-600' : 'bg-amber-50 text-amber-600'}`}>
            {isGoal ? 'Goal Race' : 'Tune-up Race'}
          </span>
          <h3 className="text-base font-bold text-gray-900 mt-2">{race.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {race.event_type ?? ''} {race.distance_km ?? '—'} km
            {race.target_finish ? ` · Target: ${race.target_finish}` : ''}
          </p>
        </div>
        <div className="text-right ml-4 shrink-0">
          <p className={`text-3xl font-bold ${isGoal ? 'text-indigo-600' : 'text-amber-500'}`}>
            {days !== null && days > 0 ? days : '—'}
          </p>
          <p className="text-xs text-gray-400">hari lagi</p>
        </div>
      </div>
      {race.event_date && (
        <p className="text-xs text-gray-400 mt-3">
          {new Date(race.event_date).toLocaleDateString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          })}
        </p>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [races, setRaces] = useState<Race[]>([])
  const [lastSession, setLastSession] = useState<TrainingSession | null>(null)
  const [weeklyKm, setWeeklyKm] = useState(0)
  const [weeklySessions, setWeeklySessions] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!athleteId) return
    loadDashboard()
  }, [athleteId])

  async function loadDashboard() {
    setLoading(true)
    await Promise.all([loadRaces(), loadSessions()])
    setLoading(false)
  }

  async function loadRaces() {
    if (!athleteId) return
    const { data } = await supabase
      .from('races')
      .select('id, name, event_date, distance_km, event_type, target_finish, status')
      .eq('athlete_id', athleteId)
      .in('status', ['A', 'B'])
      .order('event_date', { ascending: true })
    if (data) setRaces(data)
  }

  async function loadSessions() {
    if (!athleteId) return

    const { data: last } = await supabase
      .from('training_sessions')
      .select('id, session_date, distance_km, duration_sec, hr_avg, pace_avg_min, pace_avg_sec, session_type, trimp')
      .eq('athlete_id', athleteId)
      .order('session_date', { ascending: false })
      .limit(1)
    if (last && last.length > 0) setLastSession(last[0])

    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const { data: weekly } = await supabase
      .from('training_sessions')
      .select('distance_km')
      .eq('athlete_id', athleteId)
      .gte('session_date', weekAgo.toISOString().split('T')[0])
    if (weekly) {
      setWeeklySessions(weekly.length)
      setWeeklyKm(weekly.reduce((sum, s) => sum + (s.distance_km || 0), 0))
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" subtitle="Selamat datang di PaceIQ v3" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Dashboard" subtitle="Ringkasan training dan race countdown" />

      {races.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {races.map(r => <RaceCountdownCard key={r.id} race={r} />)}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6 text-center text-gray-400 text-sm">
          Belum ada race aktif. Tambahkan race di menu Race Management.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Sesi (7 hari)" value={weeklySessions} accent="indigo" />
        <StatCard label="Volume (7 hari)" value={`${weeklyKm.toFixed(1)} km`} accent="green" />
        <StatCard label="CTL" value="—" sub="Tersedia di Fase 4" />
        <StatCard label="TSB / Form" value="—" sub="Tersedia di Fase 4" />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Sesi Terakhir</h3>
        {lastSession ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400">Tanggal</p>
              <p className="text-sm font-medium text-gray-800">
                {new Date(lastSession.session_date).toLocaleDateString('id-ID', {
                  day: 'numeric', month: 'short', year: 'numeric'
                })}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Jarak</p>
              <p className="text-sm font-medium text-gray-800">{lastSession.distance_km ?? '—'} km</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Durasi</p>
              <p className="text-sm font-medium text-gray-800">
                {lastSession.duration_sec ? formatDuration(lastSession.duration_sec) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Pace Avg</p>
              <p className="text-sm font-medium text-gray-800">
                {formatPace(lastSession.pace_avg_min, lastSession.pace_avg_sec)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">HR Avg</p>
              <p className="text-sm font-medium text-gray-800">
                {lastSession.hr_avg ? `${lastSession.hr_avg} bpm` : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">TRIMP</p>
              <p className="text-sm font-medium text-gray-800">{lastSession.trimp?.toFixed(1) ?? '—'}</p>
            </div>
            {lastSession.session_type && (
              <div>
                <p className="text-xs text-gray-400">Tipe Sesi</p>
                <p className="text-sm font-medium text-gray-800">{lastSession.session_type}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Belum ada sesi tercatat. Mulai log di Daily Log.</p>
        )}
      </div>
    </div>
  )
}