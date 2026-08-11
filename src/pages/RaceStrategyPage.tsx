import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useRole } from '../hooks/useRole'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────
interface Race {
  id: string
  name: string
  event_date: string
  status: 'A' | 'B' | 'C' | 'D'
  target_finish?: string
  distance_km?: number
}

interface CueCard {
  phase: string
  cue: string
  sub?: string
  color: string
  textColor: string
}

interface StrategyData {
  strategyNotes?: string
  cueCards?: CueCard[]
  raceDayNotes?: string
}

interface PbsSegment {
  label: string
  km: number
  hint: string
}

// ─── Constants ────────────────────────────────────────────────────────────────
const PBS_SEGMENTS: PbsSegment[] = [
  { label: 'Km 1–3',     km: 3,   hint: 'Warm-up, konservatif' },
  { label: 'Km 4–10',    km: 7,   hint: 'Race pace settle' },
  { label: 'Km 11–15',   km: 5,   hint: 'Tengah race, jaga effort' },
  { label: 'Km 16–18',   km: 3,   hint: 'Mulai push jika kuat' },
  { label: 'Km 19–21.1', km: 3.1, hint: 'Final push' },
]

const PBS_STRATEGIES = {
  even:         { label: 'Even Split',        factors: [1.0,  1.0,  1.0,  1.0,  1.0 ] },
  negative:     { label: 'Negative Split',    factors: [1.04, 1.02, 1.0,  0.98, 0.96] },
  conservative: { label: 'Conservative Start',factors: [1.06, 1.02, 1.0,  0.98, 0.94] },
}

const STC_MILESTONES = [1,2,3,4,5,7,10,12,15,17,18,19,20,21,21.1]

const DEFAULT_CUES: Record<string, CueCard[]> = {
  maybank: [
    { phase: 'Km 0–5',    color: '#eff6ff', textColor: '#1e40af', cue: 'Santai dan sabar 🌊',           sub: 'Biarkan kaki mencari ritme. Bali panas, konservasi energi dari awal.' },
    { phase: 'Km 6–12',   color: '#f0fdf4', textColor: '#065f46', cue: 'Lock pace, trust the plan 🎯',  sub: 'Ini zona krusial. Jaga RWR ratio konsisten. Jangan kejar orang lain.' },
    { phase: 'Km 13–17',  color: '#fef3c7', textColor: '#92400e', cue: 'Satu langkah, satu napas 🔥',  sub: 'Kaki mulai berat — normal. Fokus walk break, bukan finish line.' },
    { phase: 'Km 18–21.1',color: '#faf5ff', textColor: '#6b21a8', cue: 'Ini yang kamu latih! 💜',      sub: 'Semua kilometer latihan ada di sini. Keluarkan semuanya.' },
  ],
  pocari: [
    { phase: 'Km 0–5',    color: '#eff6ff', textColor: '#1e40af', cue: 'Tenang di awal, kuat di akhir 🌊', sub: 'Bandung dingin — manfaatkan. Settle into pace, jangan excited berlebihan.' },
    { phase: 'Km 6–12',   color: '#f0fdf4', textColor: '#065f46', cue: 'Flow dengan medan 🏔️',            sub: 'Tanjakan = walk, turunan = harvest. Jaga HR, bukan pace.' },
    { phase: 'Km 13–17',  color: '#fef3c7', textColor: '#92400e', cue: 'Ini medan juang 💪',               sub: 'Bagian terberat. Percaya proses. Setiap walk break adalah strategi.' },
    { phase: 'Km 18–21.1',color: '#faf5ff', textColor: '#6b21a8', cue: 'Sub-2:15 adalah milikmu ⭐',      sub: 'Ini race utama. Bayar semua kerja keras 17 minggu terakhir.' },
  ],
}

