import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'

interface Race {
  id: string
  name: string
  event_date: string
  status: string
  city?: string
}

interface Phase {
  id: string
  race_id: string
  athlete_id: string
  name: string
  emoji: string
  color: string
  focus: string
  week_start: number
  week_end: number
  date_start: string
  date_end: string
  sort_order: number
}

interface Milestone {
  id: string
  race_id: string
  athlete_id: string
  phase_id: string | null
  label: string
  icon: string
  type: 'race' | 'test' | 'assessment'
  milestone_date: string
  week_number: number | null
  description: string | null
}

interface PhaseForm {
  name: string; emoji: string; color: string; focus: string
  week_start: string; week_end: string; date_start: string; date_end: string; sort_order: string
}

interface MilestoneForm {
  label: string; icon: string; type: 'race' | 'test' | 'assessment'
  milestone_date: string; week_number: string; phase_id: string; description: string
}

const PHASE_BLANK: PhaseForm = { name: '', emoji: '🏃', color: '#6366f1', focus: '', week_start: '', week_end: '', date_start: '', date_end: '', sort_order: '' }
const MS_BLANK: MilestoneForm = { label: '', icon: '📋', type: 'assessment', milestone_date: '', week_number: '', phase_id: '', description: '' }

const EMOJI_OPTIONS = ['🏃','🔥','💪','🌱','⚡','🏆','🧪','📋','🎯','🗓️','🔁','🏅','🛤️','🧘','🚀','⛽','🧱','🔬','📈','🏁']
const ICON_OPTIONS  = ['📋','⚡','🏆','🧪','🎯','🔥','💪','✅','🗓️','📈','🏅','🔁','🏁','🧘','🌟','📌','🔔','🎽','🩺','🥇']
const COLOR_OPTIONS = ['#6366f1','#f97316','#22c55e','#3b82f6','#eab308','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6']

function today() { return new Date().toISOString().slice(0, 10) }
function daysBetween(a: string, b: string) { return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000) }
function phaseStatus(p: Phase): 'past' | 'active' | 'upcoming' {
  const t = today()
  if (t > p.date_end) return 'past'
  if (t >= p.date_start && t <= p.date_end) return 'active'
  return 'upcoming'
}
function msStatus(m: Milestone): 'past' | 'today' | 'upcoming' {
  const t = today()
  if (m.milestone_date < t) return 'past'
  if (m.milestone_date === t) return 'today'
  return 'upcoming'
}
function fmtDate(d: string) { return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) }

