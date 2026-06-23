import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Race {
  id: string
  name: string
  event_date: string
  status: string
}

interface ProgramWeek {
  id: string
  race_id: string | null
  athlete_id: string
  week_number: number
  phase_name: string | null
  period_start: string | null
  period_end: string | null
  volume_target_km: number | null
  duration_target: string | null
  rwr_default: string | null
  philosophy: string | null
  goal: string | null
}

interface ProgramSession {
  id: string
  week_id: string
  athlete_id: string
  sort_order: number
  day: string | null
  session_date: string | null
  type: string | null
  label: string | null
  is_rest: boolean
  is_key_session: boolean
  distance_km: number | null
  duration_min: number | null
  hr_zone: string | null
  hr_target: string | null
  rwr_ratio: string | null
  pace_run: string | null
  pace_walk: string | null
  guardrails: string[] | null
  important_notes: string[] | null
  session_structure: {
    warm_up?: string[]
    main_set?: { block_name: string; details: string[] }[]
    cool_down?: string[]
  } | null
  coach_notes: string | null
}

interface WeekForm {
  week_number: string
  phase_name: string
  period_start: string
  period_end: string
  volume_target_km: string
  duration_target: string
  rwr_default: string
  philosophy: string
  goal: string
}

interface SessionForm {
  sort_order: string
  day: string
  session_date: string
  type: string
  label: string
  is_rest: boolean
  is_key_session: boolean
  distance_km: string
  duration_min: string
  hr_zone: string
  hr_target: string
  rwr_ratio: string
  pace_run: string
  pace_walk: string
  guardrails: string
  important_notes: string
  warm_up: string
  main_set: string
  cool_down: string
  coach_notes: string
}

const WEEK_BLANK: WeekForm = {
  week_number: '', phase_name: '', period_start: '', period_end: '',
  volume_target_km: '', duration_target: '', rwr_default: '',
  philosophy: '', goal: ''
}

const SESSION_BLANK: SessionForm = {
  sort_order: '', day: '', session_date: '', type: 'Easy RWR', label: '',
  is_rest: false, is_key_session: false,
  distance_km: '', duration_min: '', hr_zone: '', hr_target: '',
  rwr_ratio: '', pace_run: '', pace_walk: '',
  guardrails: '', important_notes: '',
  warm_up: '', main_set: '', cool_down: '',
  coach_notes: ''
}

const SESSION_TYPES = [
  'Easy RWR', 'Easy RWR + Strides', 'Easy RWR + Form Drills',
  'Long Run', 'Tempo', 'Interval / VO2max',
  'Active Recovery', 'Rest', 'Race', 'Test'
]

const DAY_OPTIONS = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Ahad']

const TYPE_COLORS: Record<string, string> = {
  'Long Run': '#ef4444', 'Tempo': '#f97316', 'Interval / VO2max': '#f59e0b',
  'Easy RWR': '#22c55e', 'Easy RWR + Strides': '#22c55e', 'Easy RWR + Form Drills': '#22c55e',
  'Active Recovery': '#10b981', 'Rest': '#9ca3af', 'Race': '#6366f1', 'Test': '#8b5cf6'
}

