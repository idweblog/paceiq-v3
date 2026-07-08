import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface Race { id: string; name: string; event_date: string; status: string }

interface ProgramSession {
  id: string; athlete_id: string; race_id: string
  session_date: string; program_type: string; notes: string | null
  details?: SessionDetail[]
}

interface SessionDetail {
  id: string; session_id: string; athlete_id: string; sort_order: number
  zone_name: string; repetitions: number; unit: string
  value_input: number | null; distance_per_rep: number | null
  distance_km: number | null; est_duration_min: number | null
  vcr_snapshot: number | null
}

interface PaceZone {
  name: string; label: string; pct_min: number; pct_max: number
  pace_min_sec: number; pace_max_sec: number; color: string
}

interface WeekGroup {
  week_number: number; period_start: string; period_end: string
  sessions: ProgramSession[]; total_km: number
}

interface SessionForm {
  session_date: string; program_type: string; notes: string
  details: DetailForm[]
}

interface DetailForm {
  zone_name: string; repetitions: string; unit: string; value_input: string
}

const PROGRAM_TYPES = [
  'EASY RUN (EZ)', 'LONGRUN (LR)', 'MEDIUM RUN (MD-R)', 'FARTLEK (SPEED PLAY)',
  'SUB-TEMPO (SPEED)', 'TEMPO RUN (SPEED)', 'SUB-THRESHOLD RUN (SPEED)',
  'THRESHOLD RUN (SPEED)', 'SUPRA-THRESHOLD RUN (SPEED)', 'SPECIFIC LONGRUN (S-LR)',
  'MIXED PACE (SPEED)', 'VCR TEST / TIME TRIAL', 'RACE DAY',
  'STRENGTH - (SENIN)', 'RUNNING DRILLS - (Kamis)', 'ST / RD (Mandiri)',
]

const ZONE_DEFINITIONS = [
  { name: 'Recovery',      label: 'Recovery',     pct_min: 0.64, pct_max: 0.68, color: '#94a3b8' },
  { name: 'Long Run',      label: 'Long Run',      pct_min: 0.69, pct_max: 0.71, color: '#60a5fa' },
  { name: 'Easy',          label: 'Easy',          pct_min: 0.74, pct_max: 0.76, color: '#34d399' },
  { name: 'Moderate',      label: 'Moderate',      pct_min: 0.83, pct_max: 0.85, color: '#a3e635' },
  { name: 'Tempo',         label: 'Tempo',         pct_min: 0.88, pct_max: 0.90, color: '#fbbf24' },
  { name: 'Threshold',     label: 'Threshold',     pct_min: 0.92, pct_max: 0.94, color: '#f97316' },
  { name: 'Aerobic Power', label: 'Aerobic Power', pct_min: 1.00, pct_max: 1.02, color: '#ef4444' },
  { name: 'VO2Max',        label: 'VO₂Max',        pct_min: 1.03, pct_max: 1.05, color: '#dc2626' },
  { name: 'Anaerob',       label: 'Anaerob',       pct_min: 1.09, pct_max: 1.15, color: '#7c3aed' },
]

