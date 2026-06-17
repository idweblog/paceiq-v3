import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface NutritionLog {
  id: string
  log_date: string
  pre_run_meal: string | null
  during_run_fuel: string | null
  post_run_meal: string | null
  hydration_ml: number | null
  electrolytes: string | null
  notes: string | null
}

const emptyForm = {
  log_date: new Date().toISOString().split('T')[0],
  pre_run_meal: '',
  during_run_fuel: '',
  post_run_meal: '',
  hydration_ml: '',
  electrolytes: '',
  notes: '',
}

const RACE_DAY_GUIDE = [
  { time: 'H-2 & H-1', tip: 'Karbohidrat loading: nasi, pasta, roti. Hindari makanan baru atau tinggi serat.' },
  { time: '3–4 jam sebelum start', tip: 'Sarapan ringan: nasi + telur, roti + selai kacang. 500–750ml air.' },
  { time: '1 jam sebelum start', tip: 'Gel atau pisang jika dibutuhkan. Sip air kecil-kecil.' },
  { time: 'Setiap 45–60 menit', tip: 'Gel 1 sachet (25g carbs). Minum di water station, jangan tunggu haus.' },
  { time: 'Post-race 30 menit', tip: '3:1 carbs:protein ratio. Cokelat susu, recovery shake, atau nasi + ayam.' },
]

const TRAINING_GUIDE = [
  { time: '2–3 jam sebelum easy run', tip: 'Makanan normal. Tidak perlu loading untuk sesi < 60 menit.' },
  { time: 'Sebelum long run (> 90 mnt)', tip: 'Sarapan karbohidrat 2–3 jam sebelumnya. Gel di km 10–12.' },
  { time: 'Selama interval/tempo', tip: 'Cukup air. Gel tidak diperlukan untuk sesi < 75 menit.' },
  { time: 'Post-run (< 30 menit)', tip: 'Recovery window: protein 20–30g + karbohidrat. Penting untuk adaptasi.' },
]

const RECOVERY_GUIDE = [
  { time: 'Hari pertama post-race', tip: 'Fokus anti-inflamasi: salmon, blueberry, kunyit, jahe. Hindari alkohol.' },
  { time: 'Hidrasi', tip: 'Monitor warna urin — target kuning muda. Elektrolit minimal 24 jam post-race.' },
  { time: 'Hari 2–4', tip: 'Protein tinggi untuk repair otot: 1.6–2.0g/kg berat badan per hari.' },
  { time: 'Suplemen opsional', tip: 'Magnesium (cramp prevention), Omega-3 (anti-inflamasi), Vitamin C+D.' },
]

