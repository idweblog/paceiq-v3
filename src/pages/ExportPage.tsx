import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'

interface ImportResult {
  table: string
  inserted: number
  skipped: number
  error?: string
}

export default function ExportPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<ImportResult[]>([])
  const [importError, setImportError] = useState<string | null>(null)
  const [exportDone, setExportDone] = useState(false)

  // ── EXPORT ───────────────────────────────────────────────────
  async function handleExport() {
    if (!athleteId) return
    setExporting(true)
    setExportDone(false)

    const [
      { data: sessions },
      { data: ews },
      { data: body },
      { data: hr },
      { data: tt },
      { data: races },
      { data: nutrition },
      { data: treatment },
      { data: settings },
      { data: programs },
      { data: weeks },
    ] = await Promise.all([
      supabase.from('training_sessions').select('*').eq('athlete_id', athleteId),
      supabase.from('ews_entries').select('*').eq('athlete_id', athleteId),
      supabase.from('body_metrics').select('*').eq('athlete_id', athleteId),
      supabase.from('hr_history').select('*').eq('athlete_id', athleteId),
      supabase.from('tt_history').select('*').eq('athlete_id', athleteId),
      supabase.from('races').select('*').eq('athlete_id', athleteId),
      supabase.from('nutrition_log').select('*').eq('athlete_id', athleteId),
      supabase.from('treatment_log').select('*').eq('athlete_id', athleteId),
      supabase.from('athlete_settings').select('*').eq('athlete_id', athleteId),
      supabase.from('programs').select('*').eq('athlete_id', athleteId),
      supabase.from('program_weeks').select('*').eq('athlete_id', athleteId),
    ])

    const exportData = {
      exported_at: new Date().toISOString(),
      athlete_id: athleteId,
      athlete_name: athlete?.name,
      version: 'paceiq-v3',
      data: {
        training_sessions: sessions ?? [],
        ews_entries: ews ?? [],
        body_metrics: body ?? [],
        hr_history: hr ?? [],
        tt_history: tt ?? [],
        races: races ?? [],
        nutrition_log: nutrition ?? [],
        treatment_log: treatment ?? [],
        athlete_settings: settings ?? [],
        programs: programs ?? [],
        program_weeks: weeks ?? [],
      }
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paceiq-v3-export-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)

    setExporting(false)
    setExportDone(true)
  }

  // ── IMPORT v2.11 ─────────────────────────────────────────────
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !athleteId) return
    setImportError(null)
    setImportResults([])
    setImporting(true)

    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const results: ImportResult[] = []

      // Detect format: v2.11 localStorage export vs v3 export
      const isV3 = json.version === 'paceiq-v3'

      if (isV3) {
        // Re-import v3 export — useful for data restore
        const data = json.data

        for (const [table, rows] of Object.entries(data) as [string, any[]][]) {
          if (!Array.isArray(rows) || rows.length === 0) continue
          // Strip id and athlete_id, re-insert with current athlete_id
          const payload = rows.map((r: any) => {
            const { id, athlete_id, created_at, updated_at, ...rest } = r
            return { ...rest, athlete_id: athleteId }
          })
          const { error } = await supabase.from(table as any).insert(payload)
          results.push({
            table,
            inserted: error ? 0 : payload.length,
            skipped: 0,
            error: error?.message,
          })
        }
      } else {
        // v2.11 localStorage export mapping
        // Expected keys: hm_sessions, hm_ews, hm_bodyweight, hm_hr_history,
        // hm_tt_history, hm_race_targets, hm_nutrition, hm_treatment

        // training_sessions ← hm_sessions
        const sessions = json.hm_sessions ?? json.sessions ?? []
        if (sessions.length > 0) {
          const payload = sessions.map((s: any) => ({
            athlete_id: athleteId,
            session_date: s.date ?? s.session_date,
            session_type: s.type ?? s.session_type ?? null,
            distance_km: s.distance ?? s.distance_km ?? null,
            duration_sec: s.duration ?? s.duration_sec ?? null,
            hr_avg: s.hrAvg ?? s.hr_avg ?? null,
            hr_max: s.hrMax ?? s.hr_max ?? null,
            trimp: s.trimp ?? null,
            rpe: s.rpe ?? null,
            notes: s.notes ?? null,
          }))
          const { error } = await supabase.from('training_sessions').insert(payload)
          results.push({ table: 'training_sessions', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }

        // ews_entries ← hm_ews
        const ews = json.hm_ews ?? json.ews ?? []
        if (ews.length > 0) {
          const payload = ews.map((e: any) => ({
            athlete_id: athleteId,
            entry_date: e.date ?? e.entry_date,
            mood: e.mood ?? null,
            fatigue: e.fatigue ?? null,
            stress: e.stress ?? null,
            sleep_quality: e.sleep ?? e.sleep_quality ?? null,
            muscle_soreness: e.soreness ?? e.muscle_soreness ?? null,
            motivation: e.motivation ?? null,
            resting_hr: e.rhr ?? e.resting_hr ?? null,
            hrv: e.hrv ?? null,
            composite_score: e.score ?? e.composite_score ?? null,
            notes: e.notes ?? null,
          }))
          const { error } = await supabase.from('ews_entries').insert(payload)
          results.push({ table: 'ews_entries', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }

        // body_metrics ← hm_bodyweight
        const bw = json.hm_bodyweight ?? json.bodyweight ?? []
        if (bw.length > 0) {
          const payload = bw.map((b: any) => ({
            athlete_id: athleteId,
            recorded_date: b.date ?? b.recorded_date,
            weight_kg: b.weight ?? b.weight_kg ?? null,
            notes: b.notes ?? null,
          }))
          const { error } = await supabase.from('body_metrics').insert(payload)
          results.push({ table: 'body_metrics', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }

        // hr_history ← hm_hr_history
        const hrHistory = json.hm_hr_history ?? json.hr_history ?? []
        if (hrHistory.length > 0) {
          const payload = hrHistory.map((h: any) => ({
            athlete_id: athleteId,
            recorded_date: h.date ?? h.recorded_date,
            hr_value: h.value ?? h.hr_value,
            hr_type: h.type ?? h.hr_type ?? 'resting',
            notes: h.notes ?? null,
          }))
          const { error } = await supabase.from('hr_history').insert(payload)
          results.push({ table: 'hr_history', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }

        // tt_history ← hm_tt_history
        const ttHistory = json.hm_tt_history ?? json.tt_history ?? []
        if (ttHistory.length > 0) {
          const payload = ttHistory.map((t: any) => ({
            athlete_id: athleteId,
            tt_date: t.date ?? t.tt_date,
            distance_km: t.distance ?? t.distance_km,
            finish_time_sec: t.timeSec ?? t.finish_time_sec,
            vdot: t.vdot ?? null,
            hr_avg: t.hrAvg ?? t.hr_avg ?? null,
            notes: t.notes ?? null,
          }))
          const { error } = await supabase.from('tt_history').insert(payload)
          results.push({ table: 'tt_history', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }

        // races ← hm_race_targets
        const raceTargets = json.hm_race_targets ?? json.race_targets ?? []
        if (raceTargets.length > 0) {
          const payload = raceTargets.map((r: any) => ({
            athlete_id: athleteId,
            slug: (r.name ?? 'race').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            name: r.name ?? 'Imported Race',
            event_date: r.date ?? r.event_date ?? null,
            distance_km: r.distance ?? r.distance_km ?? null,
            event_type: r.type ?? r.event_type ?? null,
            target_finish: r.target ?? r.target_finish ?? null,
            status: r.status ?? 'done',
          }))
          const { error } = await supabase.from('races').insert(payload)
          results.push({ table: 'races', inserted: error ? 0 : payload.length, skipped: 0, error: error?.message })
        }
      }

      setImportResults(results)
    } catch (err: any) {
      setImportError(`Gagal parse file: ${err.message}`)
    }

    setImporting(false)
    // Reset file input
    e.target.value = ''
  }

  const totalInserted = importResults.reduce((sum, r) => sum + r.inserted, 0)
  const hasErrors = importResults.some(r => r.error)

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Export / Import" subtitle="Backup dan restore data PaceIQ" />

      {/* ── Export ── */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Export Data</h3>
        <p className="text-xs text-gray-400 mb-4">
          Download semua data kamu (training sessions, EWS, body metrics, HR, TT, races, nutrition, treatment) sebagai file JSON.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {exporting ? 'Mengekspor...' : '⬇️ Download JSON'}
        </button>
        {exportDone && (
          <p className="text-xs text-green-600 mt-2">✅ Export berhasil didownload.</p>
        )}
      </div>

      {/* ── Import ── */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Import Data</h3>
        <p className="text-xs text-gray-400 mb-1">
          Mendukung dua format:
        </p>
        <ul className="text-xs text-gray-400 mb-4 space-y-0.5 list-disc list-inside">
          <li>File export PaceIQ v3 (format baru)</li>
          <li>File export PaceIQ v2.11 dari localStorage</li>
        </ul>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 mb-4">
          ⚠️ Import akan menambahkan data baru — tidak menimpa data yang sudah ada. Pastikan tidak import duplikat.
        </div>

        <label className="inline-flex items-center gap-2 px-5 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 cursor-pointer transition-colors">
          <span>⬆️ Pilih File JSON</span>
          <input
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
            disabled={importing}
          />
        </label>

        {importing && (
          <p className="text-xs text-gray-400 mt-3">Mengimpor data...</p>
        )}

        {importError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {importError}
          </div>
        )}

        {importResults.length > 0 && (
          <div className="mt-4">
            <p className={`text-sm font-semibold mb-3 ${hasErrors ? 'text-amber-600' : 'text-green-600'}`}>
              {hasErrors ? '⚠️ Import selesai dengan beberapa error' : `✅ Import berhasil — ${totalInserted} baris dimasukkan`}
            </p>
            <div className="space-y-2">
              {importResults.map((r, i) => (
                <div key={i} className={`flex items-center justify-between px-4 py-2 rounded-lg text-sm ${
                  r.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                }`}>
                  <span className="font-medium">{r.table}</span>
                  <span>
                    {r.error
                      ? `❌ ${r.error}`
                      : `✅ ${r.inserted} baris`
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}