const DETAIL_BLANK: DetailForm = { zone_name: 'Easy', repetitions: '1', unit: 'km', value_input: '' }
const SESSION_BLANK: SessionForm = { session_date: '', program_type: 'EASY RUN (EZ)', notes: '', details: [{ ...DETAIL_BLANK }] }

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateShort(d: string) {
  return new Date(d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}
function secToMMSS(sec: number): string {
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
function fmtDuration(min: number): string {
  if (min < 1) return `${Math.round(min * 60)} dtk`
  if (min < 60) return `${Math.round(min)} mnt`
  const h = Math.floor(min / 60); const m = Math.round(min % 60)
  return m > 0 ? `${h}j ${m}mnt` : `${h}j`
}
function toYMD(d: Date): string { return d.toISOString().slice(0, 10) }
function groupByWeek(sessions: ProgramSession[]): WeekGroup[] {
  if (!sessions.length) return []
  const sorted = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
  // Anchor = first session date itself (not rolled back to Monday)
  const anchorMs = new Date(sorted[0].session_date).getTime()
  const weekMap: Map<number, WeekGroup> = new Map()
  sessions.forEach(s => {
    const sessMs = new Date(s.session_date).getTime()
    const wn = Math.floor((sessMs - anchorMs) / (7 * 86400000)) + 1
    if (!weekMap.has(wn)) {
      const start = new Date(anchorMs + (wn - 1) * 7 * 86400000)
      const end   = new Date(start.getTime() + 6 * 86400000)
      weekMap.set(wn, { week_number: wn, period_start: toYMD(start), period_end: toYMD(end), sessions: [], total_km: 0 })
    }
    weekMap.get(wn)!.sessions.push(s)
  })
  weekMap.forEach(wg => {
    wg.sessions.sort((a, b) => a.session_date.localeCompare(b.session_date))
    wg.total_km = wg.sessions.reduce((sum, s) =>
      sum + (s.details || []).reduce((ds, d) => ds + (d.distance_km || 0), 0), 0)
  })
  return Array.from(weekMap.values()).sort((a, b) => a.week_number - b.week_number)
}

export default function ProgramPage() {
  const [athleteId, setAthleteId]   = useState<string | null>(null)
  const [roles, setRoles]           = useState<string[]>([])
  const [races, setRaces]           = useState<Race[]>([])
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const [sessions, setSessions]     = useState<ProgramSession[]>([])
  const [paceZones, setPaceZones]   = useState<PaceZone[]>([])
  const [vcr, setVcr]               = useState<number>(0)
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [sessionModal, setSessionModal] = useState<{ open: boolean; editing: ProgramSession | null }>({ open: false, editing: null })
  const [sessionForm, setSessionForm]   = useState<SessionForm>(SESSION_BLANK)
  const [detailForms, setDetailForms]   = useState<Record<string, DetailForm[]>>({})
  const [savingDetail, setSavingDetail] = useState<string | null>(null)
  const [saving, setSaving]             = useState(false)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canEdit      = roles.includes('coach') || roles.includes('admin')
  const selectedRace = races.find(r => r.id === selectedRaceId) || null
  const isArchived   = selectedRace?.status === 'done'

  function toggleSession(id: string) {
    setExpandedSessions(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

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
        .from('races').select('id,name,event_date,status').eq('athlete_id', ath.id).order('event_date', { ascending: true })
      const raceList: Race[] = raceRows || []
      setRaces(raceList)
      const auto = raceList.find(r => r.status === 'A') || raceList.find(r => r.status !== 'done') || raceList[0]
      if (auto) setSelectedRaceId(auto.id)
      await loadPaceZones(ath.id)
      setLoading(false)
    }
    init()
  }, [])

  async function loadPaceZones(athId: string) {
    const { data: tt } = await (supabase as any)
      .from('tt_history').select('distance_km,finish_time_sec')
      .eq('athlete_id', athId).order('tt_date', { ascending: false }).limit(1).single()
    const vcrVal: number = (tt?.distance_km && tt?.finish_time_sec) ? (tt.distance_km * 1000) / tt.finish_time_sec : 0
    setVcr(vcrVal)
    if (!vcrVal) { setPaceZones([]); return }
    setPaceZones(ZONE_DEFINITIONS.map(z => ({
      ...z,
      pace_min_sec: 1000 / (vcrVal * z.pct_max),
      pace_max_sec: 1000 / (vcrVal * z.pct_min)
    })))
  }

  useEffect(() => {
    if (!selectedRaceId || !athleteId) { setSessions([]); return }
    loadSessions(selectedRaceId, athleteId)
  }, [selectedRaceId, athleteId])

  async function loadSessions(raceId: string, athId: string) {
    const { data: sessRows } = await (supabase as any)
      .from('program_sessions').select('*').eq('race_id', raceId).eq('athlete_id', athId).order('session_date')
    const sessList: ProgramSession[] = sessRows || []
    if (sessList.length) {
      const ids = sessList.map(s => s.id)
      const { data: detailRows } = await (supabase as any)
        .from('program_session_details').select('*').in('session_id', ids).order('sort_order')
      const detailMap: Record<string, SessionDetail[]> = {}
      ;(detailRows || []).forEach((d: SessionDetail) => {
        if (!detailMap[d.session_id]) detailMap[d.session_id] = []
        detailMap[d.session_id].push(d)
      })
      sessList.forEach(s => { s.details = detailMap[s.id] || [] })
    }
    setSessions(sessList)
    const weeks = groupByWeek(sessList)
    if (weeks.length) {
      const t = new Date().toISOString().slice(0, 10)
      const cur = weeks.find(w => t >= w.period_start && t <= w.period_end)
      const upk = weeks.find(w => w.period_end >= t)
      setSelectedWeek((cur || upk || weeks[0]).week_number)
    }
  }

  function getZone(name: string): PaceZone | null { return paceZones.find(z => z.name === name) || null }

  // Pace range dari VCR tertentu (untuk frozen display dari vcr_snapshot)
  function paceRangeFromVcr(zoneName: string, vcrVal: number): { min: number; max: number } | null {
    const zd = ZONE_DEFINITIONS.find(z => z.name === zoneName)
    if (!zd || !vcrVal) return null
    return { min: 1000 / (vcrVal * zd.pct_max), max: 1000 / (vcrVal * zd.pct_min) }
  }

  // Pace string untuk detail yang sudah tersimpan — pakai vcr_snapshot jika ada, fallback ke live
  function detPaceStr(det: SessionDetail): string {
    const vcrUsed = det.vcr_snapshot || vcr
    if (!vcrUsed) return '—'
    const range = paceRangeFromVcr(det.zone_name, vcrUsed)
    return range ? `${secToMMSS((range.min + range.max) / 2)}/km` : '—'
  }

  // Core calc: given zone, rep, unit, value → { distPerRep, totalKm, totalMin }
  function calcDetail(zoneName: string, rep: number, unit: string, val: number | null): { distPerRep: number; totalKm: number; totalMin: number } | null {
    if (!val || !rep) return null
    const zone = getZone(zoneName)
    const avgPaceSec = zone ? (zone.pace_min_sec + zone.pace_max_sec) / 2 : 0
    if (unit === 'km') {
      const totalKm = rep * val
      return { distPerRep: val, totalKm, totalMin: avgPaceSec > 0 ? (avgPaceSec * totalKm) / 60 : 0 }
    } else {
      const secPerRep = unit === 'menit' ? val * 60 : val
      const distPerRep = avgPaceSec > 0 ? secPerRep / avgPaceSec : 0
      return { distPerRep, totalKm: rep * distPerRep, totalMin: (rep * secPerRep) / 60 }
    }
  }

  function openSessionModal(editing: ProgramSession | null) {
    setSessionForm(editing
      ? { session_date: editing.session_date, program_type: editing.program_type, notes: editing.notes || '', details: [{ ...DETAIL_BLANK }] }
      : { ...SESSION_BLANK, session_date: new Date().toISOString().slice(0, 10) })
    setSessionModal({ open: true, editing })
  }

  async function saveSession() {
    if (!selectedRaceId || !athleteId) return
    if (!sessionForm.session_date) { showToast('Tanggal wajib diisi', false); return }
    const validDetails = sessionForm.details.filter(d => d.value_input && Number(d.value_input) > 0)
    setSaving(true)
    const payload = { athlete_id: athleteId, race_id: selectedRaceId, session_date: sessionForm.session_date, program_type: sessionForm.program_type, notes: sessionForm.notes || null }
    try {
      let sessionId: string
      if (sessionModal.editing) {
        await (supabase as any).from('program_sessions').update(payload).eq('id', sessionModal.editing.id)
        sessionId = sessionModal.editing.id
      } else {
        const { data: ns } = await (supabase as any).from('program_sessions').insert(payload).select().single()
        sessionId = ns.id
      }
      if (validDetails.length && sessionId) {
        const inserts = validDetails.map((d, i) => {
          const rep = Number(d.repetitions) || 1
          const val = Number(d.value_input)
          const out = calcDetail(d.zone_name, rep, d.unit, val)
          return { session_id: sessionId, athlete_id: athleteId, sort_order: i, zone_name: d.zone_name, repetitions: rep, unit: d.unit, value_input: val, distance_per_rep: out?.distPerRep ?? null, distance_km: out?.totalKm ?? null, est_duration_min: out?.totalMin ?? null, vcr_snapshot: vcr || null }
        })
        await (supabase as any).from('program_session_details').insert(inserts)
      }
      showToast(sessionModal.editing ? 'Sesi diperbarui' : 'Sesi ditambahkan')
      setSessionModal({ open: false, editing: null })
      await loadSessions(selectedRaceId, athleteId)
    } catch (e: any) { showToast('Gagal: ' + e.message, false) }
    finally { setSaving(false) }
  }

  async function deleteSession(id: string) {
    if (!confirm('Hapus sesi ini beserta semua detailnya?')) return
    await (supabase as any).from('program_sessions').delete().eq('id', id)
    await loadSessions(selectedRaceId, athleteId!)
    showToast('Sesi dihapus')
  }

  function initDetailForm(sessionId: string) {
    setDetailForms(prev => ({ ...prev, [sessionId]: [...(prev[sessionId] || []), { ...DETAIL_BLANK }] }))
  }
  function updateDetailForm(sessionId: string, idx: number, field: keyof DetailForm, value: string) {
    setDetailForms(prev => { const arr = [...(prev[sessionId] || [])]; arr[idx] = { ...arr[idx], [field]: value }; return { ...prev, [sessionId]: arr } })
  }
  function removeDetailForm(sessionId: string, idx: number) {
    setDetailForms(prev => { const arr = [...(prev[sessionId] || [])]; arr.splice(idx, 1); return { ...prev, [sessionId]: arr } })
  }

  async function saveDetails(session: ProgramSession) {
    if (!athleteId) return
    const forms = detailForms[session.id] || []
    if (!forms.length) return
    setSavingDetail(session.id)
    try {
      const base = session.details?.length || 0
      const inserts = forms.map((f, i) => {
        const rep = Number(f.repetitions) || 1
        const val = Number(f.value_input) || 0
        const out = calcDetail(f.zone_name, rep, f.unit, val || null)
        return { session_id: session.id, athlete_id: athleteId, sort_order: base + i, zone_name: f.zone_name, repetitions: rep, unit: f.unit, value_input: val || null, distance_per_rep: out?.distPerRep ?? null, distance_km: out?.totalKm ?? null, est_duration_min: out?.totalMin ?? null, vcr_snapshot: vcr || null }
      })
      await (supabase as any).from('program_session_details').insert(inserts)
      setDetailForms(prev => { const n = { ...prev }; delete n[session.id]; return n })
      await loadSessions(selectedRaceId, athleteId)
      showToast('Detail disimpan')
    } catch (e: any) { showToast('Gagal: ' + e.message, false) }
    finally { setSavingDetail(null) }
  }

  async function deleteDetail(id: string) {
    await (supabase as any).from('program_session_details').delete().eq('id', id)
    await loadSessions(selectedRaceId, athleteId!)
    showToast('Detail dihapus')
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  const weeks    = groupByWeek(sessions)
  const activeWk = weeks.find(w => w.week_number === selectedWeek) || null
  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Training Program</h1>
            <p className="text-xs text-gray-400 mt-0.5">Rencana latihan harian per race</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {paceZones.length > 0
              ? <div className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-600 px-3 py-1.5 rounded-lg">⚡ VCR aktif — pace zones terhitung</div>
              : <div className="text-xs bg-amber-50 border border-amber-200 text-amber-600 px-3 py-1.5 rounded-lg">⚠️ Belum ada data TT — est. waktu tidak tersedia</div>
            }
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

          {/* LEFT: Week sidebar */}
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
                    const isActive = todayStr >= w.period_start && todayStr <= w.period_end
                    const isSelected = w.week_number === selectedWeek
                    const isPast = todayStr > w.period_end
                    return (
                      <div key={w.week_number} onClick={() => setSelectedWeek(w.week_number)}
                        className={`rounded-lg px-3 py-2.5 cursor-pointer border transition-all ${isSelected ? 'bg-indigo-50 border-indigo-400' : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-gray-700'}`}>Pekan {w.week_number}</span>
                            {isActive && <span className="text-[9px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded-full">AKTIF</span>}
                            {isPast && !isActive && <span className="text-[9px] text-green-600">✓</span>}
                          </div>
                          <span className="text-[10px] text-gray-400 font-medium">{w.total_km.toFixed(1)} km</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{fmtDate(w.period_start)} — {fmtDate(w.period_end)}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{w.sessions.length} sesi</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
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
                    <div className="text-sm font-bold text-indigo-600">{weeks.reduce((s, w) => s + w.total_km, 0).toFixed(1)} km</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Week detail */}
          <div className="space-y-4">
            {!activeWk ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">
                <div className="text-4xl mb-3">📋</div>
                <div>Pilih pekan untuk melihat detail sesi</div>
              </div>
            ) : (
              <>
                {/* Week header with prev/next */}
                <div className="bg-white rounded-xl shadow-sm p-5">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      {/* Prev week */}
                      <button
                        onClick={() => { const idx = weeks.findIndex(w => w.week_number === activeWk.week_number); if (idx > 0) setSelectedWeek(weeks[idx-1].week_number) }}
                        disabled={weeks.findIndex(w => w.week_number === activeWk.week_number) === 0}
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                        ←
                      </button>
                      <div>
                        <h2 className="font-gsans text-lg text-indigo-700">
                          Pekan {activeWk.week_number}
                          {todayStr >= activeWk.period_start && todayStr <= activeWk.period_end && (
                            <span className="ml-2 text-xs font-normal text-white bg-indigo-500 px-2 py-0.5 rounded-full">AKTIF</span>
                          )}
                        </h2>
                        <div className="text-xs text-gray-400 mt-0.5">{fmtDate(activeWk.period_start)} — {fmtDate(activeWk.period_end)}</div>
                      </div>
                      {/* Next week */}
                      <button
                        onClick={() => { const idx = weeks.findIndex(w => w.week_number === activeWk.week_number); if (idx < weeks.length - 1) setSelectedWeek(weeks[idx+1].week_number) }}
                        disabled={weeks.findIndex(w => w.week_number === activeWk.week_number) === weeks.length - 1}
                        className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                        →
                      </button>
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
                      <div>
                        <button onClick={() => setExpandedSessions(prev => {
                          const allIds = new Set(activeWk.sessions.map(s => s.id))
                          const allExpanded = activeWk.sessions.every(s => prev.has(s.id))
                          if (allExpanded) return new Set([...prev].filter(id => !allIds.has(id)))
                          return new Set([...prev, ...allIds])
                        })} className="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-50 mt-1">
                          {activeWk.sessions.every(s => expandedSessions.has(s.id)) ? '▲ Tutup Semua' : '▼ Buka Semua'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Session cards */}
                <div className="space-y-2">
                  {activeWk.sessions.map(sess => {
                    const sessKm = (sess.details || []).reduce((s, d) => s + (d.distance_km || 0), 0)
                    const sessMin = (sess.details || []).reduce((s, d) => s + (d.est_duration_min || 0), 0)
                    const pendingForms = detailForms[sess.id] || []
                    const isExpanded = expandedSessions.has(sess.id)
                    return (
                      <div key={sess.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                        {/* Session header — always visible, click to expand */}
                        <div
                          className="px-5 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => toggleSession(sess.id)}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-gray-300 text-xs flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">{fmtDateShort(sess.session_date)}</div>
                              <div className="text-sm font-bold text-gray-800 truncate">{sess.program_type}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="text-right">
                              <div className="text-sm font-bold text-indigo-600">~{sessKm.toFixed(1)} km</div>
                              <div className="text-[10px] text-gray-400">{sessMin > 0 ? fmtDuration(sessMin) : '—'}</div>
                            </div>
                            {canEdit && !isArchived && (
                              <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                <button onClick={() => openSessionModal(sess)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                <button onClick={() => deleteSession(sess.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                              </div>
                            )}
                          </div>
                        </div>
                        {/* Expandable detail */}
                        {isExpanded && <div className="border-t border-gray-100">

                        {/* Detail table */}
                        <div className="px-5 py-3">
                          {((sess.details || []).length > 0 || pendingForms.length > 0) && (
                            <div className="grid grid-cols-[1fr_110px_100px_90px_28px] gap-2 mb-2 px-1">
                              <div className="text-[10px] font-medium text-gray-400 uppercase">Zona</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-center">Rep × Nilai</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-center">Range Pace</div>
                              <div className="text-[10px] font-medium text-gray-400 uppercase text-right">Est. Jarak / Waktu</div>
                              <div />
                            </div>
                          )}

                          {/* Existing details — pace dari vcr_snapshot (frozen) */}
                          {(sess.details || []).map((det, idx) => {
                            const zd = ZONE_DEFINITIONS.find(z => z.name === det.zone_name)
                            const zoneColor = zd?.color || '#6b7280'
                            const rep = det.repetitions || 1
                            const unit = det.unit || 'km'
                            const valIn = det.value_input
                            const paceStr = detPaceStr(det)
                            const valLabel = valIn != null ? (unit === 'km' ? `${valIn} km` : unit === 'detik' ? `${valIn} dtk` : `${valIn} mnt`) : '—'
                            return (
                              <div key={det.id} className="grid grid-cols-[1fr_110px_100px_90px_28px] gap-2 items-center py-2 border-b border-gray-50 last:border-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-medium text-gray-400">{idx + 1}.</span>
                                  <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                                    style={{ background: zoneColor + '20', color: zoneColor }}>
                                    <span className="w-2 h-2 rounded-full" style={{ background: zoneColor }} />
                                    {det.zone_name}
                                  </span>
                                </div>
                                <div className="text-xs text-center font-bold text-gray-700">{rep > 1 ? `${rep}×` : ''} {valLabel}</div>
                                <div className="text-[10px] text-center font-mono text-gray-400">{paceStr}/km</div>
                                <div className="text-right">
                                  <div className="text-xs font-bold text-gray-800">~{(det.distance_km || 0).toFixed(2)} km</div>
                                  <div className="text-[10px] text-gray-400">{det.est_duration_min ? fmtDuration(det.est_duration_min) : '—'}</div>
                                </div>
                                {canEdit && !isArchived && (
                                  <button onClick={() => deleteDetail(det.id)} className="text-red-300 hover:text-red-500 text-xs text-center">✕</button>
                                )}
                              </div>
                            )
                          })}

                          {/* Pending inline forms */}
                          {pendingForms.map((f, idx) => {
                            const rep = Number(f.repetitions) || 1
                            const val = Number(f.value_input) || 0
                            const out = calcDetail(f.zone_name, rep, f.unit, val || null)
                            const zone = getZone(f.zone_name)
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_110px_100px_90px_28px] gap-2 items-center py-2 bg-indigo-50/40 rounded-lg px-1 mb-1">
                                <select value={f.zone_name} onChange={e => updateDetailForm(sess.id, idx, 'zone_name', e.target.value)}
                                  className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-300">
                                  {ZONE_DEFINITIONS.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
                                </select>
                                <div className="flex gap-1 items-center">
                                  <input type="number" min="1" value={f.repetitions} onChange={e => updateDetailForm(sess.id, idx, 'repetitions', e.target.value)}
                                    placeholder="1" className="w-9 border border-indigo-200 rounded px-1 py-1.5 text-xs text-center focus:outline-none" />
                                  <select value={f.unit} onChange={e => updateDetailForm(sess.id, idx, 'unit', e.target.value)}
                                    className="border border-indigo-200 rounded px-1 py-1.5 text-xs text-gray-700 focus:outline-none">
                                    <option value="km">km</option>
                                    <option value="detik">dtk</option>
                                    <option value="menit">mnt</option>
                                  </select>
                                  <input type="number" step={f.unit === 'km' ? '0.01' : '1'} value={f.value_input} onChange={e => updateDetailForm(sess.id, idx, 'value_input', e.target.value)}
                                    placeholder="0" className="w-11 border border-indigo-200 rounded px-1 py-1.5 text-xs text-center focus:outline-none" />
                                </div>
                                <div className="text-[10px] text-center font-mono text-gray-400">
                                  {zone ? `${secToMMSS(zone.pace_min_sec)}–${secToMMSS(zone.pace_max_sec)}` : '—'}
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-bold text-gray-700">{out ? `~${out.totalKm.toFixed(2)} km` : '—'}</div>
                                  <div className="text-[10px] text-gray-400">{out ? fmtDuration(out.totalMin) : '—'}</div>
                                </div>
                                <button onClick={() => removeDetailForm(sess.id, idx)} className="text-red-300 hover:text-red-500 text-xs">✕</button>
                              </div>
                            )
                          })}

                          {!(sess.details || []).length && !pendingForms.length && (
                            <div className="text-center py-4 text-gray-400 text-xs">Belum ada detail sesi.</div>
                          )}

                          {canEdit && !isArchived && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                              <button onClick={() => initDetailForm(sess.id)}
                                className="text-xs border border-dashed border-indigo-300 text-indigo-500 px-3 py-1.5 rounded-lg hover:bg-indigo-50">+ Tambah Baris</button>
                              {pendingForms.length > 0 && (
                                <>
                                  <button onClick={() => saveDetails(sess)} disabled={savingDetail === sess.id}
                                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                                    {savingDetail === sess.id ? 'Menyimpan...' : '✓ Simpan Detail'}
                                  </button>
                                  <button onClick={() => setDetailForms(prev => { const n = { ...prev }; delete n[sess.id]; return n })}
                                    className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50">Batal</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        </div>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Session Modal */}
      {sessionModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{sessionModal.editing ? 'Edit Sesi' : 'Tambah Sesi'}</h3>
              <button onClick={() => setSessionModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
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
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Detail section */}
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-3">Detail Sesi</div>
                <div className="grid grid-cols-[2fr_52px_84px_80px_88px_82px_82px_28px] gap-2 mb-2">
                  <div className="text-xs font-medium text-gray-500 uppercase">Zona</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Rep</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Nilai</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Satuan</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Avg. Pace</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Est. Jarak</div>
                  <div className="text-xs font-medium text-gray-500 uppercase text-center">Est. Waktu</div>
                  <div />
                </div>
                <div className="space-y-2">
                  {sessionForm.details.map((d, idx) => {
                    const rep = Number(d.repetitions) || 1
                    const val = Number(d.value_input) || 0
                    const out = calcDetail(d.zone_name, rep, d.unit, val || null)
                    return (
                      <div key={idx} className="grid grid-cols-[2fr_52px_84px_80px_88px_82px_82px_28px] gap-2 items-center">
                        <select value={d.zone_name}
                          onChange={e => setSessionForm(f => { const details = [...f.details]; details[idx] = { ...details[idx], zone_name: e.target.value }; return { ...f, details } })}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                          {ZONE_DEFINITIONS.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
                        </select>
                        <input type="number" min="1" value={d.repetitions}
                          onChange={e => setSessionForm(f => { const details = [...f.details]; details[idx] = { ...details[idx], repetitions: e.target.value }; return { ...f, details } })}
                          placeholder="1" className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        <input type="number" step={d.unit === 'km' ? '0.01' : '1'} value={d.value_input}
                          onChange={e => setSessionForm(f => { const details = [...f.details]; details[idx] = { ...details[idx], value_input: e.target.value }; return { ...f, details } })}
                          placeholder={d.unit === 'km' ? '0.0' : d.unit === 'detik' ? 'dtk' : 'mnt'}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-center text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                        <select value={d.unit}
                          onChange={e => setSessionForm(f => { const details = [...f.details]; details[idx] = { ...details[idx], unit: e.target.value, value_input: '' }; return { ...f, details } })}
                          className="w-full border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                          <option value="km">km</option>
                          <option value="detik">detik</option>
                          <option value="menit">menit</option>
                        </select>
                        <div className="text-xs font-mono text-gray-500 text-center">
                          {(() => { const z = getZone(d.zone_name); return z ? `${secToMMSS((z.pace_min_sec + z.pace_max_sec) / 2)}/km` : '—' })()}
                        </div>
                        <div className="text-xs font-bold text-gray-700 text-center">{out ? `~${out.totalKm.toFixed(2)} km` : '—'}</div>
                        <div className="text-xs font-bold text-gray-700 text-center">{out ? fmtDuration(out.totalMin) : '—'}</div>
                        {sessionForm.details.length > 1
                          ? <button onClick={() => setSessionForm(f => ({ ...f, details: f.details.filter((_, i) => i !== idx) }))}
                              className="border border-red-200 text-red-400 hover:bg-red-50 rounded-lg w-6 h-6 flex items-center justify-center text-xs">✕</button>
                          : <div />}
                      </div>
                    )
                  })}
                </div>

                {/* Total */}
                {sessionForm.details.length > 0 && (
                  <div className="grid grid-cols-[2fr_52px_84px_80px_88px_82px_82px_28px] gap-2 items-center mt-3 pt-3 border-t border-gray-100">
                    <div className="text-xs font-bold text-gray-500 col-span-5 text-right">Total</div>
                    {(() => {
                      let km = 0, min = 0
                      sessionForm.details.forEach(d => {
                        const out = calcDetail(d.zone_name, Number(d.repetitions) || 1, d.unit, Number(d.value_input) || null)
                        if (out) { km += out.totalKm; min += out.totalMin }
                      })
                      return <>
                        <div className="text-sm font-bold text-indigo-700 text-center">~{km.toFixed(2)} km</div>
                        <div className="text-sm font-bold text-indigo-700 text-center">{min > 0 ? fmtDuration(min) : '—'}</div>
                      </>
                    })()}
                    <div />
                  </div>
                )}

                <button onClick={() => setSessionForm(f => ({ ...f, details: [...f.details, { ...DETAIL_BLANK }] }))}
                  className="mt-3 border border-indigo-500 text-indigo-600 text-xs px-3 py-1 rounded-lg hover:bg-indigo-50 w-full">
                  + Tambah Baris Detail
                </button>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
                <textarea value={sessionForm.notes} onChange={e => setSessionForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Catatan tambahan untuk sesi ini..." rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
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