export default function NutritionPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [logs, setLogs] = useState<NutritionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'log' | 'raceday' | 'training' | 'recovery'>('log')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('nutrition_log')
        .select('id, log_date, pre_run_meal, during_run_fuel, post_run_meal, hydration_ml, electrolytes, notes')
        .eq('athlete_id', athleteId!)
        .order('log_date', { ascending: false })
        .limit(30)
      if (!cancelled) {
        if (err) console.error('[PaceIQ] nutrition_log:', err.message)
        if (data) setLogs(data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  async function reloadLogs() {
    if (!athleteId) return
    const { data, error: err } = await supabase
      .from('nutrition_log')
      .select('id, log_date, pre_run_meal, during_run_fuel, post_run_meal, hydration_ml, electrolytes, notes')
      .eq('athlete_id', athleteId!)
      .order('log_date', { ascending: false })
      .limit(30)
    if (err) console.error('[PaceIQ] nutrition_log:', err.message)
    if (data) setLogs(data)
  }

  async function handleSubmit() {
    if (!athleteId) return
    setError(null)
    setSaving(true)
    const { error: err } = await supabase.from('nutrition_log').insert({
      athlete_id: athleteId,
      log_date: form.log_date,
      pre_run_meal: form.pre_run_meal || null,
      during_run_fuel: form.during_run_fuel || null,
      post_run_meal: form.post_run_meal || null,
      hydration_ml: form.hydration_ml ? parseInt(form.hydration_ml) : null,
      electrolytes: form.electrolytes || null,
      notes: form.notes || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(emptyForm)
    setShowForm(false)
    await reloadLogs()
  }

  async function handleDelete(id: string) {
    if (!confirm('Hapus log ini?')) return
    const { error: err } = await supabase.from('nutrition_log').delete().eq('id', id)
    if (err) { console.error('[PaceIQ] delete nutrition:', err.message); return }
    await reloadLogs()
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  const labelCls = "block text-xs text-gray-500 mb-1"

  const tabs = [
    { key: 'log',      label: '📋 Log Nutrisi' },
    { key: 'raceday',  label: '🏁 Race Day' },
    { key: 'training', label: '🏃 Training' },
    { key: 'recovery', label: '💚 Recovery' },
  ]

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Nutrition & Fueling" subtitle="Log nutrisi dan strategi fueling" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader
        title="Nutrition & Fueling"
        subtitle="Log nutrisi dan strategi fueling"
        action={
          activeTab === 'log' ? (
            <button onClick={() => { setShowForm(v => !v); setError(null) }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              {showForm ? 'Batal' : '+ Tambah Log'}
            </button>
          ) : undefined
        }
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'log' && (
        <>
          {showForm && (
            <div className="bg-white rounded-xl shadow-sm p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Log Nutrisi Baru</h3>
              {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Tanggal</label>
                  <input type="date" value={form.log_date} className={inputCls}
                    onChange={e => setForm(p => ({ ...p, log_date: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Hidrasi Total (ml)</label>
                  <input type="number" value={form.hydration_ml} placeholder="2500" className={inputCls}
                    onChange={e => setForm(p => ({ ...p, hydration_ml: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Pre-run / Sarapan</label>
                  <input type="text" value={form.pre_run_meal} placeholder="Nasi + telur + pisang" className={inputCls}
                    onChange={e => setForm(p => ({ ...p, pre_run_meal: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>During Run (gel, buah, dll)</label>
                  <input type="text" value={form.during_run_fuel} placeholder="GU Gel km 10, GU Gel km 17" className={inputCls}
                    onChange={e => setForm(p => ({ ...p, during_run_fuel: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Post-run / Recovery Meal</label>
                  <input type="text" value={form.post_run_meal} placeholder="Nasi + ayam + sayur + susu cokelat" className={inputCls}
                    onChange={e => setForm(p => ({ ...p, post_run_meal: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Elektrolit</label>
                  <input type="text" value={form.electrolytes} placeholder="Pocari 500ml, Salt tab 2x" className={inputCls}
                    onChange={e => setForm(p => ({ ...p, electrolytes: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Catatan</label>
                  <textarea value={form.notes} rows={2} className={inputCls}
                    placeholder="GI issues, energi rendah di km 15, dll..."
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <div className="mt-4 flex gap-3">
                <button onClick={handleSubmit} disabled={saving}
                  className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button onClick={() => setShowForm(false)}
                  className="px-5 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                  Batal
                </button>
              </div>
            </div>
          )}

          {logs.length === 0 ? (
            <EmptyState title="Belum ada log nutrisi" description="Mulai tracking nutrisi harianmu." />
          ) : (
            <div className="space-y-3">
              {logs.map(log => (
                <div key={log.id} className="bg-white rounded-xl shadow-sm p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-700 mb-2">
                        {new Date(log.log_date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        {log.hydration_ml && <span className="ml-3 text-xs text-blue-500 font-normal">💧 {log.hydration_ml} ml</span>}
                      </p>
                      <div className="space-y-1 text-xs text-gray-500">
                        {log.pre_run_meal && <p><span className="font-medium text-gray-600">Pre:</span> {log.pre_run_meal}</p>}
                        {log.during_run_fuel && <p><span className="font-medium text-gray-600">During:</span> {log.during_run_fuel}</p>}
                        {log.post_run_meal && <p><span className="font-medium text-gray-600">Post:</span> {log.post_run_meal}</p>}
                        {log.electrolytes && <p><span className="font-medium text-gray-600">Elektrolit:</span> {log.electrolytes}</p>}
                        {log.notes && <p className="italic text-gray-400">{log.notes}</p>}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(log.id)}
                      className="text-xs text-red-400 hover:text-red-600 ml-4 shrink-0 transition-colors">
                      Hapus
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {(activeTab === 'raceday' || activeTab === 'training' || activeTab === 'recovery') && (
        <div className="space-y-3">
          {(activeTab === 'raceday' ? RACE_DAY_GUIDE : activeTab === 'training' ? TRAINING_GUIDE : RECOVERY_GUIDE).map((item, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs font-semibold text-indigo-600 mb-1">{item.time}</p>
              <p className="text-sm text-gray-600">{item.tip}</p>
            </div>
          ))}
          <p className="text-xs text-gray-400 text-center pt-2">
            Panduan bersifat umum — sesuaikan dengan kondisi, berat badan, dan intensitas latihan.
          </p>
        </div>
      )}
    </div>
  )
}