function getTypeColor(type: string | null): string {
  if (!type) return '#6366f1'
  return Object.entries(TYPE_COLORS).find(([k]) => type.includes(k))?.[1] || '#6366f1'
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function parseLines(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(Boolean)
}

function joinLines(arr: string[] | null): string {
  return (arr || []).join('\n')
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProgramPage() {
  const [athleteId, setAthleteId]     = useState<string | null>(null)
  const [roles, setRoles]             = useState<string[]>([])
  const [races, setRaces]             = useState<Race[]>([])
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const [weeks, setWeeks]             = useState<ProgramWeek[]>([])
  const [selectedWeekId, setSelectedWeekId] = useState<string>('')
  const [sessions, setSessions]       = useState<ProgramSession[]>([])
  const [loading, setLoading]         = useState(true)
  const [toast, setToast]             = useState<{ msg: string; ok: boolean } | null>(null)

  // Modals
  const [weekModal, setWeekModal]     = useState<{ open: boolean; editing: ProgramWeek | null }>({ open: false, editing: null })
  const [sessionModal, setSessionModal] = useState<{ open: boolean; editing: ProgramSession | null; weekId: string }>({ open: false, editing: null, weekId: '' })
  const [weekForm, setWeekForm]       = useState<WeekForm>(WEEK_BLANK)
  const [sessionForm, setSessionForm] = useState<SessionForm>(SESSION_BLANK)
  const [notesModal, setNotesModal]   = useState<{ open: boolean; session: ProgramSession | null }>({ open: false, session: null })
  const [notesText, setNotesText]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canEdit = roles.includes('coach') || roles.includes('admin')
  const selectedWeek = weeks.find(w => w.id === selectedWeekId) || null
  const selectedRace = races.find(r => r.id === selectedRaceId) || null
  const isArchived = selectedRace?.status === 'done'

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

      setLoading(false)
    }
    init()
  }, [])

  // ── Load weeks when race changes ──
  useEffect(() => {
    if (!selectedRaceId || !athleteId) { setWeeks([]); setSelectedWeekId(''); setSessions([]); return }
    loadWeeks(selectedRaceId, athleteId)
  }, [selectedRaceId, athleteId])

  async function loadWeeks(raceId: string, athId: string) {
    const { data } = await (supabase as any)
      .from('program_weeks').select('*')
      .eq('athlete_id', athId)
      .eq('race_id', raceId)
      .order('week_number')
    const wList: ProgramWeek[] = data || []
    setWeeks(wList)

    // Auto-select current week by date
    const todayStr = new Date().toISOString().slice(0, 10)
    const current = wList.find(w => w.period_start && w.period_end && todayStr >= w.period_start && todayStr <= w.period_end)
    const upcoming = wList.find(w => w.period_end && todayStr <= w.period_end)
    const auto = current || upcoming || wList[0]
    if (auto) {
      setSelectedWeekId(auto.id)
      loadSessions(auto.id)
    } else {
      setSelectedWeekId('')
      setSessions([])
    }
  }

  // ── Load sessions when week changes ──
  async function loadSessions(weekId: string) {
    const { data } = await (supabase as any)
      .from('program_sessions').select('*')
      .eq('week_id', weekId)
      .order('sort_order')
    setSessions(data || [])
  }

  function handleWeekSelect(weekId: string) {
    setSelectedWeekId(weekId)
    if (weekId) loadSessions(weekId)
    else setSessions([])
  }

  // ── Week CRUD ──
  function openWeekModal(editing: ProgramWeek | null) {
    if (editing) {
      setWeekForm({
        week_number: String(editing.week_number),
        phase_name: editing.phase_name || '',
        period_start: editing.period_start || '',
        period_end: editing.period_end || '',
        volume_target_km: editing.volume_target_km != null ? String(editing.volume_target_km) : '',
        duration_target: editing.duration_target || '',
        rwr_default: editing.rwr_default || '',
        philosophy: editing.philosophy || '',
        goal: editing.goal || ''
      })
    } else {
      const nextWeek = weeks.length ? Math.max(...weeks.map(w => w.week_number)) + 1 : 1
      setWeekForm({ ...WEEK_BLANK, week_number: String(nextWeek) })
    }
    setWeekModal({ open: true, editing })
  }

  async function saveWeek() {
    if (!selectedRaceId || !athleteId) return
    if (!weekForm.week_number) { showToast('Nomor minggu wajib diisi', false); return }
    setSaving(true)
    const payload = {
      race_id: selectedRaceId,
      athlete_id: athleteId,
      week_number: Number(weekForm.week_number),
      phase_name: weekForm.phase_name || null,
      period_start: weekForm.period_start || null,
      period_end: weekForm.period_end || null,
      volume_target_km: weekForm.volume_target_km ? Number(weekForm.volume_target_km) : null,
      duration_target: weekForm.duration_target || null,
      rwr_default: weekForm.rwr_default || null,
      philosophy: weekForm.philosophy || null,
      goal: weekForm.goal || null
    }
    try {
      if (weekModal.editing) {
        await (supabase as any).from('program_weeks').update(payload).eq('id', weekModal.editing.id)
        showToast('Minggu diperbarui')
      } else {
        await (supabase as any).from('program_weeks').insert(payload)
        showToast('Minggu ditambahkan')
      }
      setWeekModal({ open: false, editing: null })
      await loadWeeks(selectedRaceId, athleteId)
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteWeek(id: string) {
    if (!confirm('Hapus minggu ini beserta semua sesinya?')) return
    await (supabase as any).from('program_weeks').delete().eq('id', id)
    if (selectedWeekId === id) { setSelectedWeekId(''); setSessions([]) }
    await loadWeeks(selectedRaceId, athleteId!)
    showToast('Minggu dihapus')
  }

  // ── Session CRUD ──
  function openSessionModal(editing: ProgramSession | null) {
    if (editing) {
      setSessionForm({
        sort_order: String(editing.sort_order),
        day: editing.day || '',
        session_date: editing.session_date || '',
        type: editing.type || 'Easy RWR',
        label: editing.label || '',
        is_rest: editing.is_rest,
        is_key_session: editing.is_key_session,
        distance_km: editing.distance_km != null ? String(editing.distance_km) : '',
        duration_min: editing.duration_min != null ? String(editing.duration_min) : '',
        hr_zone: editing.hr_zone || '',
        hr_target: editing.hr_target || '',
        rwr_ratio: editing.rwr_ratio || '',
        pace_run: editing.pace_run || '',
        pace_walk: editing.pace_walk || '',
        guardrails: joinLines(editing.guardrails),
        important_notes: joinLines(editing.important_notes),
        warm_up: joinLines(editing.session_structure?.warm_up || []),
        main_set: editing.session_structure?.main_set?.map(b => `[${b.block_name}]\n${b.details.join('\n')}`).join('\n\n') || '',
        cool_down: joinLines(editing.session_structure?.cool_down || []),
        coach_notes: editing.coach_notes || ''
      })
    } else {
      const nextOrder = sessions.length ? Math.max(...sessions.map(s => s.sort_order)) + 1 : 0
      setSessionForm({ ...SESSION_BLANK, sort_order: String(nextOrder) })
    }
    setSessionModal({ open: true, editing, weekId: selectedWeekId })
  }

  function parseMainSet(raw: string): { block_name: string; details: string[] }[] {
    if (!raw.trim()) return []
    const blocks = raw.split(/\n\n+/)
    return blocks.map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      const firstLine = lines[0] || ''
      const blockName = firstLine.startsWith('[') && firstLine.endsWith(']')
        ? firstLine.slice(1, -1)
        : firstLine
      const details = firstLine.startsWith('[') ? lines.slice(1) : lines.slice(1)
      return { block_name: blockName, details }
    })
  }

  async function saveSession() {
    if (!selectedWeekId || !athleteId) return
    if (!sessionForm.label) { showToast('Label sesi wajib diisi', false); return }
    setSaving(true)

    const structure = {
      warm_up: parseLines(sessionForm.warm_up),
      main_set: parseMainSet(sessionForm.main_set),
      cool_down: parseLines(sessionForm.cool_down)
    }

    const payload = {
      week_id: selectedWeekId,
      athlete_id: athleteId,
      sort_order: Number(sessionForm.sort_order) || 0,
      day: sessionForm.day || null,
      session_date: sessionForm.session_date || null,
      type: sessionForm.type || null,
      label: sessionForm.label,
      is_rest: sessionForm.is_rest,
      is_key_session: sessionForm.is_key_session,
      distance_km: sessionForm.distance_km ? Number(sessionForm.distance_km) : null,
      duration_min: sessionForm.duration_min ? Number(sessionForm.duration_min) : null,
      hr_zone: sessionForm.hr_zone || null,
      hr_target: sessionForm.hr_target || null,
      rwr_ratio: sessionForm.rwr_ratio || null,
      pace_run: sessionForm.pace_run || null,
      pace_walk: sessionForm.pace_walk || null,
      guardrails: parseLines(sessionForm.guardrails).length ? parseLines(sessionForm.guardrails) : null,
      important_notes: parseLines(sessionForm.important_notes).length ? parseLines(sessionForm.important_notes) : null,
      session_structure: structure,
      coach_notes: sessionForm.coach_notes || null
    }

    try {
      if (sessionModal.editing) {
        await (supabase as any).from('program_sessions').update(payload).eq('id', sessionModal.editing.id)
        showToast('Sesi diperbarui')
      } else {
        await (supabase as any).from('program_sessions').insert(payload)
        showToast('Sesi ditambahkan')
      }
      setSessionModal({ open: false, editing: null, weekId: '' })
      await loadSessions(selectedWeekId)
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteSession(id: string) {
    if (!confirm('Hapus sesi ini?')) return
    await (supabase as any).from('program_sessions').delete().eq('id', id)
    await loadSessions(selectedWeekId)
    showToast('Sesi dihapus')
  }

  // ── Coach Notes ──
  function openNotesModal(session: ProgramSession) {
    setNotesModal({ open: true, session })
    setNotesText(session.coach_notes || '')
  }

  async function saveNotes() {
    if (!notesModal.session) return
    setSaving(true)
    try {
      await (supabase as any).from('program_sessions').update({ coach_notes: notesText || null }).eq('id', notesModal.session.id)
      await loadSessions(selectedWeekId)
      setNotesModal({ open: false, session: null })
      showToast('Catatan disimpan')
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  function toggleExpand(id: string) {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Week stats ──
  function weekStats(_w: ProgramWeek) {
    const nonRest = sessions.filter(s => !s.is_rest)
    const totalDist = nonRest.reduce((s, x) => s + (x.distance_km || 0), 0)
    const totalDur = nonRest.reduce((s, x) => s + (x.duration_min || 0), 0)
    return { nonRest: nonRest.length, totalDist, totalDur }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  const stats = selectedWeek ? weekStats(selectedWeek) : null

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
            <p className="text-xs text-gray-400 mt-0.5">Sesi latihan mingguan per race</p>
          </div>
          <select value={selectedRaceId} onChange={e => setSelectedRaceId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
            {races.length === 0 && <option value="">Belum ada race</option>}
            {races.map(r => (
              <option key={r.id} value={r.id}>
                {r.status === 'A' ? '🏆 ' : r.status === 'B' ? '🎯 ' : r.status === 'done' ? '✅ ' : '📅 '}
                {r.name} · {fmtDate(r.event_date)}{r.status === 'done' ? ' (Arsip)' : ''}
              </option>
            ))}
          </select>
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
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

          {/* ── LEFT: Week List ── */}
          <div className="space-y-3">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-gsans text-base text-indigo-700 uppercase">Minggu</h2>
                {canEdit && !isArchived && (
                  <button onClick={() => openWeekModal(null)}
                    className="border border-indigo-500 text-indigo-600 text-xs px-2 py-1 rounded-lg hover:bg-indigo-50">+ Tambah</button>
                )}
              </div>

              {weeks.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-xs">
                  <div className="text-3xl mb-2">📅</div>
                  <div>Belum ada minggu.</div>
                  {canEdit && !isArchived && <div className="mt-1">Klik + Tambah untuk mulai.</div>}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {weeks.map(w => {
                    const isSelected = w.id === selectedWeekId
                    const todayStr = new Date().toISOString().slice(0, 10)
                    const isActive = w.period_start && w.period_end && todayStr >= w.period_start && todayStr <= w.period_end
                    return (
                      <div key={w.id}
                        onClick={() => handleWeekSelect(w.id)}
                        className={`rounded-lg px-3 py-2.5 cursor-pointer border transition-all ${isSelected ? 'bg-indigo-50 border-indigo-400' : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>W{w.week_number}</span>
                            {isActive && <span className="text-[9px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded-full">AKTIF</span>}
                          </div>
                          {canEdit && !isArchived && (
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                              <button onClick={() => openWeekModal(w)} className="text-indigo-400 hover:text-indigo-600 text-xs px-1">✏️</button>
                              <button onClick={() => deleteWeek(w.id)} className="text-red-300 hover:text-red-500 text-xs px-1">🗑️</button>
                            </div>
                          )}
                        </div>
                        {w.phase_name && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{w.phase_name}</div>}
                        {w.period_start && <div className="text-[10px] text-gray-400 mt-0.5">{fmtDate(w.period_start)}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Edit/Delete week buttons when selected */}
            {selectedWeek && canEdit && !isArchived && (
              <div className="bg-white rounded-xl shadow-sm p-3 flex gap-2">
                <button onClick={() => openWeekModal(selectedWeek)}
                  className="flex-1 border border-indigo-500 text-indigo-600 text-xs py-1.5 rounded-lg hover:bg-indigo-50">✏️ Edit Minggu</button>
                <button onClick={() => deleteWeek(selectedWeek.id)}
                  className="flex-1 border border-red-200 text-red-500 text-xs py-1.5 rounded-lg hover:bg-red-50">🗑️ Hapus</button>
              </div>
            )}
          </div>

          {/* ── RIGHT: Week Detail ── */}
          <div className="space-y-4">
            {!selectedWeekId ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">
                <div className="text-4xl mb-3">📋</div>
                <div>Pilih minggu untuk melihat sesi latihan</div>
              </div>
            ) : (
              <>
                {/* Week Summary */}
                {selectedWeek && (
                  <div className="bg-white rounded-xl shadow-sm p-5">
                    <div className="flex items-start justify-between flex-wrap gap-2 mb-3">
                      <div>
                        <h2 className="font-gsans text-lg text-indigo-700">Minggu {selectedWeek.week_number}
                          {selectedWeek.phase_name && <span className="text-sm text-gray-400 ml-2 font-normal normal-case">— {selectedWeek.phase_name}</span>}
                        </h2>
                        {selectedWeek.period_start && (
                          <div className="text-xs text-gray-400 mt-0.5">{fmtDate(selectedWeek.period_start)} → {fmtDate(selectedWeek.period_end)}</div>
                        )}
                      </div>
                    </div>

                    {/* Stats strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-gray-500 uppercase mb-0.5">Sesi</div>
                        <div className="text-sm font-bold text-gray-800">{stats?.nonRest ?? 0}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-gray-500 uppercase mb-0.5">Volume</div>
                        <div className="text-sm font-bold text-gray-800">
                          {stats?.totalDist ? `~${stats.totalDist.toFixed(1)} km` : (selectedWeek.volume_target_km ? `${selectedWeek.volume_target_km} km` : '—')}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-gray-500 uppercase mb-0.5">Durasi</div>
                        <div className="text-sm font-bold text-gray-800">
                          {stats?.totalDur ? `~${stats.totalDur} mnt` : (selectedWeek.duration_target || '—')}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-gray-500 uppercase mb-0.5">RWR Default</div>
                        <div className="text-sm font-bold text-indigo-600">{selectedWeek.rwr_default || '—'}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-xs font-medium text-gray-500 uppercase mb-0.5">Target Volume</div>
                        <div className="text-sm font-bold text-gray-800">{selectedWeek.volume_target_km ? `${selectedWeek.volume_target_km} km` : '—'}</div>
                      </div>
                    </div>

                    {/* Philosophy / Goal */}
                    {(selectedWeek.philosophy || selectedWeek.goal) && (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 text-xs text-indigo-800 space-y-1">
                        {selectedWeek.philosophy && <div><span className="font-bold">💡 Filosofi:</span> {selectedWeek.philosophy}</div>}
                        {selectedWeek.goal && <div><span className="font-bold">🎯 Tujuan:</span> {selectedWeek.goal}</div>}
                      </div>
                    )}
                  </div>
                )}

                {/* Sessions */}
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 flex-1">Sesi Latihan</h2>
                    {canEdit && !isArchived && (
                      <button onClick={() => openSessionModal(null)}
                        className="ml-3 border border-indigo-500 text-indigo-600 text-xs px-3 py-1 rounded-lg hover:bg-indigo-50 flex-shrink-0">+ Tambah Sesi</button>
                    )}
                  </div>

                  {sessions.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">
                      <div className="text-4xl mb-3">🏃</div>
                      <div>Belum ada sesi. {canEdit && !isArchived ? 'Tambah sesi pertama.' : ''}</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sessions.map(s => {
                        const color = getTypeColor(s.type)
                        const expanded = expandedSessions.has(s.id)
                        const hasStructure = !!(
                          s.session_structure?.warm_up?.length ||
                          s.session_structure?.main_set?.length ||
                          s.session_structure?.cool_down?.length ||
                          s.guardrails?.length ||
                          s.important_notes?.length
                        )

                        if (s.is_rest) return (
                          <div key={s.id} className="rounded-xl border border-gray-100 p-3 flex items-center justify-between opacity-60">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">😴</span>
                              <div>
                                <div className="text-sm font-bold text-gray-500">{s.day ? `${s.day} — ` : ''}{s.label || 'Full Rest'}</div>
                                {s.session_date && <div className="text-xs text-gray-400">{fmtDate(s.session_date)}</div>}
                              </div>
                            </div>
                            {canEdit && !isArchived && (
                              <div className="flex gap-1">
                                <button onClick={() => openSessionModal(s)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                <button onClick={() => deleteSession(s.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                              </div>
                            )}
                          </div>
                        )

                        return (
                          <div key={s.id} className="rounded-xl border overflow-hidden" style={{ borderColor: '#e5e7eb', borderLeftWidth: 4, borderLeftColor: color }}>
                            <div className="p-4">
                              {/* Header */}
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-full" style={{ background: color }}>{s.type || 'Sesi'}</span>
                                    {s.is_key_session && <span className="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">⭐ KEY SESSION</span>}
                                  </div>
                                  <div className="text-sm font-bold text-gray-800">{s.label}</div>
                                  <div className="text-xs text-gray-400 mt-0.5">
                                    {s.day}{s.day && s.session_date ? ', ' : ''}{s.session_date ? fmtDate(s.session_date) : ''}
                                  </div>
                                </div>

                                {/* Stats chips */}
                                <div className="flex gap-3 flex-wrap text-center text-xs">
                                  {s.distance_km != null && (
                                    <div><div className="font-bold text-gray-700">{s.distance_km} km</div><div className="text-gray-400 text-[10px]">📍 Jarak</div></div>
                                  )}
                                  {s.duration_min != null && (
                                    <div><div className="font-bold text-gray-700">{s.duration_min}'</div><div className="text-gray-400 text-[10px]">⏱ Durasi</div></div>
                                  )}
                                  {s.hr_zone && (
                                    <div><div className="font-bold text-gray-700">{s.hr_zone}</div><div className="text-gray-400 text-[10px]">💓 Zone</div></div>
                                  )}
                                  {s.hr_target && (
                                    <div><div className="font-bold" style={{ color }}>{s.hr_target}</div><div className="text-gray-400 text-[10px]">🎯 HR</div></div>
                                  )}
                                  {s.rwr_ratio && (
                                    <div><div className="font-bold text-indigo-600">{s.rwr_ratio}</div><div className="text-gray-400 text-[10px]">🔄 RWR</div></div>
                                  )}
                                </div>
                              </div>

                              {/* Pace strip */}
                              {(s.pace_run || s.pace_walk) && (
                                <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                                  {s.pace_run && <span>🏃 Pace run: <strong>{s.pace_run}</strong></span>}
                                  {s.pace_run && s.pace_walk && <span className="mx-2 text-gray-300">|</span>}
                                  {s.pace_walk && <span>🚶 Walk: <strong>{s.pace_walk}</strong></span>}
                                </div>
                              )}

                              {/* Coach notes preview */}
                              {s.coach_notes && (
                                <div className="mt-2 text-xs text-gray-600 leading-relaxed line-clamp-2">{s.coach_notes}</div>
                              )}

                              {/* Expand / action row */}
                              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex gap-2">
                                  {hasStructure && (
                                    <button onClick={() => toggleExpand(s.id)}
                                      className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1 hover:bg-gray-50 flex items-center gap-1">
                                      {expanded ? '▲ Tutup Detail' : '▼ Lihat Detail'}
                                    </button>
                                  )}
                                  {canEdit && (
                                    <button onClick={() => openNotesModal(s)}
                                      className="text-xs border border-indigo-200 text-indigo-600 rounded-lg px-3 py-1 hover:bg-indigo-50">
                                      {s.coach_notes ? '✏️ Edit Catatan' : '+ Catatan'}
                                    </button>
                                  )}
                                </div>
                                {canEdit && !isArchived && (
                                  <div className="flex gap-1">
                                    <button onClick={() => openSessionModal(s)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                    <button onClick={() => deleteSession(s.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                                  </div>
                                )}
                              </div>

                              {/* Expanded detail */}
                              {expanded && (
                                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                                  {s.session_structure?.warm_up && s.session_structure.warm_up.length > 0 && (
                                    <div>
                                      <div className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide mb-1">🔥 Warm-Up</div>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {s.session_structure.warm_up.map((item, i) => <li key={i} className="text-xs text-gray-600">{item}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {s.session_structure?.main_set && s.session_structure.main_set.length > 0 && (
                                    <div>
                                      {s.session_structure.main_set.map((block, i) => (
                                        <div key={i} className="mb-2">
                                          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">⚡ {block.block_name}</div>
                                          <ul className="list-disc list-inside space-y-0.5">
                                            {block.details.map((d, j) => <li key={j} className="text-xs text-gray-600">{d}</li>)}
                                          </ul>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {s.session_structure?.cool_down && s.session_structure.cool_down.length > 0 && (
                                    <div>
                                      <div className="text-[11px] font-bold text-indigo-500 uppercase tracking-wide mb-1">🧊 Cool-Down</div>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {s.session_structure.cool_down.map((item, i) => <li key={i} className="text-xs text-gray-600">{item}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {s.guardrails && s.guardrails.length > 0 && (
                                    <div className="bg-red-50 border-l-4 border-red-400 rounded-r-lg px-3 py-2">
                                      <div className="text-[11px] font-bold text-red-600 uppercase tracking-wide mb-1">🚨 Guardrails</div>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {s.guardrails.map((g, i) => <li key={i} className="text-xs text-red-700">{g}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                  {s.important_notes && s.important_notes.length > 0 && (
                                    <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-lg px-3 py-2">
                                      <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wide mb-1">📌 Catatan Penting</div>
                                      <ul className="list-disc list-inside space-y-0.5">
                                        {s.important_notes.map((n, i) => <li key={i} className="text-xs text-amber-800">{n}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Week Modal ── */}
      {weekModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{weekModal.editing ? 'Edit Minggu' : 'Tambah Minggu'}</h3>
              <button onClick={() => setWeekModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Nomor Minggu *</div>
                  <input type="number" value={weekForm.week_number} onChange={e => setWeekForm(f => ({ ...f, week_number: e.target.value }))}
                    placeholder="1" min={1} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Nama Fase</div>
                  <input value={weekForm.phase_name} onChange={e => setWeekForm(f => ({ ...f, phase_name: e.target.value }))}
                    placeholder="cth. Base 1, Build 2..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal Mulai</div>
                  <input type="date" value={weekForm.period_start} onChange={e => setWeekForm(f => ({ ...f, period_start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal Selesai</div>
                  <input type="date" value={weekForm.period_end} onChange={e => setWeekForm(f => ({ ...f, period_end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Target Volume (km)</div>
                  <input type="number" step="0.1" value={weekForm.volume_target_km} onChange={e => setWeekForm(f => ({ ...f, volume_target_km: e.target.value }))}
                    placeholder="40" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Target Durasi</div>
                  <input value={weekForm.duration_target} onChange={e => setWeekForm(f => ({ ...f, duration_target: e.target.value }))}
                    placeholder="cth. 300 mnt" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">RWR Default</div>
                  <input value={weekForm.rwr_default} onChange={e => setWeekForm(f => ({ ...f, rwr_default: e.target.value }))}
                    placeholder="cth. 60:30" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Filosofi Minggu</div>
                <input value={weekForm.philosophy} onChange={e => setWeekForm(f => ({ ...f, philosophy: e.target.value }))}
                  placeholder="cth. Bangun aerobic base, easy dominan" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tujuan Minggu</div>
                <input value={weekForm.goal} onChange={e => setWeekForm(f => ({ ...f, goal: e.target.value }))}
                  placeholder="cth. Establish HR baseline, toleransi RWR" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setWeekModal({ open: false, editing: null })} className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveWeek} disabled={saving} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Modal ── */}
      {sessionModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{sessionModal.editing ? 'Edit Sesi' : 'Tambah Sesi'}</h3>
              <button onClick={() => setSessionModal({ open: false, editing: null, weekId: '' })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">

              {/* Rest toggle */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sessionForm.is_rest} onChange={e => setSessionForm(f => ({ ...f, is_rest: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-gray-700">Rest Day 😴</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={sessionForm.is_key_session} onChange={e => setSessionForm(f => ({ ...f, is_key_session: e.target.checked }))} className="rounded" />
                  <span className="text-sm text-gray-700">⭐ Key Session</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tipe Sesi</div>
                  <select value={sessionForm.type} onChange={e => setSessionForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {SESSION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Label Sesi *</div>
                  <input value={sessionForm.label} onChange={e => setSessionForm(f => ({ ...f, label: e.target.value }))}
                    placeholder="cth. Easy RWR 8km, Long Run #1" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Hari</div>
                  <select value={sessionForm.day} onChange={e => setSessionForm(f => ({ ...f, day: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    <option value="">— Pilih —</option>
                    {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal</div>
                  <input type="date" value={sessionForm.session_date} onChange={e => setSessionForm(f => ({ ...f, session_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Urutan</div>
                  <input type="number" value={sessionForm.sort_order} onChange={e => setSessionForm(f => ({ ...f, sort_order: e.target.value }))}
                    placeholder="0" min={0} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>

              {!sessionForm.is_rest && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">Jarak (km)</div>
                      <input type="number" step="0.1" value={sessionForm.distance_km} onChange={e => setSessionForm(f => ({ ...f, distance_km: e.target.value }))}
                        placeholder="8.0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">Durasi (mnt)</div>
                      <input type="number" value={sessionForm.duration_min} onChange={e => setSessionForm(f => ({ ...f, duration_min: e.target.value }))}
                        placeholder="60" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Zone</div>
                      <input value={sessionForm.hr_zone} onChange={e => setSessionForm(f => ({ ...f, hr_zone: e.target.value }))}
                        placeholder="Z1-Z2" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Target</div>
                      <input value={sessionForm.hr_target} onChange={e => setSessionForm(f => ({ ...f, hr_target: e.target.value }))}
                        placeholder="135-145 bpm" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">RWR Ratio</div>
                      <input value={sessionForm.rwr_ratio} onChange={e => setSessionForm(f => ({ ...f, rwr_ratio: e.target.value }))}
                        placeholder="60:30" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">Pace Run</div>
                      <input value={sessionForm.pace_run} onChange={e => setSessionForm(f => ({ ...f, pace_run: e.target.value }))}
                        placeholder="7:30/km" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">Pace Walk</div>
                      <input value={sessionForm.pace_walk} onChange={e => setSessionForm(f => ({ ...f, pace_walk: e.target.value }))}
                        placeholder="10:00/km" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  </div>

                  {/* Structure */}
                  <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50">
                    <div className="text-xs font-bold text-gray-500 uppercase">Struktur Sesi</div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">🔥 Warm-Up <span className="text-gray-300 font-normal normal-case">(1 baris = 1 item)</span></div>
                      <textarea value={sessionForm.warm_up} onChange={e => setSessionForm(f => ({ ...f, warm_up: e.target.value }))}
                        placeholder={"4 min Jalan Cepat\n3 min Jog Ringan"} rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">⚡ Main Set <span className="text-gray-300 font-normal normal-case">([Nama Block] lalu detail, pisah blok dgn baris kosong)</span></div>
                      <textarea value={sessionForm.main_set} onChange={e => setSessionForm(f => ({ ...f, main_set: e.target.value }))}
                        placeholder={"[Block A: RWR 60:30]\n60 detik Run\n30 detik Walk\n\n[Block B: Strides]\n4× 20 detik stride"} rows={5}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">🧊 Cool-Down <span className="text-gray-300 font-normal normal-case">(1 baris = 1 item)</span></div>
                      <textarea value={sessionForm.cool_down} onChange={e => setSessionForm(f => ({ ...f, cool_down: e.target.value }))}
                        placeholder={"3 min Jog\n2 min Jalan\nStretching 5 mnt"} rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none bg-white" />
                    </div>
                  </div>

                  {/* Guardrails & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">🚨 Guardrails <span className="text-gray-300 font-normal normal-case">(1 baris = 1 item)</span></div>
                      <textarea value={sessionForm.guardrails} onChange={e => setSessionForm(f => ({ ...f, guardrails: e.target.value }))}
                        placeholder={"Jika HR >155 bpm, turunkan pace\nStop jika nyeri lutut"} rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">📌 Catatan Penting <span className="text-gray-300 font-normal normal-case">(1 baris = 1 item)</span></div>
                      <textarea value={sessionForm.important_notes} onChange={e => setSessionForm(f => ({ ...f, important_notes: e.target.value }))}
                        placeholder={"Pre-run fueling: 1 pisang + air\nBawa gel untuk >60 mnt"} rows={3}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
                    </div>
                  </div>
                </>
              )}

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan Coach</div>
                <textarea value={sessionForm.coach_notes} onChange={e => setSessionForm(f => ({ ...f, coach_notes: e.target.value }))}
                  placeholder="Catatan khusus dari coach untuk sesi ini..." rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setSessionModal({ open: false, editing: null, weekId: '' })} className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveSession} disabled={saving} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Coach Notes Modal ── */}
      {notesModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">Catatan Coach — {notesModal.session?.label}</h3>
              <button onClick={() => setNotesModal({ open: false, session: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5">
              <textarea value={notesText} onChange={e => setNotesText(e.target.value)}
                placeholder={"Tulis catatan coaching detail di sini...\nContoh:\n## Tujuan Sesi\n- HR guardrail: jika >155 stop\n- Focus: form dan ritme RWR"}
                rows={10}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setNotesModal({ open: false, session: null })} className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveNotes} disabled={saving} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan Catatan'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
