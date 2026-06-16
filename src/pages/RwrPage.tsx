import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'

// ─── RWR Algorithms (Galloway) ────────────────────────────────

// Harmonic mean blended pace
// distPerCycle = runSec/runPace + walkSec/walkPace (dalam detik per meter)
function calcBlendedPace(
  runMin: number, runSec: number,   // run pace /km
  walkMin: number, walkSec: number, // walk pace /km
  runDuration: number,              // detik lari per siklus
  walkDuration: number              // detik jalan per siklus
): { paceStr: string; secPerKm: number } | null {
  const runPaceSec = runMin * 60 + runSec   // sec/km
  const walkPaceSec = walkMin * 60 + walkSec
  if (runPaceSec === 0 || walkPaceSec === 0) return null

  // Jarak per siklus (meter)
  const runDist  = (runDuration / runPaceSec) * 1000
  const walkDist = (walkDuration / walkPaceSec) * 1000
  const totalDist = runDist + walkDist
  const totalTime = runDuration + walkDuration

  // Blended pace = totalTime / totalDist * 1000 (sec/km)
  const blendedSecPerKm = (totalTime / totalDist) * 1000
  const m = Math.floor(blendedSecPerKm / 60)
  const s = Math.round(blendedSecPerKm % 60)
  return { paceStr: `${m}:${String(s).padStart(2, '0')}`, secPerKm: blendedSecPerKm }
}