export default function RoadmapPage() {
  const [athleteId, setAthleteId]   = useState<string | null>(null)
  const [roles, setRoles]           = useState<string[]>([])
  const [races, setRaces]           = useState<Race[]>([])
  const [selectedRaceId, setSelectedRaceId] = useState<string>('')
  const [phases, setPhases]         = useState<Phase[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)
  const [phaseModal, setPhaseModal] = useState<{ open: boolean; editing: Phase | null }>({ open: false, editing: null })
  const [msModal, setMsModal]       = useState<{ open: boolean; editing: Milestone | null }>({ open: false, editing: null })
  const [phaseForm, setPhaseForm]   = useState<PhaseForm>(PHASE_BLANK)
  const [msForm, setMsForm]         = useState<MilestoneForm>(MS_BLANK)
  const [saving, setSaving]         = useState(false)
  const [attachLoading, setAttachLoading] = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canEdit = roles.includes('coach') || roles.includes('admin')
  const selectedRace = races.find(r => r.id === selectedRaceId)
  const isArchived = selectedRace ? selectedRace.status === 'done' : false

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
        .from('races').select('id,name,event_date,status,city')
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

  useEffect(() => {
    if (!selectedRaceId) { setPhases([]); setMilestones([]); return }
    loadData(selectedRaceId)
  }, [selectedRaceId])

  async function loadData(raceId: string) {
    const [{ data: ph }, { data: ms }] = await Promise.all([
      (supabase as any).from('program_phases').select('*').eq('race_id', raceId).order('sort_order'),
      (supabase as any).from('program_milestones').select('*').eq('race_id', raceId).order('milestone_date')
    ])
    setPhases(ph || [])
    setMilestones(ms || [])
  }

  async function handleAttach() {
    if (!selectedRaceId || !athleteId) return
    setAttachLoading(true)
    try {
      const { data: weeks } = await supabase.from('program_weeks').select('*').eq('athlete_id', athleteId).order('week_number' as any)
      if (!weeks || weeks.length === 0) { showToast('Belum ada Program Detail untuk di-attach', false); return }

      const phaseMap: Record<string, { weeks: any[] }> = {}
      weeks.forEach((w: any) => {
        const key = w.phase_name || `Fase ${w.week_number}`
        if (!phaseMap[key]) phaseMap[key] = { weeks: [] }
        phaseMap[key].weeks.push(w)
      })

      const phaseColors = ['#6366f1','#f97316','#22c55e','#3b82f6','#eab308','#ef4444','#8b5cf6','#06b6d4']
      const order = phases.length ? Math.max(...phases.map(p => p.sort_order)) + 1 : 0

      const inserts = Object.entries(phaseMap).map(([name, val], i) => {
        const ws       = val.weeks
        const weekNums = ws.map((w: any) => w.week_number).sort((a: number, b: number) => a - b)
        const dates    = ws.map((w: any) => ({ s: w.period_start, e: w.period_end })).filter((d: any) => d.s && d.e)
        return {
          race_id: selectedRaceId, athlete_id: athleteId,
          name, emoji: '🏃', color: phaseColors[i % phaseColors.length], focus: '',
          week_start: weekNums[0] || 1, week_end: weekNums[weekNums.length - 1] || 1,
          date_start: dates.length ? dates[0].s : today(),
          date_end: dates.length ? dates[dates.length - 1].e : today(),
          sort_order: order + i
        }
      })

      await (supabase as any).from('program_phases').insert(inserts)
      await loadData(selectedRaceId)
      showToast(`${inserts.length} fase berhasil di-generate dari Program Detail`)
    } catch (e: any) {
      showToast('Gagal attach: ' + e.message, false)
    } finally {
      setAttachLoading(false)
    }
  }

  function openPhaseModal(editing: Phase | null) {
    if (editing) {
      setPhaseForm({ name: editing.name, emoji: editing.emoji, color: editing.color, focus: editing.focus || '', week_start: String(editing.week_start), week_end: String(editing.week_end), date_start: editing.date_start, date_end: editing.date_end, sort_order: String(editing.sort_order) })
    } else {
      const nextOrder = phases.length ? Math.max(...phases.map(p => p.sort_order)) + 1 : 0
      setPhaseForm({ ...PHASE_BLANK, sort_order: String(nextOrder) })
    }
    setPhaseModal({ open: true, editing })
  }

  async function savePhase() {
    if (!selectedRaceId || !athleteId) return
    if (!phaseForm.name || !phaseForm.date_start || !phaseForm.date_end) { showToast('Nama, tanggal mulai, dan tanggal selesai wajib diisi', false); return }
    setSaving(true)
    const payload = { race_id: selectedRaceId, athlete_id: athleteId, name: phaseForm.name, emoji: phaseForm.emoji, color: phaseForm.color, focus: phaseForm.focus, week_start: Number(phaseForm.week_start) || 1, week_end: Number(phaseForm.week_end) || 1, date_start: phaseForm.date_start, date_end: phaseForm.date_end, sort_order: Number(phaseForm.sort_order) || 0 }
    try {
      if (phaseModal.editing) {
        await (supabase as any).from('program_phases').update(payload).eq('id', phaseModal.editing.id)
        showToast('Fase diperbarui')
      } else {
        await (supabase as any).from('program_phases').insert(payload)
        showToast('Fase ditambahkan')
      }
      setPhaseModal({ open: false, editing: null })
      await loadData(selectedRaceId)
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deletePhase(id: string) {
    if (!confirm('Hapus fase ini? Milestone yang terkait akan terlepas.')) return
    await (supabase as any).from('program_phases').delete().eq('id', id)
    await loadData(selectedRaceId)
    showToast('Fase dihapus')
  }

  function openMsModal(editing: Milestone | null) {
    if (editing) {
      setMsForm({ label: editing.label, icon: editing.icon, type: editing.type, milestone_date: editing.milestone_date, week_number: editing.week_number != null ? String(editing.week_number) : '', phase_id: editing.phase_id || '', description: editing.description || '' })
    } else {
      setMsForm(MS_BLANK)
    }
    setMsModal({ open: true, editing })
  }

  async function saveMilestone() {
    if (!selectedRaceId || !athleteId) return
    if (!msForm.label || !msForm.milestone_date) { showToast('Label dan tanggal wajib diisi', false); return }
    setSaving(true)
    const payload = { race_id: selectedRaceId, athlete_id: athleteId, phase_id: msForm.phase_id || null, label: msForm.label, icon: msForm.icon, type: msForm.type, milestone_date: msForm.milestone_date, week_number: msForm.week_number ? Number(msForm.week_number) : null, description: msForm.description || null }
    try {
      if (msModal.editing) {
        await (supabase as any).from('program_milestones').update(payload).eq('id', msModal.editing.id)
        showToast('Milestone diperbarui')
      } else {
        await (supabase as any).from('program_milestones').insert(payload)
        showToast('Milestone ditambahkan')
      }
      setMsModal({ open: false, editing: null })
      await loadData(selectedRaceId)
    } catch (e: any) {
      showToast('Gagal menyimpan: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteMilestone(id: string) {
    if (!confirm('Hapus milestone ini?')) return
    await (supabase as any).from('program_milestones').delete().eq('id', id)
    await loadData(selectedRaceId)
    showToast('Milestone dihapus')
  }

  function ganttData() {
    if (!phases.length) return null
    const allDates = phases.flatMap(p => [p.date_start, p.date_end]).sort()
    const minDate  = new Date(allDates[0])
    const maxDate  = new Date(allDates[allDates.length - 1])
    const totalMs  = maxDate.getTime() - minDate.getTime() || 1
    return { minDate, maxDate, totalMs }
  }

  function ganttPct(date: string, gd: { minDate: Date; totalMs: number }) {
    return ((new Date(date).getTime() - gd.minDate.getTime()) / gd.totalMs) * 100
  }

  function todayPct(gd: { minDate: Date; maxDate: Date; totalMs: number }) {
    const t = new Date(today()).getTime()
    if (t < gd.minDate.getTime()) return -1
    if (t > gd.maxDate.getTime()) return 101
    return ((t - gd.minDate.getTime()) / gd.totalMs) * 100
  }

  function programProgress() {
    if (!phases.length) return 0
    const start = phases[0].date_start
    const end   = phases[phases.length - 1].date_end
    const t     = today()
    if (t <= start) return 0
    if (t >= end)   return 100
    const elapsed = new Date(t).getTime() - new Date(start).getTime()
    const total   = new Date(end).getTime() - new Date(start).getTime()
    return Math.round((elapsed / total) * 100)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>

  const gd       = ganttData()
  const todayP   = gd ? todayPct(gd) : -1
  const progress = programProgress()
  const raceA    = races.find(r => r.status === 'A')
  const daysToRaceA = raceA ? daysBetween(today(), raceA.event_date) : null

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Roadmap & Timeline</h1>
            <p className="text-xs text-gray-400 mt-0.5">Fase, milestone, dan visualisasi program per race</p>
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
            <span>🗄️</span>
            <span>Race ini sudah selesai — roadmap dalam mode <strong>arsip</strong>, tidak bisa diedit.</span>
          </div>
        )}
      </div>

      {!selectedRaceId ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">Pilih race untuk melihat roadmap</div>
      ) : (
        <>
          {/* Program Summary */}
          {phases.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Ringkasan Program</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Total Fase</div>
                  <div className="text-sm font-bold text-gray-800">{phases.length} Fase</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Periode</div>
                  <div className="text-sm font-bold text-gray-800">{fmtDate(phases[0].date_start)} → {fmtDate(phases[phases.length - 1].date_end)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Fase Aktif</div>
                  <div className="text-sm font-bold text-indigo-600">
                    {(() => {
                      const t = today()
                      const active = phases.find(p => t >= p.date_start && t <= p.date_end)
                      if (active) return `${active.emoji} ${active.name}`
                      if (t < phases[0].date_start) return 'Belum mulai'
                      return 'Selesai'
                    })()}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Hari ke Race A</div>
                  <div className={`text-sm font-bold ${daysToRaceA !== null && daysToRaceA <= 14 ? 'text-red-500' : 'text-gray-800'}`}>
                    {daysToRaceA !== null ? (daysToRaceA <= 0 ? '🔥 Race Day!' : `H-${daysToRaceA}`) : '—'}
                  </div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Progress Program</span>
                  <span className="font-bold text-indigo-600">{progress}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#6366f1,#818cf8)' }} />
                </div>
              </div>
            </div>
          )}

          {/* Gantt Timeline */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4 flex items-center justify-between">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Timeline Visual</h2>
              {canEdit && !isArchived && (
                <button onClick={() => openPhaseModal(null)} className="border border-indigo-500 text-indigo-600 text-xs px-3 py-1 rounded-lg hover:bg-indigo-50">+ Tambah Fase</button>
              )}
            </div>

            {phases.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm space-y-3">
                <div className="text-4xl">🗺️</div>
                <div>Belum ada fase. {canEdit ? 'Tambah fase pertama atau generate dari Program Detail.' : 'Coach belum membuat roadmap.'}</div>
                {canEdit && !isArchived && (
                  <div className="flex justify-center gap-3 pt-2">
                    <button onClick={() => openPhaseModal(null)} className="bg-indigo-600 text-white text-xs px-4 py-2 rounded-lg hover:bg-indigo-700">+ Buat Fase Manual</button>
                    <button onClick={handleAttach} disabled={attachLoading} className="border border-indigo-400 text-indigo-600 text-xs px-4 py-2 rounded-lg hover:bg-indigo-50 disabled:opacity-50">
                      {attachLoading ? 'Memproses...' : '⚡ Attach dari Program Detail'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[600px]">
                    {gd && (
                      <div className="flex justify-between text-xs text-gray-400 mb-2 pl-[120px]">
                        <span>{fmtDate(phases[0].date_start)}</span>
                        <span>{fmtDate(phases[phases.length - 1].date_end)}</span>
                      </div>
                    )}
                    <div className="space-y-2">
                      {phases.map(p => {
                        const left  = gd ? ganttPct(p.date_start, gd) : 0
                        const right = gd ? ganttPct(p.date_end, gd) : 100
                        const width = right - left
                        const st    = phaseStatus(p)
                        const pMs   = milestones.filter(m => m.phase_id === p.id)
                        return (
                          <div key={p.id} className="flex items-center gap-2">
                            <div className="w-[116px] flex-shrink-0 text-right">
                              <span className="text-xs font-medium text-gray-600 truncate block">{p.emoji} {p.name}</span>
                              <span className="text-[10px] text-gray-400">W{p.week_start}–W{p.week_end}</span>
                            </div>
                            <div className="flex-1 relative h-7">
                              <div className="absolute inset-y-0 w-full bg-gray-100 rounded-full" />
                              <div className="absolute inset-y-1 rounded-full transition-all"
                                style={{ left: `${left}%`, width: `${width}%`, background: st === 'past' ? '#d1d5db' : p.color, opacity: st === 'upcoming' ? 0.6 : 1 }} />
                              {gd && pMs.map(m => {
                                const mp = ganttPct(m.milestone_date, gd)
                                if (mp < 0 || mp > 100) return null
                                const mst = msStatus(m)
                                return (
                                  <div key={m.id} title={`${m.icon} ${m.label} · ${fmtDate(m.milestone_date)}`}
                                    className="absolute top-0 -translate-x-1/2 cursor-pointer group" style={{ left: `${mp}%` }}>
                                    <div className="w-3 h-3 rotate-45 border-2 border-white"
                                      style={{ background: mst === 'past' ? '#9ca3af' : mst === 'today' ? '#ef4444' : p.color }} />
                                    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 hidden group-hover:block bg-gray-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                                      {m.icon} {m.label}
                                    </div>
                                  </div>
                                )
                              })}
                              {todayP >= 0 && todayP <= 100 && (
                                <div className="absolute inset-y-0 w-0.5 bg-red-400 z-10" style={{ left: `${todayP}%` }}>
                                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-red-400 font-bold whitespace-nowrap">TODAY</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex gap-4 mt-4 text-[10px] text-gray-400 flex-wrap">
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-indigo-500" /> Aktif</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-300" /> Selesai</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rotate-45 border border-indigo-500" /> Milestone</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-0.5 h-3 bg-red-400" /> Hari ini</span>
                    </div>
                  </div>
                </div>
                {canEdit && !isArchived && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <button onClick={handleAttach} disabled={attachLoading}
                      className="border border-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                      {attachLoading ? 'Memproses...' : '⚡ Re-generate dari Program Detail'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Phase Cards */}
          {phases.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Detail Fase</h2>
              <div className="space-y-3">
                {phases.map(p => {
                  const st  = phaseStatus(p)
                  const pMs = milestones.filter(m => m.phase_id === p.id)
                  return (
                    <div key={p.id} className="rounded-xl border p-4"
                      style={{ borderColor: st === 'active' ? p.color : '#e5e7eb', borderWidth: st === 'active' ? 2 : 1, background: st === 'active' ? p.color + '08' : st === 'past' ? '#f9fafb' : 'white' }}>
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0 border-2"
                          style={{ background: p.color + '20', borderColor: p.color }}>{p.emoji}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-gray-800">{p.name}</span>
                              <span className="text-xs text-gray-400">W{p.week_start}–W{p.week_end}</span>
                              {st === 'active'   && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: p.color + '20', color: p.color }}>● AKTIF</span>}
                              {st === 'past'     && <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ SELESAI</span>}
                              {st === 'upcoming' && <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">UPCOMING</span>}
                            </div>
                            {canEdit && !isArchived && (
                              <div className="flex gap-1">
                                <button onClick={() => openPhaseModal(p)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50">Edit</button>
                                <button onClick={() => deletePhase(p.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                              </div>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">{fmtDate(p.date_start)} → {fmtDate(p.date_end)}</div>
                          {p.focus && <div className="text-xs text-gray-600 mt-2 italic">"{p.focus}"</div>}
                          {pMs.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3">
                              {pMs.map(m => (
                                <span key={m.id} className="text-[11px] px-2 py-0.5 rounded-full border font-medium"
                                  style={{ background: p.color + '15', color: p.color, borderColor: p.color + '40' }}>
                                  {m.icon} {m.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Milestones Table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="border-b border-indigo-100 pb-2 mb-4 flex items-center justify-between">
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">Key Milestones</h2>
              {canEdit && !isArchived && (
                <button onClick={() => openMsModal(null)} className="border border-indigo-500 text-indigo-600 text-xs px-3 py-1 rounded-lg hover:bg-indigo-50">+ Tambah Milestone</button>
              )}
            </div>
            {milestones.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">Belum ada milestone.{canEdit && !isArchived ? ' Tambah milestone pertama.' : ''}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-gray-100">
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Tanggal</th>
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Minggu</th>
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Fase</th>
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Milestone</th>
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Tipe</th>
                      <th className="text-xs font-medium text-gray-500 uppercase pb-2 pr-4">Status</th>
                      {canEdit && !isArchived && <th className="pb-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map(m => {
                      const st  = msStatus(m)
                      const ph  = phases.find(p => p.id === m.phase_id)
                      const typeBadge = m.type === 'race' ? { label: '🏆 Race', color: '#ef4444' } : m.type === 'test' ? { label: '⚡ Test', color: '#f59e0b' } : { label: '📋 Assessment', color: '#6366f1' }
                      return (
                        <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2.5 pr-4 text-xs text-gray-600 whitespace-nowrap">{fmtDate(m.milestone_date)}</td>
                          <td className="py-2.5 pr-4 text-xs font-bold text-gray-700">{m.week_number ? `W${m.week_number}` : '—'}</td>
                          <td className="py-2.5 pr-4 text-xs text-gray-500">{ph ? `${ph.emoji} ${ph.name}` : '—'}</td>
                          <td className="py-2.5 pr-4">
                            <div className="text-sm font-bold text-gray-800">{m.icon} {m.label}</div>
                            {m.description && <div className="text-xs text-gray-400 mt-0.5">{m.description}</div>}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span className="text-[11px] px-2 py-0.5 rounded-full border font-medium"
                              style={{ background: typeBadge.color + '15', color: typeBadge.color, borderColor: typeBadge.color + '40' }}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-xs">
                            {st === 'today'    && <span className="text-red-500 font-bold">● HARI INI</span>}
                            {st === 'past'     && <span className="text-green-600">✅ Selesai</span>}
                            {st === 'upcoming' && <span className="text-gray-400">○ Upcoming</span>}
                          </td>
                          {canEdit && !isArchived && (
                            <td className="py-2.5 text-right whitespace-nowrap">
                              <button onClick={() => openMsModal(m)} className="border border-indigo-500 text-indigo-600 text-xs px-2 py-0.5 rounded-lg hover:bg-indigo-50 mr-1">Edit</button>
                              <button onClick={() => deleteMilestone(m.id)} className="border border-red-200 text-red-500 text-xs px-2 py-0.5 rounded-lg hover:bg-red-50">Hapus</button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Phase Modal */}
      {phaseModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{phaseModal.editing ? 'Edit Fase' : 'Tambah Fase'}</h3>
              <button onClick={() => setPhaseModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Emoji</div>
                <div className="flex flex-wrap gap-2">
                  {EMOJI_OPTIONS.map(e => (
                    <button key={e} onClick={() => setPhaseForm(f => ({ ...f, emoji: e }))}
                      className={`w-8 h-8 rounded-lg text-base flex items-center justify-center border transition-all ${phaseForm.emoji === e ? 'border-indigo-500 bg-indigo-50 scale-110' : 'border-gray-200 hover:border-indigo-300'}`}>{e}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Warna</div>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map(c => (
                    <button key={c} onClick={() => setPhaseForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${phaseForm.color === c ? 'scale-125 border-gray-400' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Nama Fase *</div>
                <input value={phaseForm.name} onChange={e => setPhaseForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="cth. Base 1, Build 2, Taper..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Fokus Latihan</div>
                <input value={phaseForm.focus} onChange={e => setPhaseForm(f => ({ ...f, focus: e.target.value }))}
                  placeholder="cth. Membangun aerobic base, Easy pace dominan"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Minggu Mulai</div>
                  <input type="number" value={phaseForm.week_start} onChange={e => setPhaseForm(f => ({ ...f, week_start: e.target.value }))}
                    placeholder="1" min={1} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Minggu Selesai</div>
                  <input type="number" value={phaseForm.week_end} onChange={e => setPhaseForm(f => ({ ...f, week_end: e.target.value }))}
                    placeholder="4" min={1} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal Mulai *</div>
                  <input type="date" value={phaseForm.date_start} onChange={e => setPhaseForm(f => ({ ...f, date_start: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal Selesai *</div>
                  <input type="date" value={phaseForm.date_end} onChange={e => setPhaseForm(f => ({ ...f, date_end: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Urutan</div>
                <input type="number" value={phaseForm.sort_order} onChange={e => setPhaseForm(f => ({ ...f, sort_order: e.target.value }))}
                  placeholder="0" min={0} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setPhaseModal({ open: false, editing: null })} className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={savePhase} disabled={saving} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Milestone Modal */}
      {msModal.open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">{msModal.editing ? 'Edit Milestone' : 'Tambah Milestone'}</h3>
              <button onClick={() => setMsModal({ open: false, editing: null })} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Icon</div>
                <div className="flex flex-wrap gap-2">
                  {ICON_OPTIONS.map(ic => (
                    <button key={ic} onClick={() => setMsForm(f => ({ ...f, icon: ic }))}
                      className={`w-8 h-8 rounded-lg text-base flex items-center justify-center border transition-all ${msForm.icon === ic ? 'border-indigo-500 bg-indigo-50 scale-110' : 'border-gray-200 hover:border-indigo-300'}`}>{ic}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Label *</div>
                <input value={msForm.label} onChange={e => setMsForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="cth. Magic Mile #1, 10K TT, Race B..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tipe</div>
                <div className="flex gap-2">
                  {(['race','test','assessment'] as const).map(t => (
                    <button key={t} onClick={() => setMsForm(f => ({ ...f, type: t }))}
                      className={`flex-1 text-xs py-2 rounded-lg border font-medium transition-all ${msForm.type === t ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600 hover:border-indigo-300'}`}>
                      {t === 'race' ? '🏆 Race' : t === 'test' ? '⚡ Test' : '📋 Assessment'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
                  <input type="date" value={msForm.milestone_date} onChange={e => setMsForm(f => ({ ...f, milestone_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Minggu ke-</div>
                  <input type="number" value={msForm.week_number} onChange={e => setMsForm(f => ({ ...f, week_number: e.target.value }))}
                    placeholder="cth. 5" min={1} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Fase</div>
                <select value={msForm.phase_id} onChange={e => setMsForm(f => ({ ...f, phase_id: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="">— Tidak terikat fase —</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                </select>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Deskripsi</div>
                <textarea value={msForm.description} onChange={e => setMsForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="cth. Test kecepatan akhir Base 1, hasil dipakai update pace zones"
                  rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => setMsModal({ open: false, editing: null })} className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveMilestone} disabled={saving} className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
