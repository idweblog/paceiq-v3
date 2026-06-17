import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface TrainingSession {
  id: string
  session_date: string
  session_type: string | null
  distance_km: number | null
  duration_sec: number | null
  pace_avg_min: number | null
  pace_avg_sec: number | null
  hr_avg: number | null
  hr_max: number | null
  trimp: number | null
  rpe: number | null
  notes: string | null
}

interface AthleteSettings {
  resting_hr: number | null
  max_hr: number | null
}

const SESSION_TYPES = [
  'Easy Run', 'Long Run', 'Tempo', 'Interval', 'Recovery',
  'Race', 'RWR Easy', 'RWR Long', 'Cross Training', 'Lainnya'
]

function calcTrimp(durationSec: number, hrAvg: number, hrRest: number, hrMax: number): number {
  const durationMin = durationSec / 60
  const hrr = (hrAvg - hrRest) / (hrMax - hrRest)
  return durationMin * hrr * 0.64 * Math.exp(1.92 * hrr)
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseDurationToSec(val: string): number | null {
  const parts = val.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

const emptyForm = {
  session_date: new Date().toISOString().split('T')[0],
  session_type: 'Easy Run',
  distance_km: '',
  duration: '',
  pace_avg_min: '',
  pace_avg_sec: '',
  hr_avg: '',
  hr_max: '',
  rpe: '',
  notes: '',
}

export default function DailyLogPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [settings, setSettings] = useState<AthleteSettings>({ resting_hr: null, max_hr: null })
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [sessionsResult, settingsResult] = await Promise.all([
        supabase
          .from('training_sessions')
          .select('id, session_date, session_type, distance_km, duration_sec, pace_avg_min, pace_avg_sec, hr_avg, hr_max, trimp, rpe, notes')
          .eq('athlete_id', athleteId!)
          .order('session_date', { ascending: false })
          .limit(50),
        supabase
          .from('athlete_settings')
          .select('resting_hr, max_hr')
          .eq('athlete_id', athleteId!)
          .maybeSingle()
      ])
      if (!cancelled) {
        if (sessionsResult.error) console.error('[PaceIQ] sessions:', sessionsResult.error.message)
        if (settingsResult.error) console.error('[PaceIQ] settings:', settingsResult.error.message)
        if (sessionsResult.data) setSessions(sessionsResult.data)
        if (settingsResult.data) setSettings(settingsResult.data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  async function reloadSessions() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('training_sessions')
      .select('id, session_date, session_type, distance_km, duration_sec, pace_avg_min, pace_avg_sec, hr_avg, hr_max, trimp, rpe, notes')
      .eq('athlete_id', athleteId!)
      .order('session_date', { ascending: false })
      .limit(50)
    if (err) console.error('[PaceIQ] sessions:', err.message)
    if (data) setSessions(data)
  }

  function handleChange(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit() {
    if (!athleteId) return
    setError(null)

    const durationSec = parseDurationToSec(form.duration)
    if (!durationSec) { setError('Format durasi tidak valid. Gunakan MM:SS atau HH:MM:SS.'); return }

    const hrAvg = form.hr_avg ? parseInt(form.hr_avg) : null
    const hrMax = form.hr_max ? parseInt(form.hr_max) : null
    const paceMin = form.pace_avg_min ? parseInt(form.pace_avg_min) : null
    const paceSec = form.pace_avg_sec ? parseInt(form.pace_avg_sec) : null

    let trimp: number | null = null
    if (hrAvg && hrMax && settings.resting_hr && settings.max_hr) {
      trimp = calcTrimp(durationSec, hrAvg, settings.resting_hr, settings.max_hr)
    } else if (hrAvg && hrMax) {
      trimp = calcTrimp(durationSec, hrAvg, 50, hrMax)
    }

    setSaving(true)
    const { error: err } = await supabase.from('training_sessions').insert({
      athlete_id: athleteId,
      session_date: form.session_date,
      session_type: form.session_type || null,
      distance_km: form.distance_km ? parseFloat(form.distance_km) : null,
      duration_sec: durationSec,
      pace_avg_min: paceMin,
      pace_avg_sec: paceSec,
      hr_avg: hrAvg,
      hr_max: hrMax,
      trimp: trimp ? parseFloat(trimp.toFixed(2)) : null,
      rpe: form.rpe ? parseInt(form.rpe) : null,
      notes: form.notes || null,
    })
    setSaving(false)

    if (err) { setError(err.message); return }
    setForm(emptyForm)
    setShowForm(false)
    await reloadSessions()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus sesi ini?')) return
    const { error: err } = await supabase.from('training_sessions').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete session:', err.message); return }
    await reloadSessions()
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Daily Log" subtitle="Input sesi latihan harian" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Daily Log"
        subtitle="Input sesi latihan harian"
        action={
          <button onClick={() => setShowForm(v => !v)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            {showForm ? 'Batal' : '+ Tambah Sesi'}
          </button>
        }
      />

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Sesi Baru</h3>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tanggal *</label>
              <input type="date" value={form.session_date}
                onChange={e => handleChange('session_date', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tipe Sesi</label>
              <select value={form.session_type}
                onChange={e => handleChange('session_type', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {SESSION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Jarak (km)</label>
              <input type="number" step="0.01" value={form.distance_km} placeholder="10.5"
                onChange={e => handleChange('distance_km', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Durasi * (MM:SS atau HH:MM:SS)</label>
              <input type="text" value={form.duration} placeholder="1:05:30"
                onChange={e => handleChange('duration', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pace Avg (menit)</label>
              <input type="number" value={form.pace_avg_min} placeholder="7"
                onChange={e => handleChange('pace_avg_min', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Pace Avg (detik)</label>
              <input type="number" value={form.pace_avg_sec} placeholder="30"
                onChange={e => handleChange('pace_avg_sec', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">HR Avg (bpm)</label>
              <input type="number" value={form.hr_avg} placeholder="145"
                onChange={e => handleChange('hr_avg', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">HR Max (bpm)</label>
              <input type="number" value={form.hr_max} placeholder="168"
                onChange={e => handleChange('hr_max', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">RPE (1–10)</label>
              <input type="number" min="1" max="10" value={form.rpe} placeholder="6"
                onChange={e => handleChange('rpe', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-gray-500 mb-1">Catatan</label>
              <textarea value={form.notes} rows={2}
                placeholder="Kondisi, cuaca, perasaan saat latihan..."
                onChange={e => handleChange('notes', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          {!settings.resting_hr && (
            <p className="text-xs text-amber-600 mt-3">
              ⚠️ HRrest belum diset di Profil. TRIMP dihitung dengan HRrest default (50 bpm).
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <button onClick={handleSubmit} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan...' : 'Simpan Sesi'}
            </button>
            <button onClick={() => { setShowForm(false); setError(null) }}
              className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Batal
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState title="Belum ada sesi tercatat" description="Klik '+ Tambah Sesi' untuk mulai log latihan pertamamu." />
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.id} className="bg-white rounded-xl shadow-sm p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-900">
                      {new Date(s.session_date).toLocaleDateString('id-ID', {
                        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                      })}
                    </span>
                    {s.session_type && (
                      <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-medium">
                        {s.session_type}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    {s.distance_km && <span>📍 {s.distance_km} km</span>}
                    {s.duration_sec && <span>⏱ {formatDuration(s.duration_sec)}</span>}
                    {s.pace_avg_min !== null && s.pace_avg_sec !== null && (
                      <span>🏃 {s.pace_avg_min}:{String(s.pace_avg_sec).padStart(2, '0')} /km</span>
                    )}
                    {s.hr_avg && <span>❤️ {s.hr_avg} bpm</span>}
                    {s.trimp && <span>⚡ TRIMP {s.trimp.toFixed(1)}</span>}
                    {s.rpe && <span>💪 RPE {s.rpe}</span>}
                  </div>
                  {s.notes && <p className="text-xs text-gray-400 mt-1 italic">{s.notes}</p>}
                </div>
                <button onClick={() => handleDelete(s.id)}
                  className="ml-4 text-xs text-red-400 hover:text-red-600 transition-colors shrink-0">
                  Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}