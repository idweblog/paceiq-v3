import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { useRole } from '../hooks/useRole'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface GroupSummary {
  id: string
  name: string
  is_active: boolean | null
  member_count: number
}

interface AthleteFitnessRow {
  athlete_id: string
  name: string
  ctl: number | null
  atl: number | null
  tsb: number | null
  acwr: number | null
  last_session_date: string | null
}

interface RecentSession {
  id: string
  athlete_name: string
  session_date: string
  duration_min: number | null
  trimp: number | null
}

export default function CoachDashboardPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id ?? null
  const { isCoach } = useRole()

  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [fitnessRows, setFitnessRows] = useState<AthleteFitnessRow[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingFitness, setLoadingFitness] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    if (athleteId && isCoach) loadGroups()
    return () => { cancelledRef.current = true }
  }, [athleteId, isCoach])

  useEffect(() => {
    if (selectedGroupId) {
      loadGroupFitness(selectedGroupId)
      loadRecentSessions(selectedGroupId)
    }
  }, [selectedGroupId])

  async function loadGroups() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('group_programs').select('id, name, is_active')
      .eq('coach_athlete_id', athleteId!).order('created_at', { ascending: false })

    if (err) { if (!cancelledRef.current) setError('Gagal memuat grup.'); setLoading(false); return }
    if (cancelledRef.current) return

    const summaries: GroupSummary[] = []
    for (const g of data ?? []) {
      const { count } = await supabase.from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id).eq('status', 'active')
      summaries.push({ ...g, member_count: count ?? 0 })
    }

    if (!cancelledRef.current) {
      setGroups(summaries)
      if (summaries.length > 0 && !selectedGroupId) setSelectedGroupId(summaries[0].id)
      setLoading(false)
    }
  }

  async function loadGroupFitness(groupId: string) {
    setLoadingFitness(true)
    const { data, error: err } = await (supabase.rpc as any)('get_group_fitness', { p_group_id: groupId })
    if (cancelledRef.current) return
    if (err) { setError('Gagal memuat data fitness: ' + err.message); setLoadingFitness(false); return }

    // Join dengan nama atlet
    const rows: AthleteFitnessRow[] = (data ?? []).map((r: any) => ({
      athlete_id: r.athlete_id,
      name: r.full_name ?? '—',
      ctl: r.ctl,
      atl: r.atl,
      tsb: r.tsb,
      acwr: r.acwr,
      last_session_date: r.last_session_date,
    }))

    setFitnessRows(rows)
    setLoadingFitness(false)
  }

  async function loadRecentSessions(groupId: string) {
    // Ambil athlete_id dari group
    const { data: memberData } = await supabase
      .from('group_members').select('athlete_id')
      .eq('group_id', groupId).eq('status', 'active')

    if (!memberData?.length || cancelledRef.current) return

    const athleteIds = memberData.map(m => m.athlete_id)

    const { data, error: err } = await supabase
      .from('training_sessions')
      .select('id, athlete_id, session_date, duration_min, trimp, athletes ( name )')
      .in('athlete_id', athleteIds)
      .order('session_date', { ascending: false })
      .limit(20)

    if (err || cancelledRef.current) return

    const sessions: RecentSession[] = (data ?? []).map((s: any) => ({
      id: s.id,
      athlete_name: s.athletes?.name ?? '—',
      session_date: s.session_date,
      duration_min: s.duration_min,
      trimp: s.trimp,
    }))

    setRecentSessions(sessions)
  }

  function getTsbColor(tsb: number | null) {
    if (tsb === null) return 'text-gray-400'
    if (tsb > 10) return 'text-green-600 dark:text-green-400'
    if (tsb > -10) return 'text-yellow-600 dark:text-yellow-400'
    return 'text-red-600 dark:text-red-400'
  }

  function getAcwrColor(acwr: number | null) {
    if (acwr === null) return 'text-gray-400'
    if (acwr >= 0.8 && acwr <= 1.3) return 'text-green-600 dark:text-green-400'
    if (acwr > 1.3 && acwr <= 1.5) return 'text-yellow-600 dark:text-yellow-400'
    if (acwr > 1.5) return 'text-red-600 dark:text-red-400'
    return 'text-gray-500 dark:text-gray-400'
  }

  function daysSinceSession(dateStr: string | null): number | null {
    if (!dateStr) return null
    const diff = Date.now() - new Date(dateStr).getTime()
    return Math.floor(diff / (1000 * 60 * 60 * 24))
  }

  if (!isCoach) return (
    <div className="p-6 text-center text-gray-500 dark:text-gray-400">
      Halaman ini hanya untuk coach.
    </div>
  )

  if (loading) return (
    <div className="p-6 text-center text-gray-500 dark:text-gray-400">Memuat dashboard...</div>
  )

  const selectedGroup = groups.find(g => g.id === selectedGroupId)
  const alertAthletes = fitnessRows.filter(r => {
    const days = daysSinceSession(r.last_session_date)
    return days === null || days >= 7
  })

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader title="Coach Dashboard" subtitle="Monitor atlet dan grup latihan" />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}<button onClick={() => setError(null)} className="ml-3 underline">Tutup</button>
        </div>
      )}

      {groups.length === 0 ? (
        <EmptyState title="Belum ada grup" description="Buat grup di halaman Group Training untuk mulai memonitor atlet." />
      ) : (
        <>
          {/* Group selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 dark:text-gray-400">Grup:</span>
            {groups.map(g => (
              <button key={g.id} onClick={() => setSelectedGroupId(g.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedGroupId === g.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}>
                {g.name}
                <span className="ml-1.5 text-xs opacity-75">({g.member_count})</span>
              </button>
            ))}
          </div>

          {/* Overview stats */}
          {selectedGroup && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Atlet</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">{selectedGroup.member_count}</p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Perlu Perhatian</p>
                <p className={`text-2xl font-bold mt-1 ${alertAthletes.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                  {alertAthletes.length}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Sesi 7 Hari Terakhir</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">
                  {recentSessions.filter(s => daysSinceSession(s.session_date) !== null && daysSinceSession(s.session_date)! <= 7).length}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">Status Grup</p>
                <p className={`text-sm font-semibold mt-1 ${selectedGroup.is_active ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                  {selectedGroup.is_active ? 'Aktif' : 'Nonaktif'}
                </p>
              </div>
            </div>
          )}

          {/* Alert: atlet tidak aktif */}
          {alertAthletes.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                ⚠️ {alertAthletes.length} atlet tidak submit sesi dalam 7+ hari
              </p>
              <div className="flex flex-wrap gap-2">
                {alertAthletes.map(a => (
                  <span key={a.athlete_id} className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-1 rounded-full">
                    {a.name} {a.last_session_date ? `(${daysSinceSession(a.last_session_date)}h)` : '(belum pernah)'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Fitness table */}
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Status Fitness Atlet</h2>
            {loadingFitness ? (
              <p className="text-sm text-gray-400">Memuat data fitness...</p>
            ) : fitnessRows.length === 0 ? (
              <EmptyState title="Belum ada data fitness" description="Data akan muncul setelah atlet mencatat sesi latihan." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Atlet</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">CTL</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">ATL</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">TSB</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">ACWR</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Sesi Terakhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {fitnessRows.map(r => {
                      const days = daysSinceSession(r.last_session_date)
                      return (
                        <tr key={r.athlete_id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{r.name}</td>
                          <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-200">{r.ctl?.toFixed(1) ?? '—'}</td>
                          <td className="px-4 py-3 text-center text-gray-700 dark:text-gray-200">{r.atl?.toFixed(1) ?? '—'}</td>
                          <td className={`px-4 py-3 text-center font-semibold ${getTsbColor(r.tsb)}`}>
                            {r.tsb !== null ? (r.tsb > 0 ? '+' : '') + r.tsb.toFixed(1) : '—'}
                          </td>
                          <td className={`px-4 py-3 text-center font-semibold ${getAcwrColor(r.acwr)}`}>
                            {r.acwr?.toFixed(2) ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {r.last_session_date ? (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                days !== null && days >= 7
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              }`}>
                                {days === 0 ? 'Hari ini' : `${days}h lalu`}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">Belum ada</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent sessions */}
          <div className="space-y-3">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Sesi Terbaru</h2>
            {recentSessions.length === 0 ? (
              <EmptyState title="Belum ada sesi" description="Sesi latihan atlet akan muncul di sini." />
            ) : (
              <div className="space-y-2">
                {recentSessions.slice(0, 10).map(s => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{s.athlete_name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(s.session_date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                      {s.duration_min && <span>{s.duration_min} mnt</span>}
                      {s.trimp && <span className="text-indigo-600 dark:text-indigo-400">TRIMP {s.trimp.toFixed(0)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
