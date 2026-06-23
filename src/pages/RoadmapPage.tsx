import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Race {
  id: string
  name: string
  event_date: string
  status: string
}

interface ProgramSession {
  id: string
  athlete_id: string
  race_id: string
  session_date: string
  program_type: string
  notes: string | null
  details?: SessionDetail[]
}

interface SessionDetail {
  id: string
  session_id: string
  athlete_id: string
  sort_order: number
  zone_name: string
  distance_km: number | null
  est_duration_min: number | null
}

interface PaceZone {
  name: string
  label: string
  pct_min: number
  pct_max: number
  pace_min_sec: number // sec/km
  pace_max_sec: number // sec/km
  color: string
}

interface WeekGroup {
  week_number: number
  period_start: string // Monday
  period_end: string   // Sunday
  sessions: ProgramSession[]
  total_km: number
}

interface SessionForm {
  session_date: string
  program_type: string
  notes: string
}

interface DetailForm {
  zone_name: string
  distance_km: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROGRAM_TYPES = [
  'EASY RUN (EZ)',
  'LONGRUN (LR)',
  'MEDIUM RUN (MD-R)',
  'FARTLEK (SPEED PLAY)',
  'SUB-TEMPO (SPEED)',
  'TEMPO RUN (SPEED)',
  'SUB THRESHOLD RUN (SPEED)',
  'THRESHOLD RUN (SPEED)',
  'SUPRA-THRESHOLD RUN (SPEED)',
  'VCR TEST / TIME TRIAL / RACE DAY',
  'SPESIFIC LONGRUN (S-LR)',
  'MIX PACE (SPEED)',
  'STRENGTH - (SENIN)',
  'RUNNING DRILLS - (Kamis)',
  'ST / RD (Mandiri)',
]

// 9 zona VCR — pct range dari locked algorithm
const ZONE_DEFINITIONS = [
  { name: 'Recovery',      label: 'Recovery',      pct_min: 0.64, pct_max: 0.68, color: '#94a3b8' },
  { name: 'Long Run',      label: 'Long Run',       pct_min: 0.69, pct_max: 0.71, color: '#60a5fa' },
  { name: 'Easy',          label: 'Easy',           pct_min: 0.74, pct_max: 0.76, color: '#34d399' },
  { name: 'Moderate',      label: 'Moderate',       pct_min: 0.83, pct_max: 0.85, color: '#a3e635' },
  { name: 'Tempo',         label: 'Tempo',          pct_min: 0.88, pct_max: 0.90, color: '#fbbf24' },
  { name: 'Threshold',     label: 'Threshold',      pct_min: 0.92, pct_max: 0.94, color: '#f97316' },
  { name: 'Aerobic Power', label: 'Aerobic Power',  pct_min: 1.00, pct_max: 1.02, color: '#ef4444' },
  { name: 'VO2Max',        label: 'VO₂Max',         pct_min: 1.03, pct_max: 1.05, color: '#dc2626' },
  { name: 'Anaerob',       label: 'Anaerob',        pct_min: 1.09, pct_max: 1.15, color: '#7c3aed' },
]

const SESSION_BLANK: SessionForm = { session_date: '', program_type: 'EASY RUN (EZ)', notes: '' }
const DETAIL_BLANK: DetailForm   = { zone_name: 'Easy', distance_km: '' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDateShort(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}

function secToMMSS(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} mnt`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}j ${m}mnt` : `${h}j`
}

// Get Monday of the week containing date d
function getMondayOf(d: Date): Date {
  const day = d.getDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day)
  const mon = new Date(d)
  mon.setDate(d.getDate() + diff)
  mon.setHours(0, 0, 0, 0)
  return mon
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Calculate week number from program start date (first Monday on or before first session)
function calcWeekNumber(sessionDate: string, programStartMonday: string): number {
  const sess = new Date(sessionDate).getTime()
  const start = new Date(programStartMonday).getTime()
  return Math.floor((sess - start) / (7 * 86400000)) + 1
}

// Group sessions into weeks
function groupByWeek(sessions: ProgramSession[]): WeekGroup[] {
  if (!sessions.length) return []

  // Find earliest session date → determine program start Monday
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
  const firstMonday = toYMD(getMondayOf(new Date(sorted[0].session_date)))

  const weekMap: Map<number, WeekGroup> = new Map()

  sessions.forEach(s => {
    const wn = calcWeekNumber(s.session_date, firstMonday)
    if (!weekMap.has(wn)) {
      const mon = new Date(firstMonday)
      mon.setDate(mon.getDate() + (wn - 1) * 7)
      const sun = new Date(mon)
      sun.setDate(mon.getDate() + 6)
      weekMap.set(wn, {
        week_number: wn,
        period_start: toYMD(mon),
        period_end: toYMD(sun),
        sessions: [],
        total_km: 0
      })
    }
    weekMap.get(wn)!.sessions.push(s)
  })

  // Sort sessions within each week by date
  weekMap.forEach(wg => {
    wg.sessions.sort((a, b) => a.session_date.localeCompare(b.session_date))
    wg.total_km = wg.sessions.reduce((sum, s) => {
      const detailKm = (s.details || []).reduce((ds, d) => ds + (d.distance_km || 0), 0)
      return sum + detailKm
    }, 0)
  })

  return Array.from(weekMap.values()).sort((a, b) => a.week_number - b.week_number)
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProgramPage() {
  const [athleteId, setAthleteId]   = useState<string | null>(null)
  const [roles, setRoles]           = useState<string[]>([])
  const [races, setRaces]           = useState<Race[]>([])
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const [sessions, setSessions]     = useState<ProgramSession[]>([])
  const [paceZones, setPaceZones]   = useState<PaceZone[]>([])
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)

  // Selected week for detail view
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)

