import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'

// ─── Helpers ─────────────────────────────────────────────────
function secToTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function timeToSec(val: string): number | null {
  const parts = val.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function paceSecToStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2,'0')}`
}

// RWR blended pace
function blendedPaceSec(
  runPaceSec: number, walkPaceSec: number,
  runDur: number, walkDur: number
): number {
  const runDist  = (runDur / runPaceSec) * 1000
  const walkDist = (walkDur / walkPaceSec) * 1000
  return ((runDur + walkDur) / (runDist + walkDist)) * 1000
}

// ─── Mental Cue Cards ────────────────────────────────────────
const CUE_CARDS = [
  { phase: 'Start (0–5 km)', emoji: '🟢', cues: [
    'Mulai lebih lambat dari target — jangan terbawa euforia start',
    'Fokus pada ritme napas, bukan pace',
    'Senyum dan nikmati momen pertama race',
  ]},
  { phase: 'Early (5–10 km)', emoji: '🏃', cues: [
    'Pertahankan easy effort — percakapan masih bisa',
    'Cek HR setiap 2–3 km, jangan melonjak',
    'Fueling pertama di km 7–8 jika ada',
  ]},
  { phase: 'Mid (10–15 km)', emoji: '🎯', cues: [
    'Ini ujian sesungguhnya — jaga konsistensi',
    'Fokus form: pinggul maju, bukan badan condong',
    'Jika RWR: eksekusi rasio dengan disiplin',
  ]},
  { phase: 'Hard (15–18 km)', emoji: '🔥', cues: [
    'Breakdown jadi segmen kecil: "sampai km 17 dulu"',
    'Mantras: "Aku sudah latihan untuk ini"',
    'Fueling terakhir — jangan skip meski tidak lapar',
  ]},
  { phase: 'Finish (18–21 km)', emoji: '🏁', cues: [
    'Tinggal X km — kamu sudah terlalu jauh untuk berhenti',
    'Kalau masih kuat, mulai pickup di km 19',
    'Kumpulkan semua energi tersisa untuk finish line',
  ]},
]

// ─── Pace Band Simulator ─────────────────────────────────────
interface SplitRow {
  segment: string
  distKm: number
  cumKm: number
  paceStr: string
  splitTime: string
  cumTime: string
}

function generatePaceBand(
  targetSec: number,
  distanceKm: number,
  strategy: 'even' | 'negative' | 'positive'
): SplitRow[] {
  const avgSecPerKm = targetSec / distanceKm
  const segmentKm = 5
  const segments: { label: string; dist: number }[] = []

  let cum = 0
  while (cum < distanceKm) {
    const remaining = distanceKm - cum
    const dist = Math.min(segmentKm, remaining)
    const label = cum === 0
      ? `0–${Math.min(segmentKm, distanceKm)} km`
      : `${cum}–${Math.min(cum + segmentKm, distanceKm)} km`
    segments.push({ label, dist })
    cum += dist
  }

  const n = segments.length
  let paces: number[]

  if (strategy === 'even') {
    paces = segments.map(() => avgSecPerKm)
  } else if (strategy === 'negative') {
    // First half +5%, second half -5%
    paces = segments.map((_, i) =>
      i < n / 2 ? avgSecPerKm * 1.03 : avgSecPerKm * 0.97
    )
  } else {
    // positive split: first half faster, fade
    paces = segments.map((_, i) =>
      i < n / 2 ? avgSecPerKm * 0.97 : avgSecPerKm * 1.03
    )
  }

  let cumSec = 0
  return segments.map((seg, i) => {
    const splitSec = paces[i] * seg.dist
    cumSec += splitSec
    const cumKm = segments.slice(0, i + 1).reduce((s, x) => s + x.dist, 0)
    return {
      segment: seg.label,
      distKm: seg.dist,
      cumKm: parseFloat(cumKm.toFixed(3)),
      paceStr: paceSecToStr(paces[i]),
      splitTime: secToTime(splitSec),
      cumTime: secToTime(cumSec),
    }
  })
}

// ─── Component ────────────────────────────────────────────────
export default function RaceStrategyPage() {
  const [activeTab, setActiveTab] = useState<'paceband' | 'split' | 'cue'>('paceband')

  // Pace Band
  const [pbTarget, setPbTarget] = useState('2:15:00')
  const [pbDist, setPbDist] = useState('21.1')
  const [pbStrategy, setPbStrategy] = useState<'even' | 'negative' | 'positive'>('even')
  const [pbRwr, setPbRwr] = useState(false)
  const [pbRunPace, setPbRunPace] = useState('6:00')
  const [pbWalkPace, setPbWalkPace] = useState('8:00')
  const [pbRunDur, setPbRunDur] = useState('60')
  const [pbWalkDur, setPbWalkDur] = useState('30')
  const [paceBand, setPaceBand] = useState<SplitRow[]>([])
  const [pbError, setPbError] = useState<string | null>(null)

  function calcPaceBand() {
    setPbError(null)
    let targetSec = timeToSec(pbTarget)
    if (!targetSec) { setPbError('Format target tidak valid. Gunakan H:MM:SS atau MM:SS.'); return }

    if (pbRwr) {
      const runPaceSec = timeToSec(pbRunPace)
      const walkPaceSec = timeToSec(pbWalkPace)
      if (!runPaceSec || !walkPaceSec) { setPbError('Format pace RWR tidak valid.'); return }
      const blended = blendedPaceSec(runPaceSec, walkPaceSec, parseInt(pbRunDur), parseInt(pbWalkDur))
      targetSec = blended * parseFloat(pbDist)
    }

    const rows = generatePaceBand(targetSec, parseFloat(pbDist), pbStrategy)
    setPaceBand(rows)
  }

  // Split Calculator
  const [splits, setSplits] = useState([
    { label: '0–5 km', pace: '6:25' },
    { label: '5–10 km', pace: '6:20' },
    { label: '10–15 km', pace: '6:20' },
    { label: '15–18 km', pace: '6:30' },
    { label: '18–21.1 km', pace: '6:15' },
  ])
  const [splitDists, setSplitDists] = useState(['5','5','5','3','3.1'])
  const [splitResults, setSplitResults] = useState<{ label: string; split: string; cum: string }[]>([])

  function calcSplits() {
    let cumSec = 0
    const results = splits.map((s, i) => {
      const paceSec = timeToSec(s.pace)
      const dist = parseFloat(splitDists[i])
      const splitSec = paceSec ? paceSec * dist : 0
      cumSec += splitSec
      return { label: s.label, split: secToTime(splitSec), cum: secToTime(cumSec) }
    })
    setSplitResults(results)
  }

  const inputCls = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"

  return (
    <div className="p-6 max-w-4xl">
      <PageHeader title="Race Strategy" subtitle="Pace band, split calculator, dan mental cue cards" />

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'paceband', label: '📊 Pace Band' },
          { key: 'split',    label: '⏱ Split Calculator' },
          { key: 'cue',      label: '💬 Mental Cues' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key as typeof activeTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Pace Band ── */}
      {activeTab === 'paceband' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Pace Band Simulator</h3>

            {pbError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{pbError}</div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target Finish</label>
                <input type="text" value={pbTarget} placeholder="2:15:00" className={inputCls}
                  onChange={e => setPbTarget(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jarak (km)</label>
                <input type="number" step="0.1" value={pbDist} className={inputCls}
                  onChange={e => setPbDist(e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-2">Strategi</label>
                <div className="flex gap-2">
                  {(['even','negative','positive'] as const).map(s => (
                    <button key={s} onClick={() => setPbStrategy(s)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        pbStrategy === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200'
                      }`}>
                      {s === 'even' ? 'Even Split' : s === 'negative' ? 'Negative Split' : 'Positive Split'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* RWR toggle */}
            <div className="mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={pbRwr} onChange={e => setPbRwr(e.target.checked)}
                  className="rounded accent-indigo-600" />
                <span className="text-sm text-gray-600">Gunakan RWR Blended Pace</span>
              </label>
            </div>

            {pbRwr && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-4 bg-indigo-50 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Run Pace (/km)</label>
                  <input type="text" value={pbRunPace} placeholder="6:00" className={inputCls}
                    onChange={e => setPbRunPace(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Walk Pace (/km)</label>
                  <input type="text" value={pbWalkPace} placeholder="8:00" className={inputCls}
                    onChange={e => setPbWalkPace(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Run (detik)</label>
                  <input type="number" value={pbRunDur} className={inputCls}
                    onChange={e => setPbRunDur(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Walk (detik)</label>
                  <input type="number" value={pbWalkDur} className={inputCls}
                    onChange={e => setPbWalkDur(e.target.value)} />
                </div>
              </div>
            )}

            <button onClick={calcPaceBand}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Generate Pace Band
            </button>
          </div>

          {paceBand.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-5 overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Pace Band — {pbStrategy === 'even' ? 'Even Split' : pbStrategy === 'negative' ? 'Negative Split' : 'Positive Split'}
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Segmen</th>
                    <th className="text-right pb-2">Pace /km</th>
                    <th className="text-right pb-2">Split</th>
                    <th className="text-right pb-2">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {paceBand.map((row, i) => (
                    <tr key={i} className={`border-b border-gray-50 last:border-0 ${i === paceBand.length - 1 ? 'font-semibold text-indigo-700' : ''}`}>
                      <td className="py-2.5">{row.segment}</td>
                      <td className="py-2.5 text-right font-mono">{row.paceStr}</td>
                      <td className="py-2.5 text-right font-mono">{row.splitTime}</td>
                      <td className="py-2.5 text-right font-mono">{row.cumTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Split Calculator ── */}
      {activeTab === 'split' && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Split Time Calculator</h3>
          <div className="space-y-3 mb-4">
            {splits.map((s, i) => (
              <div key={i} className="grid grid-cols-3 gap-3 items-center">
                <input type="text" value={s.label}
                  onChange={e => setSplits(prev => prev.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                  className={inputCls} placeholder="Label segmen" />
                <input type="number" step="0.1" value={splitDists[i]}
                  onChange={e => setSplitDists(prev => prev.map((x, j) => j === i ? e.target.value : x))}
                  className={inputCls} placeholder="Jarak (km)" />
                <input type="text" value={s.pace}
                  onChange={e => setSplits(prev => prev.map((x, j) => j === i ? { ...x, pace: e.target.value } : x))}
                  className={inputCls} placeholder="Pace MM:SS" />
              </div>
            ))}
          </div>
          <div className="flex gap-3 mb-5">
            <button onClick={calcSplits}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
              Hitung Split
            </button>
            <button onClick={() => setSplits(prev => [...prev, { label: `Segmen ${prev.length + 1}`, pace: '6:30' }])}
              className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">
              + Segmen
            </button>
          </div>

          {splitResults.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2">Segmen</th>
                    <th className="text-right pb-2">Split</th>
                    <th className="text-right pb-2">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {splitResults.map((r, i) => (
                    <tr key={i} className={`border-b border-gray-50 last:border-0 ${i === splitResults.length - 1 ? 'font-semibold text-indigo-700' : ''}`}>
                      <td className="py-2.5">{r.label}</td>
                      <td className="py-2.5 text-right font-mono">{r.split}</td>
                      <td className="py-2.5 text-right font-mono">{r.cum}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Mental Cue Cards ── */}
      {activeTab === 'cue' && (
        <div className="space-y-4">
          {CUE_CARDS.map(card => (
            <div key={card.phase} className="bg-white rounded-xl shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                {card.emoji} {card.phase}
              </h3>
              <ul className="space-y-2">
                {card.cues.map((cue, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-indigo-400 mt-0.5 shrink-0">→</span>
                    <span>{cue}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}