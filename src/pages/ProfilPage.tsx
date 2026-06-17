import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { EmptyState } from '../components/ui/EmptyState'

interface AthleteSettings {
  lthr: number | null
  easy_pace_min: number | null
  easy_pace_sec: number | null
  resting_hr: number | null
  max_hr: number | null
  weight_kg: number | null
  height_cm: number | null
  training_age_years: number | null
  domisili: string | null
}

interface TtEntry {
  id: string
  tt_date: string
  distance_km: number
  finish_time_sec: number
  vdot: number | null
  hr_avg: number | null
  notes: string | null
}

function calcVdot(distanceM: number, finishTimeSec: number): number {
  const v = distanceM / finishTimeSec * 60
  const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
  const pctVo2 = 0.8 + 0.1894393 * Math.exp(-0.012778 * finishTimeSec / 60)
               + 0.2989558 * Math.exp(-0.1932605 * finishTimeSec / 60)
  return parseFloat((vo2 / pctVo2).toFixed(1))
}

function easyPaceFromVdot(vdot: number): string {
  const targetPct = 0.65
  let lo = 100, hi = 600
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const vo2atV = -4.60 + 0.182258 * mid + 0.000104 * mid * mid
    if (vo2atV / vdot < targetPct) lo = mid; else hi = mid
  }
  const secPerKm = 1000 / ((lo + hi) / 2) * 60
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function predictTime(knownDist: number, knownTimeSec: number, targetDist: number): string {
  const sec = knownTimeSec * Math.pow(targetDist / knownDist, 1.06)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseTimeToSec(val: string): number | null {
  const parts = val.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

const TT_DISTANCES = [
  { label: 'Magic Mile (1.6 km)', value: 1.6 },
  { label: '5K', value: 5.0 },
  { label: '10K', value: 10.0 },
  { label: 'Half Marathon', value: 21.0975 },
]

const emptySettings: AthleteSettings = {
  lthr: null, easy_pace_min: null, easy_pace_sec: null,
  resting_hr: null, max_hr: null, weight_kg: null,
  height_cm: null, training_age_years: null, domisili: null,
}

const emptyTtForm = {
  tt_date: new Date().toISOString().split('T')[0],
  distance_km: '5.0',
  finish_time: '',
  hr_avg: '',
  notes: '',
}

export default function ProfilPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [settings, setSettings] = useState<AthleteSettings>(emptySettings)
  const [ttList, setTtList] = useState<TtEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [showTtForm, setShowTtForm] = useState(false)
  const [ttForm, setTtForm] = useState(emptyTtForm)
  const [ttSaving, setTtSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const [settingsResult, ttResult] = await Promise.all([
        supabase
          .from('athlete_settings')
          .select('lthr, easy_pace_min, easy_pace_sec, resting_hr, max_hr, weight_kg, height_cm, training_age_years, domisili')
          .eq('athlete_id', athleteId!)
          .maybeSingle(),
        supabase
          .from('tt_history')
          .select('id, tt_date, distance_km, finish_time_sec, vdot, hr_avg, notes')
          .eq('athlete_id', athleteId!)
          .order('tt_date', { ascending: false })
      ])
      if (!cancelled) {
        if (settingsResult.error) console.error('[PaceIQ] athlete_settings:', settingsResult.error.message)
        if (ttResult.error) console.error('[PaceIQ] tt_history:', ttResult.error.message)
        if (settingsResult.data) setSettings(settingsResult.data)
        if (ttResult.data) setTtList(ttResult.data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  async function reloadSettings() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('athlete_settings')
      .select('lthr, easy_pace_min, easy_pace_sec, resting_hr, max_hr, weight_kg, height_cm, training_age_years, domisili')
      .eq('athlete_id', athleteId!)
      .maybeSingle()
    if (err) console.error('[PaceIQ] athlete_settings:', err.message)
    if (data) setSettings(data)
  }

  async function reloadTt() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('tt_history')
      .select('id, tt_date, distance_km, finish_time_sec, vdot, hr_avg, notes')
      .eq('athlete_id', athleteId!)
      .order('tt_date', { ascending: false })
    if (err) console.error('[PaceIQ] tt_history:', err.message)
    if (data) setTtList(data)
  }

  function openEdit() {
    setSettingsForm({
      lthr: settings.lthr?.toString() ?? '',
      easy_pace_min: settings.easy_pace_min?.toString() ?? '',
      easy_pace_sec: settings.easy_pace_sec?.toString() ?? '',
      resting_hr: settings.resting_hr?.toString() ?? '',
      max_hr: settings.max_hr?.toString() ?? '',
      weight_kg: settings.weight_kg?.toString() ?? '',
      height_cm: settings.height_cm?.toString() ?? '',
      training_age_years: settings.training_age_years?.toString() ?? '',
      domisili: settings.domisili ?? '',
    })
    setEditMode(true)
  }

  async function saveSettings() {
    if (!athleteId) return
    setSaving(true)
    setError(null)
    const payload = {
      athlete_id: athleteId,
      lthr: settingsForm.lthr ? parseInt(settingsForm.lthr) : null,
      easy_pace_min: settingsForm.easy_pace_min ? parseInt(settingsForm.easy_pace_min) : null,
      easy_pace_sec: settingsForm.easy_pace_sec ? parseInt(settingsForm.easy_pace_sec) : null,
      resting_hr: settingsForm.resting_hr ? parseInt(settingsForm.resting_hr) : null,
      max_hr: settingsForm.max_hr ? parseInt(settingsForm.max_hr) : null,
      weight_kg: settingsForm.weight_kg ? parseFloat(settingsForm.weight_kg) : null,
      height_cm: settingsForm.height_cm ? parseInt(settingsForm.height_cm) : null,
      training_age_years: settingsForm.training_age_years ? parseInt(settingsForm.training_age_years) : null,
      domisili: settingsForm.domisili || null,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = await supabase
      .from('athlete_settings')
      .upsert(payload, { onConflict: 'athlete_id' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setEditMode(false)
    await reloadSettings()
  }

  async function saveTt() {
    if (!athleteId) return
    setError(null)
    const finishSec = parseTimeToSec(ttForm.finish_time)
    if (!finishSec) { setError('Format waktu tidak valid. Gunakan MM:SS atau HH:MM:SS.'); return }
    const distM = parseFloat(ttForm.distance_km) * 1000
    const vdot = calcVdot(distM, finishSec)
    setTtSaving(true)
    const { error: err } = await supabase.from('tt_history').insert({
      athlete_id: athleteId,
      tt_date: ttForm.tt_date,
      distance_km: parseFloat(ttForm.distance_km),
      finish_time_sec: finishSec,
      vdot,
      hr_avg: ttForm.hr_avg ? parseInt(ttForm.hr_avg) : null,
      notes: ttForm.notes || null,
    })
    setTtSaving(false)
    if (err) { setError(err.message); return }
    setTtForm(emptyTtForm)
    setShowTtForm(false)
    await reloadTt()
  }

  async function deleteTt(id: string) {
    if (!confirm('Hapus entri TT ini?')) return
    const { error: err } = await supabase.from('tt_history').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete tt:', err.message); return }
    await reloadTt()
  }

  const latestTt = ttList[0] ?? null
  const vdot = latestTt?.vdot ?? null
  const easyPace = vdot ? easyPaceFromVdot(vdot) : null
  const predictedHm = latestTt ? predictTime(latestTt.distance_km * 1000, latestTt.finish_time_sec, 21097.5) : null
  const predicted10k = latestTt ? predictTime(latestTt.distance_km * 1000, latestTt.finish_time_sec, 10000) : null

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Profil & Analisis" subtitle="Data performa dan analitik personal" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Profil & Analisis"
        subtitle={athlete?.name ?? ''}
        action={
          !editMode ? (
            <button onClick={openEdit}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Edit Profil
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="VDOT" value={vdot?.toFixed(1) ?? '—'} accent="indigo" />
        <StatCard label="Easy Pace" value={easyPace ?? '—'} sub="/km" accent="green" />
        <StatCard label="Predicted HM" value={predictedHm ?? '—'} accent="default" />
        <StatCard label="Predicted 10K" value={predicted10k ?? '—'} accent="default" />
        <StatCard label="LTHR" value={settings.lthr ? `${settings.lthr} bpm` : '—'} accent="amber" />
        <StatCard label="HR Rest" value={settings.resting_hr ? `${settings.resting_hr} bpm` : '—'} />
        <StatCard label="HR Max" value={settings.max_hr ? `${settings.max_hr} bpm` : '—'} />
        <StatCard label="Berat" value={settings.weight_kg ? `${settings.weight_kg} kg` : '—'} />
      </div>

      {editMode && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Edit Settings</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { key: 'lthr', label: 'LTHR (bpm)', placeholder: '160' },
              { key: 'resting_hr', label: 'HR Rest (bpm)', placeholder: '48' },
              { key: 'max_hr', label: 'HR Max (bpm)', placeholder: '185' },
              { key: 'easy_pace_min', label: 'Easy Pace (menit)', placeholder: '7' },
              { key: 'easy_pace_sec', label: 'Easy Pace (detik)', placeholder: '30' },
              { key: 'weight_kg', label: 'Berat (kg)', placeholder: '58.5' },
              { key: 'height_cm', label: 'Tinggi (cm)', placeholder: '163' },
              { key: 'training_age_years', label: 'Training Age (tahun)', placeholder: '2' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input type="number"
                  value={settingsForm[f.key] ?? ''}
                  onChange={e => setSettingsForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            ))}
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-gray-500 mb-1">Domisili</label>
              <input type="text"
                value={settingsForm.domisili ?? ''}
                onChange={e => setSettingsForm(prev => ({ ...prev, domisili: e.target.value }))}
                placeholder="Makassar, Sulawesi Selatan"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button onClick={saveSettings} disabled={saving}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            <button onClick={() => setEditMode(false)}
              className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Batal
            </button>
          </div>
        </div>
      )}

      {!editMode && (
        <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Settings</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-gray-400">Domisili:</span> <span className="text-gray-700">{settings.domisili ?? '—'}</span></div>
            <div><span className="text-gray-400">Training Age:</span> <span className="text-gray-700">{settings.training_age_years != null ? `${settings.training_age_years} tahun` : '—'}</span></div>
            <div><span className="text-gray-400">Tinggi:</span> <span className="text-gray-700">{settings.height_cm ? `${settings.height_cm} cm` : '—'}</span></div>
            <div>
              <span className="text-gray-400">Easy Pace:</span>{' '}
              <span className="text-gray-700">
                {settings.easy_pace_min != null && settings.easy_pace_sec != null
                  ? `${settings.easy_pace_min}:${String(settings.easy_pace_sec).padStart(2, '0')} /km`
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Time Trial History</h3>
          <button onClick={() => { setShowTtForm(v => !v); setError(null) }}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            {showTtForm ? 'Batal' : '+ Input TT'}
          </button>
        </div>

        {showTtForm && (
          <div className="mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tanggal</label>
                <input type="date" value={ttForm.tt_date}
                  onChange={e => setTtForm(p => ({ ...p, tt_date: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jarak</label>
                <select value={ttForm.distance_km}
                  onChange={e => setTtForm(p => ({ ...p, distance_km: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  {TT_DISTANCES.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Waktu (MM:SS atau HH:MM:SS)</label>
                <input type="text" value={ttForm.finish_time} placeholder="25:30"
                  onChange={e => setTtForm(p => ({ ...p, finish_time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">HR Avg (bpm)</label>
                <input type="number" value={ttForm.hr_avg} placeholder="165"
                  onChange={e => setTtForm(p => ({ ...p, hr_avg: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Catatan</label>
                <input type="text" value={ttForm.notes} placeholder="Kondisi, cuaca..."
                  onChange={e => setTtForm(p => ({ ...p, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
            <button onClick={saveTt} disabled={ttSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {ttSaving ? 'Menyimpan...' : 'Simpan TT'}
            </button>
          </div>
        )}

        {ttList.length === 0 ? (
          <EmptyState title="Belum ada time trial" description="Input TT untuk menghitung VDOT dan prediksi race." />
        ) : (
          <div className="space-y-2">
            {ttList.map(tt => (
              <div key={tt.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-400 text-xs">
                      {new Date(tt.tt_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    <span className="font-medium text-gray-700">{tt.distance_km} km</span>
                    <span className="text-gray-600">{formatTime(tt.finish_time_sec)}</span>
                    {tt.vdot && <span className="text-indigo-600 font-semibold">VDOT {tt.vdot}</span>}
                    {tt.hr_avg && <span className="text-gray-400 text-xs">❤️ {tt.hr_avg} bpm</span>}
                  </div>
                  {tt.notes && <p className="text-xs text-gray-400 mt-0.5 italic">{tt.notes}</p>}
                </div>
                <button onClick={() => deleteTt(tt.id)}
                  className="text-xs text-red-400 hover:text-red-600 ml-4 shrink-0">
                  Hapus
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}