  // Session modal
  const [sessionModal, setSessionModal] = useState<{ open: boolean; editing: ProgramSession | null }>({ open: false, editing: null })
  const [sessionForm, setSessionForm]   = useState<SessionForm>(SESSION_BLANK)

  // Detail forms (inline per session)
  const [detailForms, setDetailForms] = useState<Record<string, DetailForm[]>>({})
  const [savingDetail, setSavingDetail] = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canEdit  = roles.includes('coach') || roles.includes('admin')
  const selectedRace = races.find(r => r.id === selectedRaceId) || null
  const isArchived   = selectedRace?.status === 'done'

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // ── Init ──
  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
      if (!ath) return
      setAthleteId(ath.id)

      const { data: roleRows } = await supabase.from('athlete_roles').select('role_id').eq('athlete_id', ath.id)
      const roleIds = (roleRows || []).map((r: any) => r.role_id)
      if (roleIds.length) {
        const { data: roleNames } = await supabase.from('roles').select('name').in('id', roleIds)
        setRoles((roleNames || []).map((r: any) => r.name))
      }

      // Load races
      const { data: raceRows } = await (supabase as any)
        .from('races').select('id,name,event_date,status')
        .eq('athlete_id', ath.id)
        .order('event_date', { ascending: true })
      const raceList: Race[] = raceRows || []
      setRaces(raceList)

      const raceA       = raceList.find(r => r.status === 'A')
      const firstActive = raceList.find(r => r.status !== 'done')
      const auto        = raceA || firstActive || raceList[0]
      if (auto) setSelectedRaceId(auto.id)

      // Load VCR from latest TT
      await loadPaceZones(ath.id)

