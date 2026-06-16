import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts'

interface Session {
  session_date: string
  distance_km: number | null
  duration_sec: number | null
  trimp: number | null
  session_type: string | null
}

// ─── Weekly bucketing ─────────────────────────────────────────
function getMonday(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

interface WeekBucket {
  weekLabel: string
  totalTrimp: number
  totalKm: number
  sessionCount: number
  dailyTrimps: number[]
}

function bucketByWeek(sessions: Session[]): WeekBucket[] {
  const map = new Map<string, WeekBucket>()

  sessions.forEach(s => {
    const monday = getMonday(s.session_date)
    if (!map.has(monday)) {
      map.set(monday, {
        weekLabel: new Date(monday).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        totalTrimp: 0,
        totalKm: 0,
        sessionCount: 0,
        dailyTrimps: [],
      })
    }
    const bucket = map.get(monday)!
    const trimp = s.trimp ?? 0
    bucket.totalTrimp += trimp
    bucket.totalKm += s.distance_km ?? 0
    bucket.sessionCount += 1
    bucket.dailyTrimps.push(trimp)
  })

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
}

function calcMonotony(dailyTrimps: number[]): number {
  if (dailyTrimps.length === 0) return 0
  const avg = dailyTrimps.reduce((a, b) => a + b, 0) / dailyTrimps.length
  const variance = dailyTrimps.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / dailyTrimps.length
  const sd = Math.sqrt(variance)
  return sd === 0 ? 0 : parseFloat((avg / sd).toFixed(2))
}

// ACWR: 7-day acute / 28-day chronic rolling average of daily TRIMP
function calcAcwr(sessions: Session[], refDate: string): number | null {
  const ref = new Date(refDate)
  const acute: number[] = []
  const chronic: number[] = []

  for (let i = 0; i < 28; i++) {
    const d = new Date(ref)
    d.setDate(ref.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const dayTrimp = sessions
      .filter(s => s.session_date === dateStr)
      .reduce((sum, s) => sum + (s.trimp ?? 0), 0)
    if (i < 7) acute.push(dayTrimp)
    chronic.push(dayTrimp)
  }

  const acuteAvg = acute.reduce((a, b) => a + b, 0) / 7
  const chronicAvg = chronic.reduce((a, b) => a + b, 0) / 28
  if (chronicAvg === 0) return null
  return parseFloat((acuteAvg / chronicAvg).toFixed(2))
}

// ─── Colors ───────────────────────────────────────────────────
const PIE_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16']

export default function TrainingLoadPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'weekly' | 'acwr' | 'intensity'>('weekly')

  useEffect(() => {
    if (!athleteId) return
    loadSessions()
  }, [athleteId])

  async function loadSessions() {
    if (!athleteId) return
    setLoading(true)
    // Ambil 6 bulan terakhir
    const since = new Date()
    since.setMonth(since.getMonth() - 6)
    const { data } = await supabase
      .from('training_sessions')
      .select('session_date, distance_km, duration_sec, trimp, session_type')
      .eq('athlete_id', athleteId)
      .gte('session_date', since.toISOString().split('T')[0])
      .order('session_date', { ascending: true })
    if (data) setSessions(data)
    setLoading(false)
  }

  // ── Derived data ──
  const weeks = bucketByWeek(sessions)

  const weeklyChartData = weeks.map(w => ({
    week: w.weekLabel,
    trimp: parseFloat(w.totalTrimp.toFixed(1)),
    km: parseFloat(w.totalKm.toFixed(1)),
    monotony: calcMonotony(w.dailyTrimps),
    strain: parseFloat((w.totalTrimp * calcMonotony(w.dailyTrimps)).toFixed(1)),
  }))

  // ACWR per week (last day of each week)
  const acwrChartData = weeks.map((w, i) => {
    // Approximate last day of week as monday + 6
    const sessions7 = sessions
    const monday = Object.keys(
      sessions.reduce((acc, s) => { acc[getMonday(s.session_date)] = true; return acc }, {} as Record<string, boolean>)
    ).sort()[i]
    if (!monday) return { week: w.weekLabel, acwr: null }
    const lastDay = new Date(monday)
    lastDay.setDate(lastDay.getDate() + 6)
    const acwr = calcAcwr(sessions7, lastDay.toISOString().split('T')[0])
    return { week: w.weekLabel, acwr }
  })

  // Intensity distribution
  const typeMap = new Map<string, number>()
  sessions.forEach(s => {
    const t = s.session_type ?? 'Lainnya'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  })
  const intensityData = Array.from(typeMap.entries()).map(([name, value]) => ({ name, value }))

  // Current week stats
  const thisWeekMonday = getMonday(new Date().toISOString().split('T')[0])
  const thisWeekSessions = sessions.filter(s => getMonday(s.session_date) === thisWeekMonday)
  const thisWeekKm = thisWeekSessions.reduce((sum, s) => sum + (s.distance_km ?? 0), 0)
  const thisWeekTrimp = thisWeekSessions.reduce((sum, s) => sum + (s.trimp ?? 0), 0)
  const thisMonotony = calcMonotony(thisWeekSessions.map(s => s.trimp ?? 0))
  const thisStrain = thisWeekTrimp * thisMonotony
  const currentAcwr = calcAcwr(sessions, new Date().toISOString().split('T')[0])

  const acwrColor = (v: number | null) => {
    if (!v) return 'default'
    if (v >= 0.8 && v <= 1.3) return 'green'
    if (v < 0.8) return 'default'
    return 'red'
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Training Load Analytics" subtitle="CTL, ATL, TSB, ACWR dan weekly summary" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Training Load Analytics" subtitle="6 bulan terakhir" />

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Volume Minggu Ini" value={`${thisWeekKm.toFixed(1)} km`} accent="indigo" />
        <StatCard label="TRIMP Minggu Ini" value={thisWeekTrimp.toFixed(0)} accent="green" />
        <StatCard
          label="ACWR"
          value={currentAcwr?.toFixed(2) ?? '—'}
          sub={currentAcwr ? (currentAcwr >= 0.8 && currentAcwr <= 1.3 ? '✅ Sweet spot' : currentAcwr > 1.3 ? '⚠️ Terlalu tinggi' : '⬇️ Terlalu rendah') : 'Belum cukup data'}
          accent={acwrColor(currentAcwr)}
        />
        <StatCard label="Monotony" value={thisMonotony.toFixed(2)} sub={`Strain: ${thisStrain.toFixed(0)}`} />
        <StatCard label="CTL" value="—" sub="Tersedia di Fase 4" />
        <StatCard label="ATL" value="—" sub="Tersedia di Fase 4" />
        <StatCard label="TSB / Form" value="—" sub="Tersedia di Fase 4" />
        <StatCard label="Sesi Minggu Ini" value={thisWeekSessions.length} />
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'weekly', label: 'Weekly Load' },
          { key: 'acwr', label: 'ACWR Trend' },
          { key: 'intensity', label: 'Intensitas' },
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

      {/* ── Tab Content ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        {sessions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Belum ada data sesi. Mulai log di Daily Log.</p>
        ) : (
          <>
            {activeTab === 'weekly' && (
              <>
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Weekly TRIMP & Volume</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={weeklyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="trimp" name="TRIMP" fill="#4f46e5" radius={[3,3,0,0]} />
                    <Bar yAxisId="right" dataKey="km" name="Km" fill="#10b981" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}

            {activeTab === 'acwr' && (
              <>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">ACWR Trend (7:28 hari)</h3>
                <p className="text-xs text-gray-400 mb-4">Sweet spot: 0.8 – 1.3 · Di atas 1.5 = risiko cedera tinggi</p>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={acwrChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 2]} ticks={[0, 0.8, 1.0, 1.3, 1.5, 2.0]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="acwr" name="ACWR" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}

            {activeTab === 'intensity' && (
              <>
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribusi Tipe Sesi</h3>
                {intensityData.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">Belum ada data.</p>
                ) : (
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={intensityData} dataKey="value" nameKey="name"
                          cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) =>
                            `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                          } labelLine={false}>
                          {intensityData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 shrink-0">
                      {intensityData.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="text-gray-600">{d.name}</span>
                          <span className="font-semibold text-gray-800">{d.value}x</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Weekly Table ── */}
      {weeks.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5 mt-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Weekly Summary Table</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-100">
                <th className="text-left pb-2">Minggu</th>
                <th className="text-right pb-2">Sesi</th>
                <th className="text-right pb-2">Km</th>
                <th className="text-right pb-2">TRIMP</th>
                <th className="text-right pb-2">Monotony</th>
                <th className="text-right pb-2">Strain</th>
              </tr>
            </thead>
            <tbody>
              {[...weeklyChartData].reverse().map((w, i) => (
                <tr key={i} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-gray-700">{w.week}</td>
                  <td className="py-2 text-right text-gray-600">{weeks[weeks.length - 1 - i].sessionCount}</td>
                  <td className="py-2 text-right text-gray-600">{w.km}</td>
                  <td className="py-2 text-right text-gray-600">{w.trimp}</td>
                  <td className="py-2 text-right text-gray-600">{w.monotony}</td>
                  <td className="py-2 text-right text-gray-600">{w.strain}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}