// Projected finish time
function projectedFinish(secPerKm: number, distanceKm: number): string {
  const totalSec = secPerKm * distanceKm
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.round(totalSec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ─── Galloway Reference Table ─────────────────────────────────
const GALLOWAY_REF = [
  { pace: '5:00–5:30', ratio: '30:30', recommended: 'Elite / sub-elite' },
  { pace: '5:30–6:00', ratio: '60:20', recommended: 'Fast runner' },
  { pace: '6:00–6:30', ratio: '60:30', recommended: 'Kompetitif' },
  { pace: '6:30–7:00', ratio: '90:30', recommended: 'Kompetitif' },
  { pace: '7:00–7:30', ratio: '120:30', recommended: 'Recreational cepat' },
  { pace: '7:30–8:00', ratio: '120:60', recommended: 'Recreational' },
  { pace: '8:00–9:00', ratio: '90:60', recommended: 'Recreational' },
  { pace: '9:00–10:00', ratio: '60:60', recommended: 'Pemula / recovery' },
  { pace: '> 10:00', ratio: '30:60', recommended: 'Pemula' },
]

// ─── Component ────────────────────────────────────────────────
export default function RwrPage() {
  const [activeTab, setActiveTab] = useState<'modeA' | 'modeB' | 'ref'>('modeA')

  // Mode A — Rasio → Pace
  const [modeA, setModeA] = useState({
    runMin: '4', runSec: '0',
    walkMin: '8', walkSec: '0',
    runDuration: '60',
    walkDuration: '30',
    distance: '21.1',
  })
  const [modeAResult, setModeAResult] = useState<{
    paceStr: string; finish: string
  } | null>(null)

  function calcModeA() {
    const result = calcBlendedPace(
      parseInt(modeA.runMin), parseInt(modeA.runSec),
      parseInt(modeA.walkMin), parseInt(modeA.walkSec),
      parseInt(modeA.runDuration),
      parseInt(modeA.walkDuration),
    )
    if (!result) return
    const finish = projectedFinish(result.secPerKm, parseFloat(modeA.distance))
    setModeAResult({ paceStr: result.paceStr, finish })
  }

  // Mode B — Pace Target → RWR Interval
  const [modeB, setModeB] = useState({
    targetMin: '6', targetSec: '20',
    runDuration: '60',
    walkDuration: '30',
    distance: '21.1',
  })
  const [modeBResult, setModeBResult] = useState<{
    runPaceStr: string; blendedStr: string; finish: string
  } | null>(null)

  function calcModeB() {
    // Given target blended pace, find required run pace
    const targetSecPerKm = parseInt(modeB.targetMin) * 60 + parseInt(modeB.targetSec)
    const runDur = parseInt(modeB.runDuration)
    const walkDur = parseInt(modeB.walkDuration)
    const walkPaceSec = 8 * 60 // assume walk 8:00 /km

    // Solve: targetSecPerKm = (runDur + walkDur) / (runDur/runPace + walkDur/walkPace) * 1000
    // runDist = runDur / runPace * 1000
    // walkDist = walkDur / walkPace * 1000
    // blended = (runDur + walkDur) / (runDist + walkDist) * 1000

    // Rearrange to find runPaceSec:
    // totalDist = (runDur + walkDur) / targetSecPerKm * 1000
    // walkDist = walkDur / walkPaceSec * 1000
    // runDist = totalDist - walkDist
    // runPaceSec = runDur / runDist * 1000

    const totalDist = ((runDur + walkDur) / targetSecPerKm) * 1000
    const walkDist = (walkDur / walkPaceSec) * 1000
    const runDist = totalDist - walkDist

    if (runDist <= 0) return

    const runPaceSec = (runDur / runDist) * 1000
    const runM = Math.floor(runPaceSec / 60)
    const runS = Math.round(runPaceSec % 60)

    const finish = projectedFinish(targetSecPerKm, parseFloat(modeB.distance))
    setModeBResult({
      runPaceStr: `${runM}:${String(runS).padStart(2, '0')}`,
      blendedStr: `${modeB.targetMin}:${modeB.targetSec.padStart(2, '0')}`,
      finish,
    })
  }

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
  const labelCls = "block text-xs text-gray-500 mb-1"

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="RWR Calculator" subtitle="Run-Walk-Run pace dan projected finish (Galloway)" />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'modeA', label: 'Mode A — Rasio → Pace' },
          { key: 'modeB', label: 'Mode B — Target → Interval' },
          { key: 'ref',   label: 'Referensi Galloway' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Mode A ── */}
      {activeTab === 'modeA' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            Input rasio RWR → hitung blended pace & projected finish
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className={labelCls}>Run Pace — Menit</label>
              <input type="number" value={modeA.runMin} className={inputCls}
                onChange={e => setModeA(p => ({ ...p, runMin: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Run Pace — Detik</label>
              <input type="number" value={modeA.runSec} min="0" max="59" className={inputCls}
                onChange={e => setModeA(p => ({ ...p, runSec: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Walk Pace — Menit</label>
              <input type="number" value={modeA.walkMin} className={inputCls}
                onChange={e => setModeA(p => ({ ...p, walkMin: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Walk Pace — Detik</label>
              <input type="number" value={modeA.walkSec} min="0" max="59" className={inputCls}
                onChange={e => setModeA(p => ({ ...p, walkSec: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Durasi Lari (detik)</label>
              <input type="number" value={modeA.runDuration} className={inputCls}
                onChange={e => setModeA(p => ({ ...p, runDuration: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Durasi Jalan (detik)</label>
              <input type="number" value={modeA.walkDuration} className={inputCls}
                onChange={e => setModeA(p => ({ ...p, walkDuration: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Jarak Race (km)</label>
              <input type="number" step="0.1" value={modeA.distance} className={inputCls}
                onChange={e => setModeA(p => ({ ...p, distance: e.target.value }))} />
            </div>
          </div>

          <button onClick={calcModeA}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Hitung
          </button>

          {modeAResult && (
            <div className="mt-5 p-4 bg-indigo-50 rounded-xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Blended Pace</p>
                  <p className="text-2xl font-bold text-indigo-700">{modeAResult.paceStr} <span className="text-sm font-normal">/km</span></p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Projected Finish ({modeA.distance} km)</p>
                  <p className="text-2xl font-bold text-indigo-700">{modeAResult.finish}</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Rasio: Lari {modeA.runDuration}s / Jalan {modeA.walkDuration}s ·
                Run pace {modeA.runMin}:{modeA.runSec.padStart(2,'0')} /km ·
                Walk pace {modeA.walkMin}:{modeA.walkSec.padStart(2,'0')} /km
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Mode B ── */}
      {activeTab === 'modeB' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Input target pace & interval → hitung run pace yang dibutuhkan
          </h3>
          <p className="text-xs text-gray-400 mb-4">Asumsi walk pace 8:00 /km</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <label className={labelCls}>Target Blended Pace — Menit</label>
              <input type="number" value={modeB.targetMin} className={inputCls}
                onChange={e => setModeB(p => ({ ...p, targetMin: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Target Blended Pace — Detik</label>
              <input type="number" value={modeB.targetSec} min="0" max="59" className={inputCls}
                onChange={e => setModeB(p => ({ ...p, targetSec: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Durasi Lari (detik)</label>
              <input type="number" value={modeB.runDuration} className={inputCls}
                onChange={e => setModeB(p => ({ ...p, runDuration: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Durasi Jalan (detik)</label>
              <input type="number" value={modeB.walkDuration} className={inputCls}
                onChange={e => setModeB(p => ({ ...p, walkDuration: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Jarak Race (km)</label>
              <input type="number" step="0.1" value={modeB.distance} className={inputCls}
                onChange={e => setModeB(p => ({ ...p, distance: e.target.value }))} />
            </div>
          </div>

          <button onClick={calcModeB}
            className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            Hitung
          </button>

          {modeBResult && (
            <div className="mt-5 p-4 bg-indigo-50 rounded-xl">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500">Run Pace yang Dibutuhkan</p>
                  <p className="text-2xl font-bold text-indigo-700">{modeBResult.runPaceStr} <span className="text-sm font-normal">/km</span></p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Blended Pace</p>
                  <p className="text-2xl font-bold text-green-600">{modeBResult.blendedStr} <span className="text-sm font-normal">/km</span></p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Projected Finish ({modeB.distance} km)</p>
                  <p className="text-2xl font-bold text-indigo-700">{modeBResult.finish}</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Rasio: Lari {modeB.runDuration}s / Jalan {modeB.walkDuration}s · Walk pace asumsi 8:00 /km
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Referensi Galloway ── */}
      {activeTab === 'ref' && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Referensi Rasio RWR (Galloway)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2">Pace Range (/km)</th>
                  <th className="text-left pb-2">Rasio Run:Walk (detik)</th>
                  <th className="text-left pb-2">Kategori</th>
                </tr>
              </thead>
              <tbody>
                {GALLOWAY_REF.map((row, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 font-mono text-gray-700">{row.pace}</td>
                    <td className="py-2.5 font-bold text-indigo-600">{row.ratio}</td>
                    <td className="py-2.5 text-gray-500">{row.recommended}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Sumber: Jeff Galloway Run-Walk-Run Method. Rasio bersifat panduan — sesuaikan dengan kondisi dan target race.
          </p>
        </div>
      )}
    </div>
  )
}