      setLoading(false)
    }
    init()
  }, [])

  // ── Load pace zones from VCR ──
  async function loadPaceZones(athId: string) {
    const { data: tt } = await (supabase as any)
      .from('tt_history').select('distance_km,finish_time_sec')
      .eq('athlete_id', athId)
      .order('test_date', { ascending: false })
      .limit(1)
      .single()

    // VCR = distance_km * 1000 / finish_time_sec
    const vcr: number = (tt?.distance_km && tt?.finish_time_sec)
      ? (tt.distance_km * 1000) / tt.finish_time_sec
      : 0
    if (!vcr) { setPaceZones([]); return }

    // VCR = distance_km * 1000 / finish_time_sec → pace_sec_per_km = 1000 / vcr_pct
    const zones: PaceZone[] = ZONE_DEFINITIONS.map(z => {
      const pace_min_sec = 1000 / (vcr * z.pct_max) // faster end
      const pace_max_sec = 1000 / (vcr * z.pct_min) // slower end
      return { ...z, pace_min_sec, pace_max_sec }
    })
    setPaceZones(zones)
  }

  // ── Load sessions when race changes ──
  useEffect(() => {
    if (!selectedRaceId || !athleteId) { setSessions([]); return }
    loadSessions(selectedRaceId, athleteId)
  }, [selectedRaceId, athleteId])

  async function loadSessions(raceId: string, athId: string) {
    const { data: sessRows } = await (supabase as any)
      .from('program_sessions').select('*')
      .eq('race_id', raceId)
      .eq('athlete_id', athId)
      .order('session_date')

    const sessList: ProgramSession[] = sessRows || []

    // Load details for all sessions in one query
    if (sessList.length) {
      const ids = sessList.map(s => s.id)
      const { data: detailRows } = await (supabase as any)
        .from('program_session_details').select('*')
        .in('session_id', ids)
        .order('sort_order')

      const detailMap: Record<string, SessionDetail[]> = {}
      ;(detailRows || []).forEach((d: SessionDetail) => {
        if (!detailMap[d.session_id]) detailMap[d.session_id] = []
        detailMap[d.session_id].push(d)
      })

      sessList.forEach(s => { s.details = detailMap[s.id] || [] })
    }

    setSessions(sessList)

    // Auto-select current week
    const weeks = groupByWeek(sessList)
    if (weeks.length) {
      const todayStr = new Date().toISOString().slice(0, 10)
      const current  = weeks.find(w => todayStr >= w.period_start && todayStr <= w.period_end)
      const upcoming = weeks.find(w => w.period_end >= todayStr)
      setSelectedWeek((current || upcoming || weeks[0]).week_number)
    }
  }

  // ── Pace zone lookup ──
  function getZone(zoneName: string): PaceZone | null {
    return paceZones.find(z => z.name === zoneName) || null
  }

  function calcEstDuration(zoneName: string, distKm: number | null): number | null {
    if (!distKm) return null
    const zone = getZone(zoneName)
    if (!zone) return null
    const avgPaceSec = (zone.pace_min_sec + zone.pace_max_sec) / 2
    return (avgPaceSec * distKm) / 60 // minutes
  }

  // ── Session CRUD ──
  function openSessionModal(editing: ProgramSession | null) {
    if (editing) {
      setSessionForm({ session_date: editing.session_date, program_type: editing.program_type, notes: editing.notes || '' })
    } else {
      // Default date = today
      setSessionForm({ ...SESSION_BLANK, session_date: new Date().toISOString().slice(0, 10) })
    }
    setSessionModal({ open: true, editing })
  }

  async function saveSession() {
    if (!selectedRaceId || !athleteId) return
    if (!sessionForm.session_date) { showToast('Tanggal wajib diisi', false); return }
    setSaving(true)
    const payload = {
      athlete_id: athleteId,
      race_id: selectedRaceId,
      session_date: sessionForm.session_date,
      program_type: sessionForm.program_type,
      notes: sessionForm.notes || null
    }
    try {
      if (sessionModal.editing) {
        await (supabase as any).from('program_sessions').update(payload).eq('id', sessionModal.editing.id)
        showToast('Sesi diperbarui')
      } else {
        await (supabase as any).from('program_sessions').insert(payload)
        showToast('Sesi ditambahkan')
      }
      setSessionModal({ open: false, editing: null })
      await loadSessions(selectedRaceId, athleteId)
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteSession(id: string) {
    if (!confirm('Hapus sesi ini beserta semua detailnya?')) return
    await (supabase as any).from('program_sessions').delete().eq('id', id)
    await loadSessions(selectedRaceId, athleteId!)
    showToast('Sesi dihapus')
  }

  // ── Detail CRUD ──
  function initDetailForm(sessionId: string) {
    setDetailForms(prev => ({ ...prev, [sessionId]: [...(prev[sessionId] || []), { ...DETAIL_BLANK }] }))
  }

  function updateDetailForm(sessionId: string, idx: number, field: keyof DetailForm, value: string) {
    setDetailForms(prev => {
      const arr = [...(prev[sessionId] || [])]
      arr[idx] = { ...arr[idx], [field]: value }
      return { ...prev, [sessionId]: arr }
    })
  }

  function removeDetailForm(sessionId: string, idx: number) {
    setDetailForms(prev => {
      const arr = [...(prev[sessionId] || [])]
      arr.splice(idx, 1)
      return { ...prev, [sessionId]: arr }
    })
  }

  async function saveDetails(session: ProgramSession) {
    if (!athleteId) return
    const forms = detailForms[session.id] || []
    if (!forms.length) return

    setSavingDetail(session.id)
    try {
      const existingCount = session.details?.length || 0
      const inserts = forms.map((f, i) => {
        const estMin = calcEstDuration(f.zone_name, f.distance_km ? Number(f.distance_km) : null)
        return {
          session_id: session.id,
          athlete_id: athleteId,
          sort_order: existingCount + i,
          zone_name: f.zone_name,
          distance_km: f.distance_km ? Number(f.distance_km) : null,
          est_duration_min: estMin
        }
      })
      await (supabase as any).from('program_session_details').insert(inserts)
      setDetailForms(prev => { const n = { ...prev }; delete n[session.id]; return n })
      await loadSessions(selectedRaceId, athleteId)
      showToast('Detail disimpan')
    } catch (e: any) {
      showToast('Gagal: ' + e.message, false)
    } finally {
      setSavingDetail(null)
    }
  }

  async function deleteDetail(detailId: string) {
    await (supabase as any).from('program_session_details').delete().eq('id', detailId)
    await loadSessions(selectedRaceId, athleteId!)
    showToast('Detail dihapus')
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  const weeks     = groupByWeek(sessions)
  const activeWk  = weeks.find(w => w.week_number === selectedWeek) || null
  const todayStr  = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Program Detail</h1>
            <p className="text-xs text-gray-400 mt-0.5">Rencana latihan harian per race</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* VCR badge */}
            {paceZones.length > 0 && (
              <div className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg">
                ⚡ VCR aktif — pace zones terhitung
              </div>
            )}
            {!paceZones.length && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-600 px-3 py-1.5 rounded-lg">
                ⚠️ Belum ada data TT — est. waktu tidak tersedia
              </div>
            )}
            <select value={selectedRaceId} onChange={e => setSelectedRaceId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
              {races.length === 0 && <option value="">Belum ada race</option>}
              {races.map(r => (
                <option key={r.id} value={r.id}>
                  {r.status === 'A' ? '🏆 ' : r.status === 'B' ? '🎯 ' : r.status === 'done' ? '✅ ' : '📅 '}
                  {r.name}{r.status === 'done' ? ' (Arsip)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isArchived && (
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-500 flex items-center gap-2">
            <span>🗄️</span><span>Race ini sudah selesai — program dalam mode <strong>arsip</strong>.</span>
          </div>
        )}
      </div>

      {!selectedRaceId ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">Pilih race untuk melihat program</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

          {/* ── LEFT: Week List ── */}
          <div className="space-y-3">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-gsans text-base text-indigo-700 uppercase">Pekan</h2>
                {canEdit && !isArchived && (
                  <button onClick={() => openSessionModal(null)}
                    className="border border-indigo-500 text-indigo-600 text-xs px-2 py-1 rounded-lg hover:bg-indigo-50">+ Tambah Sesi</button>
                )}
              </div>

              {weeks.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs space-y-2">
                  <div className="text-3xl">📅</div>
                  <div>Belum ada sesi latihan.</div>
                  {canEdit && !isArchived && <div>Klik + Tambah Sesi untuk mulai.</div>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {weeks.map(w => {
                    const isActive   = todayStr >= w.period_start && todayStr <= w.period_end
                    const isSelected = w.week_number === selectedWeek
                    const isPast     = todayStr > w.period_end
                    return (
                      <div key={w.week_number} onClick={() => setSelectedWeek(w.week_number)}
                        className={`rounded-lg px-3 py-2.5 cursor-pointer border transition-all ${isSelected ? 'bg-indigo-50 border-indigo-400' : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>
                              Pekan {w.week_number}
                            </span>
                            {isActive && <span className="text-[9px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded-full">AKTIF</span>}
                            {isPast && !isActive && <span className="text-[9px] text-green-600">✓</span>}
                          </div>
                          <span className="text-[10px] text-gray-400 font-medium">{w.total_km.toFixed(1)} km</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {fmtDate(w.period_start)} — {fmtDate(w.period_end)}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{w.sessions.length} sesi</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Summary total */}
            {weeks.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-4">
                <div className="text-xs font-medium text-gray-500 uppercase mb-2">Total Program</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-400">Pekan</div>
                    <div className="text-sm font-bold text-gray-800">{weeks.length}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-400">Total Sesi</div>
                    <div className="text-sm font-bold text-gray-800">{sessions.length}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 col-span-2">
                    <div className="text-xs text-gray-400">Total Jarak</div>
                    <div className="text-sm font-bold text-indigo-600">
                      {weeks.reduce((s, w) => s + w.total_km, 0).toFixed(1)} km
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Week Detail ── */}
          <div className="space-y-4">
            {!activeWk ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">
                <div className="text-4xl mb-3">📋</div>
                <div>Pilih pekan untuk melihat detail sesi</div>
              </div>
            ) : (
              <>
                {/* Week header */}
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h2 className="font-gsans text-lg text-indigo-700">
                        Pekan {activeWk.week_number}
                        {todayStr >= activeWk.period_start && todayStr <= activeWk.period_end && (
                          <span className="ml-2 text-xs font-normal text-white bg-indigo-500 px-2 py-0.5 rounded-full">AKTIF</span>
                        )}
                      </h2>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {fmtDate(activeWk.period_start)} — {fmtDate(activeWk.period_end)}
                      </div>
                    </div>
                    <div className="flex gap-4 text-center text-xs">
                      <div>
                        <div className="text-sm font-bold text-gray-800">{activeWk.sessions.length}</div>
                        <div className="text-gray-400">Sesi</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-indigo-600">{activeWk.total_km.toFixed(1)} km</div>
                        <div className="text-gray-400">Total Jarak</div>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-800">
                          {fmtDuration(activeWk.sessions.reduce((s, sess) =>
                            s + (sess.details || []).reduce((ds, d) => ds + (d.est_duration_min || 0), 0), 0))}
                        </div>
                        <div className="text-gray-400">Est. Durasi</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sessions */}
                <div className="space-y-4">
                  {activeWk.sessions.map(sess => {
                    const sessKm      = (sess.details || []).reduce((s, d) => s + (d.distance_km || 0), 0)
                    const sessMinutes = (sess.details || []).reduce((s, d) => s + (d.est_duration_min || 0), 0)
                    const pendingForms = detailForms[sess.id] || []

                    return (
                      <div key={sess.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                        {/* Session header */}
                        <div className="px-5 py-4 border-b border-gray-100">
                          <div className="flex items-start justify-between flex-wrap gap-2">
                            <div>
                              <div className="text-[11px] font-bold text-indigo-500 uppercase tracking-wider mb-0.5">
                                {fmtDateShort(sess.session_date)}
                              </div>
                              <div className="text-sm font-bold text-gray-800">{sess.program_type}</div>
                              {sess.notes && <div className="text-xs text-gray-500 mt-1 italic">{sess.notes}</div>}
                            </div>
                            <div className="flex items-center gap-4 text-center text-xs">
                              <div>
                                <div className="text-sm font-bold text-indigo-600">{sessKm.toFixed(1)} km</div>
                                <div className="text-gray-400">Total Jarak</div>
                              </div>
                              {sessMinutes > 0 && (
                                <div>
                                  <div className="text-sm font-bold text-gray-700">{fmtDuration(sessMinutes)}</div>
                                  <div className="text-gray-400">Est. Durasi</div>
                                </div>
                              )}
                              {canEdit && !isArchived && (
                                <div className="flex gap-1">
                                  <button onClick={() => openSessionModal(sess)}
                                    className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                  <button onClick={() => deleteSession(sess.id)}
                                    className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Detail rows */}
                        <div className="px-5 py-3">
                          {/* Header row */}
                          {((sess.details || []).length > 0 || pendingForms.length > 0) && (
                            <div className="grid grid-cols-[1fr_100px_100px_90px_28px] gap-2 mb-2 px-1">
                              <div className="text-[10px] font-medium text-gray-400 uppercase">Sesi / Zona</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-center">Range Pace</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-center">Jarak</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-center">Est. Waktu</div>
                              <div />
                            </div>
                          )}

                          {/* Existing details */}
                          {(sess.details || []).map((det, idx) => {
                            const zone    = getZone(det.zone_name)
                            const estMin  = det.est_duration_min || calcEstDuration(det.zone_name, det.distance_km)
                            const paceStr = zone ? `${secToMMSS(zone.pace_min_sec)}–${secToMMSS(zone.pace_max_sec)}/km` : '—'
                            return (
                              <div key={det.id}
                                className="grid grid-cols-[1fr_100px_100px_90px_28px] gap-2 items-center py-2 border-b border-gray-50 last:border-0">
                                {/* Zone pill */}
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-medium text-gray-400">{idx + 1}.</span>
                                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                                    style={{ background: zone?.color + '20' || '#f3f4f6', color: zone?.color || '#6b7280' }}>
                                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: zone?.color || '#9ca3af' }} />
                                    {det.zone_name}
                                  </span>
                                </div>
                                {/* Pace range */}
                                <div className="text-xs text-center font-mono text-gray-600">{paceStr}</div>
                                {/* Distance */}
                                <div className="text-xs text-center font-bold text-gray-800">
                                  {det.distance_km != null ? `${det.distance_km} km` : '—'}
                                </div>
                                {/* Est time */}
                                <div className="text-xs text-center font-bold" style={{ color: zone?.color || '#6b7280' }}>
                                  {estMin != null ? fmtDuration(estMin) : '—'}
                                </div>
                                {/* Delete */}
                                {canEdit && !isArchived && (
                                  <button onClick={() => deleteDetail(det.id)}
                                    className="text-red-300 hover:text-red-500 text-xs text-center">✕</button>
                                )}
                              </div>
                            )
                          })}

                          {/* Pending new detail forms */}
                          {pendingForms.map((f, idx) => {
                            const zone   = getZone(f.zone_name)
                            const estMin = calcEstDuration(f.zone_name, f.distance_km ? Number(f.distance_km) : null)
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_100px_100px_90px_28px] gap-2 items-center py-2 border-b border-indigo-50 bg-indigo-50/30 rounded-lg px-1 mb-1">
                                {/* Zone select */}
                                <select value={f.zone_name}
                                  onChange={e => updateDetailForm(sess.id, idx, 'zone_name', e.target.value)}
                                  className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                  style={{ color: zone?.color || '#374151' }}>
                                  {ZONE_DEFINITIONS.map(z => (
                                    <option key={z.name} value={z.name}>{z.name}</option>
                                  ))}
                                </select>
                                {/* Pace preview */}
                                <div className="text-[10px] text-center font-mono text-gray-500">
                                  {zone ? `${secToMMSS(zone.pace_min_sec)}–${secToMMSS(zone.pace_max_sec)}` : '—'}
                                </div>
                                {/* Distance input */}
                                <input type="number" step="0.1" value={f.distance_km}
                                  onChange={e => updateDetailForm(sess.id, idx, 'distance_km', e.target.value)}
                                  placeholder="km" className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                                {/* Est time preview */}
                                <div className="text-[10px] text-center font-bold" style={{ color: zone?.color || '#6b7280' }}>
                                  {estMin != null ? fmtDuration(estMin) : '—'}
                                </div>
                                {/* Remove row */}
                                <button onClick={() => removeDetailForm(sess.id, idx)}
                                  className="text-red-300 hover:text-red-500 text-xs text-center">✕</button>
                              </div>
                            )
                          })}

                          {/* Empty state */}
                          {!(sess.details || []).length && !pendingForms.length && (
                            <div className="text-center py-4 text-gray-400 text-xs">Belum ada detail sesi.</div>
                          )}

                          {/* Add detail row / save */}
                          {canEdit && !isArchived && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                              <button onClick={() => initDetailForm(sess.id)}
                                className="text-xs border border-dashed border-indigo-300 text-indigo-500 px-3 py-1.5 rounded-lg hover:bg-indigo-50 flex items-center gap-1">
                                + Tambah Baris
                              </button>
                              {pendingForms.length > 0 && (
                                <button onClick={() => saveDetails(sess)}
                                  disabled={savingDetail === sess.id}
                                  className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                                  {savingDetail === sess.id ? 'Menyimpan...' : '✓ Simpan Detail'}
                                </button>
                              )}
                              {pendingForms.length > 0 && (
                                <button onClick={() => setDetailForms(prev => { const n = { ...prev }; delete n[sess.id]; return n })}
                                  className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                                  Batal
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Session Modal ── */}
      {sessionModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{sessionModal.editing ? 'Edit Sesi' : 'Tambah Sesi'}</h3>
              <button onClick={() => setSessionModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
                <input type="date" value={sessionForm.session_date}
                  onChange={e => setSessionForm(f => ({ ...f, session_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Jenis Program *</div>
                <select value={sessionForm.program_type}
                  onChange={e => setSessionForm(f => ({ ...f, program_type: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
                <textarea value={sessionForm.notes}
                  onChange={e => setSessionForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Catatan tambahan untuk sesi ini..."
                  rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setSessionModal({ open: false, editing: null })}
                className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveSession} disabled={saving}
                className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