const DEFAULT_STRATEGY_NOTES: Record<string, string> = {
  maybank: `## 🏅 Race Overview
**Target:** Sub-2:30 | **Pace Target:** 7:06/km
**RWR Ratio:** 60:30 atau 75:30 | **Status:** Race Sela (B)

## 🏃 Pace Strategy
- **Km 1–3:** 7:15/km (warm-up, even slower than target)
- **Km 4–15:** 7:00–7:05/km (race pace)
- **Km 16–18:** 7:00/km (steady, monitor effort)
- **Km 19–21.1:** 6:50–7:00/km (controlled push)

## 📋 RWR Race Day
> RWR ratio 60:30 atau 75:30 — final decided W12 berdasarkan testing`,

  pocari: `## 🏅 Race Overview
**Target:** Sub-2:15 | **Pace Target:** 6:24/km
**RWR Ratio:** 75:30 atau 90:30 | **Status:** Main Race (A) ⭐

## 🏃 Pace Strategy (Rolling Course Bandung)
- **Km 1–3:** 6:35–6:45/km (settle, jangan terburu)
- **Km 4–10:** 6:20–6:30/km (race pace, manfaatkan datar/turun)
- **Km 11–15:** 6:25–6:35/km (handle climb, walk extra di tanjakan tajam)
- **Km 16–21.1:** 6:15–6:25/km (final push, stronger ending)

## 📋 RWR Race Day
> RWR ratio 75:30 atau 90:30 — decided W18 berdasarkan testing`,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parsePaceSec(str: string): number | null {
  if (!str) return null
  const parts = str.trim().split(':')
  if (parts.length !== 2) return null
  const m = parseInt(parts[0])
  const s = parseFloat(parts[1])
  if (isNaN(m) || isNaN(s)) return null
  return m * 60 + s
}

function fmtPace(sec: number): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTargetSec(str: string): number {
  const parts = str.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60
  return 0
}

function calcBlended(runPace: number, walkPace: number, runSec: number, walkSec: number): number | null {
  if (!runPace || !walkPace || !runSec || !walkSec) return null
  const distRun  = runSec  / runPace
  const distWalk = walkSec / walkPace
  return (runSec + walkSec) / (distRun + distWalk)
}

function raceSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function parseMarkdown(md: string): string {
  if (!md) return ''
  let html = md
    .replace(/^### (.+)$/gm, '<h3 style="font-size:1rem;font-weight:700;color:#4338ca;margin:12px 0 4px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:1.05rem;font-weight:700;color:#4f46e5;margin:14px 0 6px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:1.15rem;font-weight:800;color:#4f46e5;margin:16px 0 8px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #a5b4fc;padding:4px 10px;color:#6366f1;margin:6px 0;background:#eef2ff;border-radius:0 4px 4px 0">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li style="margin:2px 0">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin:6px 0 6px 18px;list-style:disc">$&</ul>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:3px;font-size:0.85em">$1</code>')
  return html
}

// ─── RWR Panel subcomponent ───────────────────────────────────────────────────
interface RwrPanelProps {
  prefix: string
  state: RwrState
  onChange: (s: RwrState) => void
}
interface RwrState {
  enabled: boolean
  runPace: string
  walkPace: string
  runSec: string
  walkSec: string
}
function RwrPanel({ prefix: _prefix, state, onChange }: RwrPanelProps) {
  const blended = state.enabled
    ? calcBlended(
        parsePaceSec(state.runPace) || 0,
        parsePaceSec(state.walkPace) || 0,
        parseFloat(state.runSec) || 0,
        parseFloat(state.walkSec) || 0
      )
    : null

  return (
    <div className="mt-3">
      <label className="flex items-center gap-2 text-sm font-medium text-indigo-700 cursor-pointer select-none">
        <input type="checkbox" checked={state.enabled} onChange={e => onChange({ ...state, enabled: e.target.checked })}
          className="rounded border-indigo-300 text-indigo-600" />
        🔀 Gunakan RWR (Run-Walk-Run)
      </label>
      {state.enabled && (
        <div className="mt-2 bg-indigo-50 rounded-xl p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Run Pace (/km)', key: 'runPace',  ph: '6:30', type: 'text' },
            { label: 'Walk Pace (/km)',key: 'walkPace', ph: '10:00',type: 'text' },
            { label: 'Run (detik)',    key: 'runSec',   ph: '60',   type: 'number' },
            { label: 'Walk (detik)',   key: 'walkSec',  ph: '30',   type: 'number' },
          ].map(f => (
            <div key={f.key}>
              <div className="text-[10px] font-bold text-indigo-500 uppercase mb-1">{f.label}</div>
              <input type={f.type} value={(state as any)[f.key]}
                onChange={e => onChange({ ...state, [f.key]: e.target.value })}
                placeholder={f.ph}
                className="w-full border border-indigo-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          ))}
          {blended && (
            <div className="col-span-2 md:col-span-4 bg-indigo-100 rounded-lg px-3 py-1.5 text-sm font-bold text-indigo-700">
              🧮 Blended Pace: {fmtPace(blended)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Delta Badge ─────────────────────────────────────────────────────────────
function DeltaBadge({ estSec, targetSec }: { estSec: number; targetSec: number }) {
  const delta = Math.round(estSec - targetSec)
  const abs = Math.abs(delta)
  const min = Math.floor(abs / 60), sec = abs % 60
  const str = (min > 0 ? `${min} mnt ` : '') + `${sec} dtk`
  const color = delta > 5 ? '#ef4444' : delta < -5 ? '#22c55e' : '#f59e0b'
  const icon  = delta > 5 ? '⚠️ +' : delta < -5 ? '✅ −' : '🎯 ±'
  const label = delta > 5 ? 'LEBIH LAMBAT dari target' : delta < -5 ? 'LEBIH CEPAT dari target' : 'Sesuai target'
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold"
      style={{ background: color + '18', border: `1px solid ${color}50`, color }}>
      {icon}{str} — {label}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RaceStrategyPage() {
  const [races, setRaces] = useState<Race[]>([])
  const [activeRaceId, setActiveRaceId] = useState<string>('')
  const [strategyData, setStrategyData] = useState<Record<string, StrategyData>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'notes' | 'pbs' | 'stc' | 'cues' | 'racenotes'>('notes')
  const [yearFilter, setYearFilter] = useState<number>(new Date().getFullYear())
  const [archiveOpen, setArchiveOpen] = useState(false)
  const { isCoach, isAdmin } = useRole()

  // ── Load races ──
  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
      if (!ath) { setLoading(false); return }

      const { data: raceRows } = await supabase
        .from('races')
        .select('id,name,event_date,status,target_finish,distance_km')
        .eq('athlete_id', ath.id)
        .in('status', ['A', 'B', 'C'])
        .order('event_date', { ascending: true })

      const activeRaces = ((raceRows || []) as unknown) as Race[]
      setRaces(activeRaces)

      // Default: pilih tahun dengan race aktif terbaru, atau tahun terbaru
      const now = new Date()
      const activeNow = activeRaces.filter(r => new Date(r.event_date) >= now)
      const defaultYear = activeNow.length > 0
        ? new Date(activeNow[0].event_date).getFullYear()
        : activeRaces.length > 0
          ? new Date(activeRaces[activeRaces.length - 1].event_date).getFullYear()
          : now.getFullYear()
      setYearFilter(defaultYear)

      // Default activeRaceId: race aktif pertama di tahun default, atau arsip pertama
      const firstActive = activeRaces.find(r => new Date(r.event_date) >= now && new Date(r.event_date).getFullYear() === defaultYear)
      const firstInYear = activeRaces.find(r => new Date(r.event_date).getFullYear() === defaultYear)
      if (firstActive) setActiveRaceId(firstActive.id)
      else if (firstInYear) setActiveRaceId(firstInYear.id)

      // Load strategy data per race
      const { data: stRows } = await (supabase as any)
        .from('race_strategy')
        .select('race_id,strategy_notes,cue_cards,race_day_notes')
        .eq('athlete_id', ath.id)

      const map: Record<string, StrategyData> = {}
      ;(stRows || []).forEach((r: any) => {
        map[r.race_id] = {
          strategyNotes: r.strategy_notes || '',
          cueCards:      r.cue_cards ? JSON.parse(r.cue_cards) : undefined,
          raceDayNotes:  r.race_day_notes || '',
        }
      })
      setStrategyData(map)
      setLoading(false)
    }
    load()
  }, [])

  const activeRace = races.find(r => r.id === activeRaceId)
  const slug = activeRace ? raceSlug(activeRace.name) : ''
  const data = strategyData[activeRaceId] || {}
  const isPast = activeRace ? new Date(activeRace.event_date) < new Date() : false
  const canEdit = !isPast || isCoach || isAdmin

  async function saveField(field: 'strategy_notes' | 'cue_cards' | 'race_day_notes', value: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
    if (!ath) return
    await (supabase as any).from('race_strategy').upsert({
      athlete_id: ath.id,
      race_id: activeRaceId,
      [field]: value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'athlete_id,race_id' })

    setStrategyData(prev => ({
      ...prev,
      [activeRaceId]: {
        ...prev[activeRaceId],
        [field === 'strategy_notes' ? 'strategyNotes'
         : field === 'cue_cards'    ? 'cueCards'
         :                            'raceDayNotes']: field === 'cue_cards' ? JSON.parse(value) : value,
      }
    }))
  }

  const tabCls = (t: string) =>
    `px-3 py-1.5 rounded-lg text-[0.82rem] font-medium transition-all cursor-pointer ${
      activeTab === t ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
    }`

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="text-center"><div className="text-2xl mb-2">♟️</div>Memuat race strategy...</div>
    </div>
  )

  if (races.length === 0) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="text-center"><div className="text-3xl mb-3">♟️</div>Belum ada race aktif (status A/B).<br/>Tambahkan race di Race Management.</div>
    </div>
  )

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-1">Race Strategy</h1>
        <p className="text-sm text-gray-400">Perencanaan strategi & simulasi pace per race</p>
      </div>

      {/* Race Aktif */}
      {(() => {
        const now = new Date()
        const activeRaces = races.filter(r => new Date(r.event_date) >= now)
        const archivedRaces = races.filter(r => new Date(r.event_date) < now)
        const archiveYears = [...new Set(archivedRaces.map(r => new Date(r.event_date).getFullYear()))].sort((a,b) => b - a)
        const archivedInYear = archivedRaces.filter(r => new Date(r.event_date).getFullYear() === yearFilter)

        return (
          <div className="space-y-3">
            {/* Section: Race Aktif */}
            {activeRaces.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-3">🏁 Race Aktif</div>
                <div className="flex gap-2 flex-wrap">
                  {activeRaces.map(r => (
                    <button key={r.id} onClick={() => setActiveRaceId(r.id)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        activeRaceId === r.id
                          ? 'bg-indigo-600 text-white shadow-md'
                          : 'bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100'
                      }`}>
                      {r.status === 'A' ? '⭐' : '🏆'} {r.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${
                        activeRaceId === r.id ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-500'
                      }`}>
                        {new Date(r.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Section: Arsip */}
            {archivedRaces.length > 0 && (
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                {/* Arsip header — toggle */}
                <button onClick={() => setArchiveOpen(o => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`text-gray-400 text-xs transition-transform ${archiveOpen ? 'rotate-90' : ''}`}>▶</span>
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">🗄️ Arsip Race</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 font-semibold">{archivedRaces.length} race</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{archiveOpen ? 'Tutup' : 'Lihat arsip'}</span>
                </button>

                {/* Arsip content */}
                {archiveOpen && (
                  <div className="p-4 space-y-3 bg-white">
                    {/* Year tabs */}
                    {archiveYears.length > 1 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {archiveYears.map(y => (
                          <button key={y} onClick={() => setYearFilter(y)}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                              yearFilter === y
                                ? 'bg-gray-700 text-white'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}>
                            {y}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Race list in selected year */}
                    <div className="flex gap-2 flex-wrap">
                      {archivedInYear.map(r => (
                        <button key={r.id} onClick={() => setActiveRaceId(r.id)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                            activeRaceId === r.id
                              ? 'bg-gray-700 text-white shadow'
                              : 'bg-gray-50 border border-gray-200 text-gray-600 hover:border-gray-400'
                          }`}>
                          🏅 {r.name}
                          <span className={`text-[10px] font-normal ${activeRaceId === r.id ? 'opacity-70' : 'text-gray-400'}`}>
                            {new Date(r.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Jika tidak ada race sama sekali */}
            {activeRaces.length === 0 && archivedRaces.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-4">Belum ada race. Tambahkan di Race Management.</div>
            )}
          </div>
        )
      })()}

      {activeRace && (
        <>
          {/* Race info bar */}
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl px-5 py-3 flex flex-wrap gap-4 items-center">
            <div>
              <div className="text-[10px] font-bold text-indigo-400 uppercase">Race</div>
              <div className="text-sm font-bold text-indigo-800">{activeRace.name}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-indigo-400 uppercase">Tanggal</div>
              <div className="text-sm font-semibold text-gray-700">
                {new Date(activeRace.event_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-indigo-400 uppercase">Target</div>
              <div className="text-sm font-semibold text-gray-700">{activeRace.target_finish || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold text-indigo-400 uppercase">Status</div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                isPast ? 'bg-gray-100 text-gray-500'
                : activeRace.status === 'A' ? 'bg-indigo-100 text-indigo-700'
                : 'bg-amber-100 text-amber-700'
              }`}>
                {isPast ? '🏅 Selesai' : activeRace.status === 'A' ? 'Main Race (A)' : 'Race Sela (B)'}
              </span>
            </div>
          </div>

          {/* Archived banner */}
          {isPast && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
              canEdit ? 'bg-amber-50 border border-amber-200 text-amber-700' : 'bg-gray-50 border border-gray-200 text-gray-500'
            }`}>
              {canEdit ? '✏️ Mode Coach/Admin — data arsip bisa diedit.' : '🔒 Race sudah selesai — data tersimpan sebagai arsip, read-only.'}
            </div>
          )}

          {/* Section tabs */}
          <div className="bg-gray-100 rounded-xl p-1 flex gap-1 flex-wrap w-fit">
            {([
              ['notes',    '📋 Strategy Notes'],
              ['pbs',      '📊 Pace Band'],
              ['stc',      '⏱️ Split Time'],
              ['cues',     '🧠 Mental Cues'],
              ['racenotes','📝 Race Day Notes'],
            ] as const).map(([t, label]) => (
              <button key={t} onClick={() => setActiveTab(t)} className={tabCls(t)}>{label}</button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'notes'    && <StrategyNotesTab race={activeRace} slug={slug} data={data} canEdit={canEdit} onSave={v => saveField('strategy_notes', v)} />}
          {activeTab === 'pbs'      && <PaceBandTab race={activeRace} />}
          {activeTab === 'stc'      && <SplitTimeTab race={activeRace} />}
          {activeTab === 'cues'     && <MentalCuesTab race={activeRace} slug={slug} data={data} canEdit={canEdit} onSave={v => saveField('cue_cards', JSON.stringify(v))} />}
          {activeTab === 'racenotes'&& <RaceDayNotesTab race={activeRace} data={data} canEdit={canEdit} onSave={v => saveField('race_day_notes', v)} />}
        </>
      )}
    </div>
  )
}

// ─── Tab: Strategy Notes ──────────────────────────────────────────────────────
function StrategyNotesTab({ race, slug, data, canEdit, onSave }: {
  race: Race; slug: string; data: StrategyData; canEdit: boolean; onSave: (v: string) => void
}) {
  const defaultContent = DEFAULT_STRATEGY_NOTES[slug] || `## 🏅 Race Overview\n**Race:** ${race.name}\n**Target:** ${race.target_finish || '—'}\n\n## 🏃 Pace Strategy\n- **Km 1–3:** Mulai konservatif\n- **Km 4–15:** Target pace stabil\n- **Km 16–21.1:** Push terkontrol`
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(data.strategyNotes || defaultContent)
    setEditing(true)
  }
  function save() {
    onSave(draft)
    setEditing(false)
  }

  const content = data.strategyNotes || defaultContent

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="font-gsans text-base text-indigo-700 uppercase">📋 Race Strategy Notes</div>
        {!editing
          ? canEdit && <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-semibold hover:bg-indigo-100">✏️ Edit</button>
          : <div className="flex gap-2">
              <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">💾 Simpan</button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Batal</button>
            </div>
        }
      </div>
      <div className="p-5">
        {editing ? (
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            className="w-full border border-indigo-200 rounded-xl px-4 py-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300 min-h-[280px]" />
        ) : (
          <div className="text-sm leading-relaxed text-gray-700"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }} />
        )}
        {!editing && (
          <div className="mt-3 text-[10px] text-gray-400 flex flex-wrap gap-2">
            <span className="bg-gray-100 px-2 py-0.5 rounded font-mono">## Judul</span>
            <span className="bg-gray-100 px-2 py-0.5 rounded font-mono">**bold**</span>
            <span className="bg-gray-100 px-2 py-0.5 rounded font-mono">- list</span>
            <span className="bg-gray-100 px-2 py-0.5 rounded font-mono">&gt; quote</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Pace Band Simulator ─────────────────────────────────────────────────
function PaceBandTab({ race }: { race: Race }) {
  const [target, setTarget]   = useState(race.target_finish || '2:30:00')
  const [strategy, setStrategy] = useState<keyof typeof PBS_STRATEGIES>('even')
  const [tol, setTol]         = useState(10)
  const [rwr, setRwr]         = useState<RwrState>({ enabled: false, runPace: '', walkPace: '', runSec: '', walkSec: '' })
  const [result, setResult]   = useState<{ rows: PbsRow[]; targetSec: number; estSec: number; avgPace: number } | null>(null)

  interface PbsRow { label: string; hint: string; pace: number; paceMin: number; paceMax: number; segTime: number; cumTime: number; factor: number }

  function calculate() {
    const targetSec = parseTargetSec(target)
    if (!targetSec) return
    const dist = 21.1
    const avgPace = targetSec / dist
    const strat = PBS_STRATEGIES[strategy]

    const blended = rwr.enabled
      ? calcBlended(parsePaceSec(rwr.runPace) || 0, parsePaceSec(rwr.walkPace) || 0, parseFloat(rwr.runSec) || 0, parseFloat(rwr.walkSec) || 0)
      : null
    const effectiveAvg = blended || avgPace

    let cumTime = 0
    const rows: PbsRow[] = PBS_SEGMENTS.map((seg, i) => {
      const pace = effectiveAvg * strat.factors[i]
      const segTime = pace * seg.km
      cumTime += segTime
      return { label: seg.label, hint: seg.hint, pace, paceMin: pace - tol, paceMax: pace + tol, segTime, cumTime, factor: strat.factors[i] }
    })

    setResult({ rows, targetSec, estSec: cumTime, avgPace })
  }

  const chartData = result?.rows.map(r => ({ name: r.label, pace: parseFloat((r.pace / 60).toFixed(2)) }))

  return (
    <div className="space-y-4">
      {/* Form */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="font-gsans text-base text-indigo-700 uppercase mb-4">📊 Pace Band Simulator</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Target Finish Time</div>
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="2:30:00"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Strategi Pacing</div>
            <select value={strategy} onChange={e => setStrategy(e.target.value as any)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300">
              <option value="even">Even Split</option>
              <option value="negative">Negative Split</option>
              <option value="conservative">Conservative Start</option>
            </select>
          </div>
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Toleransi (±detik/km)</div>
            <input type="number" value={tol} onChange={e => setTol(parseInt(e.target.value) || 10)} min={5} max={30}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
        </div>
        <RwrPanel prefix="pbs" state={rwr} onChange={setRwr} />
        <button onClick={calculate}
          className="mt-4 w-full bg-indigo-600 text-white font-semibold rounded-xl py-2.5 text-sm hover:bg-indigo-700 transition-colors">
          🧮 Generate Pace Band
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          {/* Summary badges */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold bg-indigo-600 text-white">🎯 Target: {target}</span>
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700">📊 {PBS_STRATEGIES[strategy].label}</span>
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700">⚡ Avg: {fmtPace(result.avgPace)}</span>
            {rwr.enabled && <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-100 text-indigo-700">🔀 Mode RWR</span>}
            <DeltaBadge estSec={result.estSec} targetSec={result.targetSec} />
          </div>

          {/* Bar chart */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} tickFormatter={v => `${v}'`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} mnt/km`, 'Pace']} />
                <Bar dataKey="pace" radius={[4,4,0,0]}>
                  {result.rows.map((r, i) => (
                    <Cell key={i} fill={r.factor < 1 ? '#6ee7b7' : r.factor > 1 ? '#fca5a5' : '#a5b4fc'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left py-2">Segmen</th>
                  <th className="text-left py-2 text-gray-400 font-normal text-xs">Keterangan</th>
                  <th className="text-center py-2">Pace Target</th>
                  <th className="text-center py-2">Range ±{tol}s</th>
                  <th className="text-center py-2">Seg. Time</th>
                  <th className="text-center py-2">Kumulatif</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 font-bold text-gray-800">{r.label}</td>
                    <td className="py-2.5 text-xs text-gray-400">{r.hint}</td>
                    <td className="py-2.5 text-center">
                      <span className="px-2 py-0.5 rounded font-bold text-gray-800 text-sm"
                        style={{ background: r.factor < 1 ? '#d1fae5' : r.factor > 1 ? '#fee2e2' : '#f8fafc' }}>
                        {fmtPace(r.pace)}
                      </span>
                    </td>
                    <td className="py-2.5 text-center text-xs text-gray-500 font-mono">{fmtPace(r.paceMin)} – {fmtPace(r.paceMax)}</td>
                    <td className="py-2.5 text-center font-semibold text-gray-700">{fmtTime(r.segTime)}</td>
                    <td className="py-2.5 text-center font-bold text-indigo-600">{fmtTime(r.cumTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-400">💡 Hijau = lebih cepat dari avg, merah = lebih lambat dari avg. Screenshot untuk dibawa race day.</div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Split Time Calculator ───────────────────────────────────────────────
function SplitTimeTab({ race }: { race: Race }) {
  const [pace, setPace]   = useState('')
  const [targetFinish, setTargetFinish] = useState(race.target_finish || '')
  const [startTime, setStartTime] = useState('05:00')
  const [rwr, setRwr]   = useState<RwrState>({ enabled: false, runPace: '', walkPace: '', runSec: '', walkSec: '' })
  const [result, setResult] = useState<{ rows: StcRow[]; totalSec: number; paceSec: number } | null>(null)

  interface StcRow { km: number; elapsed: number; clock: string; milestone: boolean }

  function calculate() {
    let paceSec = parsePaceSec(pace)
    if (!paceSec) return

    if (rwr.enabled) {
      const b = calcBlended(parsePaceSec(rwr.runPace) || 0, parsePaceSec(rwr.walkPace) || 0, parseFloat(rwr.runSec) || 0, parseFloat(rwr.walkSec) || 0)
      if (b) paceSec = b
    }

    const [sh, sm] = startTime.split(':').map(Number)
    const startSec = sh * 3600 + sm * 60

    const rows: StcRow[] = STC_MILESTONES.map(km => {
      const elapsed = paceSec! * km
      const clockSec = startSec + elapsed
      const ch = Math.floor(clockSec / 3600) % 24
      const cm = Math.floor((clockSec % 3600) / 60)
      const cs = Math.round(clockSec % 60)
      return {
        km,
        elapsed,
        clock: `${String(ch).padStart(2,'0')}:${String(cm).padStart(2,'0')}:${String(cs).padStart(2,'0')}`,
        milestone: [5,10,15,21.1].includes(km),
      }
    })

    setResult({ rows, totalSec: paceSec * 21.1, paceSec })
  }

  const targetSec = targetFinish ? parseTargetSec(targetFinish) : 0

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="font-gsans text-base text-indigo-700 uppercase mb-4">⏱️ Split Time Calculator</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Pace Target (M:SS/km)</div>
            <input value={pace} onChange={e => { setPace(e.target.value); setResult(null) }} placeholder="6:24"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Target Finish Time</div>
            <input value={targetFinish} onChange={e => setTargetFinish(e.target.value)} placeholder="2:15:00"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase mb-1">Jam Start Race</div>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300" />
          </div>
        </div>
        <RwrPanel prefix="stc" state={rwr} onChange={setRwr} />
        <button onClick={calculate}
          className="mt-4 w-full bg-indigo-600 text-white font-semibold rounded-xl py-2.5 text-sm hover:bg-indigo-700 transition-colors">
          🧮 Hitung Split Time
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold bg-indigo-600 text-white">⏱️ Projected: {fmtTime(result.totalSec)}</span>
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700">🚀 Start: {startTime}</span>
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700">⚡ Pace: {fmtPace(result.paceSec)}</span>
            {rwr.enabled && <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-100 text-indigo-700">🔀 Mode RWR</span>}
            {targetSec > 0 && <DeltaBadge estSec={result.totalSec} targetSec={targetSec} />}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-bold text-gray-400 uppercase border-b border-gray-100">
                  <th className="text-left py-2">Checkpoint</th>
                  <th className="text-center py-2">Elapsed</th>
                  <th className="text-center py-2">Clock Time</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 ${r.milestone ? 'bg-indigo-50' : ''}`}>
                    <td className={`py-2.5 ${r.milestone ? 'font-bold text-indigo-700' : 'text-gray-700'}`}>
                      {r.km === 21.1 ? 'Finish (21.1)' : `Km ${r.km}`}
                    </td>
                    <td className="py-2.5 text-center text-gray-600">{fmtTime(r.elapsed)}</td>
                    <td className={`py-2.5 text-center font-mono ${r.milestone ? 'font-bold text-indigo-600' : 'text-gray-700'}`}>{r.clock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-400">💡 Baris biru = milestone utama (km 5, 10, 15, finish). Screenshot untuk dibawa race day.</div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Mental Cue Cards ────────────────────────────────────────────────────
function MentalCuesTab({ race, slug, data, canEdit, onSave }: {
  race: Race; slug: string; data: StrategyData; canEdit: boolean; onSave: (v: CueCard[]) => void
}) {
  const defaultCues = DEFAULT_CUES[slug] || []
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CueCard[]>([])

  function startEdit() {
    setDraft(JSON.parse(JSON.stringify(data.cueCards || defaultCues)))
    setEditing(true)
  }

  function save() {
    onSave(draft)
    setEditing(false)
  }

  function updateCard(i: number, field: keyof CueCard, val: string) {
    setDraft(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
  }

  function addCard() {
    setDraft(prev => [...prev, { phase: `Fase ${prev.length + 1}`, cue: '', sub: '', color: '#eff6ff', textColor: '#1e40af' }])
  }

  function removeCard(i: number) {
    setDraft(prev => prev.filter((_, idx) => idx !== i))
  }

  const cues = data.cueCards || defaultCues

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="font-gsans text-base text-indigo-700 uppercase">🧠 Mental Cue Cards — {race.name}</div>
        {!editing
          ? canEdit && <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-semibold hover:bg-indigo-100">✏️ Edit</button>
          : <div className="flex gap-2">
              <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">💾 Simpan</button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Batal</button>
            </div>
        }
      </div>
      <div className="p-5">
        {!editing ? (
          cues.length === 0
            ? <div className="text-center text-gray-400 py-8">Belum ada mental cue. Klik Edit untuk menambahkan.</div>
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {cues.map((c, i) => (
                  <div key={i} className="rounded-xl p-4 border"
                    style={{ background: c.color, borderColor: c.color }}>
                    <div className="text-xs font-bold uppercase mb-1" style={{ color: c.textColor }}>{c.phase}</div>
                    <div className="text-sm font-bold leading-snug" style={{ color: c.textColor }}>{c.cue}</div>
                    {c.sub && <div className="text-xs mt-1 opacity-80" style={{ color: c.textColor }}>{c.sub}</div>}
                  </div>
                ))}
              </div>
        ) : (
          <div className="space-y-3">
            {draft.map((c, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-gray-400">CARD {i + 1}</span>
                  <button onClick={() => removeCard(i)}
                    className="text-xs px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100">🗑️</button>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Fase / Label</div>
                    <input value={c.phase} onChange={e => updateCard(i, 'phase', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Bg Color</div>
                      <input type="color" value={c.color} onChange={e => updateCard(i, 'color', e.target.value)}
                        className="w-full h-9 border border-gray-200 rounded-lg px-1 py-1 focus:outline-none cursor-pointer" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Text Color</div>
                      <input type="color" value={c.textColor} onChange={e => updateCard(i, 'textColor', e.target.value)}
                        className="w-full h-9 border border-gray-200 rounded-lg px-1 py-1 focus:outline-none cursor-pointer" />
                    </div>
                  </div>
                </div>
                <div className="mb-2">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Mental Cue (kalimat utama)</div>
                  <input value={c.cue} onChange={e => updateCard(i, 'cue', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:outline-none" />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Sub-teks (opsional)</div>
                  <input value={c.sub || ''} onChange={e => updateCard(i, 'sub', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none" />
                </div>
              </div>
            ))}
            <button onClick={addCard}
              className="w-full border-2 border-dashed border-indigo-200 rounded-xl py-2 text-sm text-indigo-500 hover:bg-indigo-50 font-semibold">
              + Tambah Card
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: Race Day Notes ──────────────────────────────────────────────────────
function RaceDayNotesTab({ race, data, canEdit, onSave }: {
  race: Race; data: StrategyData; canEdit: boolean; onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(data.raceDayNotes || '')
    setEditing(true)
  }
  function save() {
    onSave(draft)
    setEditing(false)
  }

  const content = data.raceDayNotes || ''

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="font-gsans text-base text-indigo-700 uppercase">📝 Race Day Notes — {race.name}</div>
        {!editing
          ? canEdit && <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-semibold hover:bg-indigo-100">✏️ Edit</button>
          : <div className="flex gap-2">
              <button onClick={save} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">💾 Simpan</button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Batal</button>
            </div>
        }
      </div>
      <div className="p-5">
        {editing ? (
          <textarea value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={`Tulis catatan bebas untuk race day ${race.name}...\n\nContoh:\n- Sarapan nasi + telur 2.5 jam sebelum start\n- Gel pertama km 7\n- Topi wajib — cuaca panas`}
            className="w-full border border-indigo-200 rounded-xl px-4 py-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300 min-h-[200px]" />
        ) : content ? (
          <div className="text-sm leading-relaxed text-gray-700"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }} />
        ) : (
          <div className="text-center text-gray-400 py-8">
            <div className="text-3xl mb-2">📝</div>
            Belum ada catatan race day. Klik Edit untuk menambahkan.
          </div>
        )}
      </div>
    </div>
  )
}
