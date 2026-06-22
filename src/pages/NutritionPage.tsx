import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
interface NutritionSection {
  key: string
  defaultTitle: string
  icon: string
  color: string
  bgColor: string
  borderColor: string
  defaultContent: string
}

interface NutritionRow {
  id: string
  section_key: string
  title: string | null
  content: string | null
  updated_at: string
}

// ─── Default content (dari v2.11) ─────────────────────────────────────────────
const SECTIONS: NutritionSection[] = [
  {
    key: 'daily',
    defaultTitle: 'Daily Nutrition (Non-LR Days)',
    icon: '🍽️',
    color: '#4f46e5',
    bgColor: '#eef2ff',
    borderColor: '#c7d2fe',
    defaultContent: `## 🍽️ Daily Nutrition (Non-LR Days)

**Karbohidrat** — 4–5 g/kg = 275–345 g/hari
Sumber: Nasi, kentang, oats, ubi, roti gandum, buah

**Protein** — 1.6–1.8 g/kg = 110–125 g/hari
Sumber: Ikan, ayam, telur, tahu/tempe, susu

**Lemak** — 0.8–1.0 g/kg = 55–70 g/hari
Sumber: Alpukat, kacang, minyak zaitun, ikan berlemak

**Hidrasi** — 35–40 ml/kg = 2.5–3 L/hari
Sumber: Air, kuah sayur, buah`
  },
  {
    key: 'post',
    defaultTitle: 'Post-Workout Recovery',
    icon: '💪',
    color: '#059669',
    bgColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    defaultContent: `## 💪 Post-Workout Recovery (within 30 min)

**Formula 1:1:3** (per 0.3 kg BB):
- ~20g protein
- 150–300 mg sodium replenish
- ~60–80g carb (jika sesi >90 menit)

**Pilihan Praktis:**
- Chocolate milk 300 ml + 1 pisang ✅
- Smoothie: susu + pisang + 1 scoop whey + madu ✅
- Nasi 1 centong + 2 telur + sayur + 1 gelas air kelapa ✅`
  },
  {
    key: 'pre',
    defaultTitle: 'Pre-Workout Fueling',
    icon: '⚡',
    color: '#d97706',
    bgColor: '#fffbeb',
    borderColor: '#fde68a',
    defaultContent: `## ⚡ Pre-Workout Fueling

**Easy run pagi**
H-2 jam: Pisang + roti tawar (ringan)
H-30 menit: Air 200 ml

**Easy run sore**
H-2 jam: Snack 100–150 kcal (kurma 3 buah)
H-30 menit: Air 200 ml + sip elektrolit

**LR / Quality Session**
H-2 jam: Sarapan 300–400 kcal (oats + pisang + selai kacang + susu)
H-30 menit: Pisang + air 300 ml`
  },
  {
    key: 'during',
    defaultTitle: 'During Workout Fueling',
    icon: '💧',
    color: '#0284c7',
    bgColor: '#f0f9ff',
    borderColor: '#bae6fd',
    defaultContent: `## 💧 During Workout Fueling

**< 60 menit**
Carb: Tidak perlu
Hidrasi: 250–400 ml air saja

**60–90 menit**
Carb: Optional 15–20g carb (sip elektrolit ber-karbo)
Hidrasi: 400–600 ml elektrolit

**90–120 menit**
Carb: 30g carb/jam (1 gel atau pisang kecil)
Hidrasi: 600–800 ml elektrolit

**> 120 menit (LR W10+)**
Carb: 40–60g carb/jam
Hidrasi: 800–1000 ml elektrolit`
  },
  {
    key: 'raceweek',
    defaultTitle: 'Race Week Fueling Protocol',
    icon: '🏁',
    color: '#dc2626',
    bgColor: '#fef2f2',
    borderColor: '#fecaca',
    defaultContent: `## 🏁 Race Week Fueling Protocol

**H-7 sampai H-3**
Karbohidrat normal (4–5 g/kg). Hidrasi tinggi.
⚠️ HINDARI: makanan baru, alkohol, makanan pedas/berlemak.

**H-2 (Carb Loading Light)**
Karbohidrat 6–7 g/kg = 415–485g.
Sumber: nasi, pasta, kentang. Protein moderat, lemak rendah, serat MODERAT.

**H-1 (Race Eve)**
Lunch: pasta/nasi besar + protein lean.
Dinner (sebelum jam 19:00): nasi + ayam/ikan + sayur (no kacang-kacangan, no spicy).
Hidrasi 3 L total — terakhir minum besar 2 jam sebelum tidur.

**Race Day Morning (H-3 jam)**
Sarapan 400–500 kcal: oats + pisang + madu + sedikit kopi (jika biasa).
500 ml air + sachet elektrolit.
H-30 menit: 1 pisang + 200 ml air.

**During Race (HM 21.1 km)**
- Km 5: 100 ml elektrolit di water station
- Km 8: 1 gel (~25g carb) + 100 ml air
- Km 12: 100 ml elektrolit
- Km 16: 1 gel + 100 ml air
- Km 19: 100 ml air (jika butuh)

> 🚨 GOLDEN RULE: Jangan coba gel/produk baru di race day. Test semua fueling products mulai W7+ saat LR meningkat durasinya.`
  }
]

// ─── Markdown renderer (extended dari v2.11) ─────────────────────────────────
// Syntax yang didukung:
// # Judul Besar    → H1 (font besar)
// ## Judul Sedang  → H2 (font medium, tebal)
// ### Judul Kecil  → H3 (font kecil, tebal, uppercase)
// **teks**         → Bold
// *teks*           → Italic
// - item           → Bullet list
// 1. item          → Numbered list
// > catatan        → Callout biru
// `kode`           → Inline code
// ```...```        → Code block
// | col | col |    → Tabel
function parseMarkdown(text: string): string {
  if (!text) return ''

  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Code blocks
  text = text.replace(/```([\s\S]*?)```/g, (_, code) =>
    `\x00CODEBLOCK\x00${esc(code).trim()}\x00ENDCODE\x00`
  )
  // Inline code
  text = text.replace(/`([^`]+)`/g, (_, code) =>
    `<code style="background:#f3f4f6;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:0.78rem;color:#4f46e5">${esc(code)}</code>`
  )

  const lines = text.split('\n')
  let html = ''
  let inList = false
  let inOL = false
  let inTable = false
  let tableRows: string[] = []

  function flushList() {
    if (inList) { html += '</ul>'; inList = false }
    if (inOL)   { html += '</ol>'; inOL   = false }
  }
  function flushTable() {
    if (!tableRows.length) return
    const parseRow = (row: string) => row.split('|').slice(1, -1).map(c => c.trim())
    const header = parseRow(tableRows[0])
    const body = tableRows.slice(2)
    html += `<div style="overflow-x:auto;margin:8px 0 12px">
      <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
        <thead><tr>${header.map(h =>
          `<th style="background:#eef2ff;color:#4338ca;font-weight:700;padding:6px 10px;text-align:left;border:1px solid #e5e7eb;white-space:nowrap">${h}</th>`
        ).join('')}</tr></thead>
        <tbody>${body.map((row, ri) => {
          const cells = parseRow(row)
          const bg = ri % 2 === 0 ? 'white' : '#f9fafb'
          return `<tr style="background:${bg}">${cells.map(c =>
            `<td style="padding:5px 10px;border:1px solid #e5e7eb;line-height:1.5">${c}</td>`
          ).join('')}</tr>`
        }).join('')}</tbody>
      </table></div>`
    tableRows = []
    inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Table
    if (/^\s*\|/.test(line)) {
      flushList()
      inTable = true
      tableRows.push(line)
      continue
    }
    if (inTable) flushTable()

    line = esc(line)
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    line = line.replace(/\*(.+?)\*/g, '<em>$1</em>')

    // H1 — # Judul (font besar)
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      flushList()
      html += `<div style="font-size:1.1rem;font-weight:700;color:#1e1b4b;margin:14px 0 4px;border-bottom:2px solid #e0e7ff;padding-bottom:4px">${line.replace(/^#\s+/, '')}</div>`
      continue
    }
    // H2 — ## Judul (font medium)
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      flushList()
      html += `<div style="font-size:0.9rem;font-weight:700;color:#1f2937;margin:10px 0 3px">${line.replace(/^##\s+/, '')}</div>`
      continue
    }
    // H3 — ### Judul (font kecil uppercase)
    if (/^###\s+/.test(line)) {
      flushList()
      html += `<div style="font-size:0.72rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px">${line.replace(/^###\s+/, '')}</div>`
      continue
    }

    // Blockquote
    if (/^&gt;\s+/.test(line)) {
      flushList()
      html += `<div style="background:#eff6ff;border-left:3px solid #4f46e5;border-radius:0 6px 6px 0;padding:8px 12px;margin:8px 0;font-size:0.8rem;color:#1e40af;line-height:1.6">${line.replace(/^&gt;\s+/, '')}</div>`
      continue
    }

    // Bullet list (- item)
    if (/^-\s+/.test(line)) {
      if (inOL) { html += '</ol>'; inOL = false }
      if (!inList) { html += '<ul style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:disc">'; inList = true }
      html += `<li style="margin-bottom:2px">${line.replace(/^-\s+/, '')}</li>`
      continue
    }

    // Numbered list (1. item)
    if (/^\d+\.\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      if (!inOL) { html += '<ol style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:decimal">'; inOL = true }
      html += `<li style="margin-bottom:2px">${line.replace(/^\d+\.\s+/, '')}</li>`
      continue
    }

    flushList()

    // Empty line
    if (line.trim() === '') {
      html += '<div style="margin-bottom:8px"></div>'
      continue
    }

    // Code block
    if (line.includes('\x00CODEBLOCK\x00')) {
      const parts = line.split('\x00CODEBLOCK\x00')
      parts.forEach((part, pi) => {
        if (pi % 2 === 0) {
          if (part) html += `<div style="font-size:0.83rem;color:#374151;line-height:1.6">${part}</div>`
        } else {
          const code = part.replace('\x00ENDCODE\x00', '')
          html += `<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin:8px 0 12px;overflow-x:auto;font-family:monospace;font-size:0.78rem;color:#1f2937;line-height:1.7;white-space:pre-wrap">${code}</pre>`
        }
      })
      continue
    }

    html += `<div style="font-size:0.83rem;color:#374151;line-height:1.6;margin-bottom:1px">${line}</div>`
  }

  flushList()
  if (inTable) flushTable()
  return html
}

// ─── Tab config ──────────────────────────────────────────────────────────────
const TABS = [
  {
    key: 'nutrition',
    label: '🍽️ Nutrition',
    desc: 'Panduan nutrisi harian untuk mendukung program latihan',
    sections: ['daily', 'post']
  },
  {
    key: 'fueling',
    label: '💧 Fueling',
    desc: 'Protokol fueling sebelum, saat, dan saat race week',
    sections: ['pre', 'during', 'raceweek']
  },
]

// ─── Panduan Format ───────────────────────────────────────────────────────────
const FORMAT_GUIDE = [
  { syntax: '# Judul',   result: 'Heading besar' },
  { syntax: '## Judul',  result: 'Heading sedang' },
  { syntax: '### Judul', result: 'Heading kecil (uppercase)' },
  { syntax: '**teks**',  result: 'Teks tebal' },
  { syntax: '*teks*',    result: 'Teks miring' },
  { syntax: '- item',    result: 'Bullet list' },
  { syntax: '1. item',   result: 'Numbered list' },
  { syntax: '> catatan', result: 'Callout biru' },
  { syntax: '`kode`',    result: 'Inline code' },
  { syntax: '```...```', result: 'Code block' },
  { syntax: '| A | B |', result: 'Tabel' },
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function NutritionPage() {
  const [rows, setRows]           = useState<NutritionRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [editKey, setEditKey]     = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving]       = useState(false)
  const [activeTab, setActiveTab]   = useState<'nutrition'|'fueling'>('nutrition')
  const [toast, setToast]         = useState('')
  const [myRoles, setMyRoles]     = useState<string[]>([])
  const cancelledRef              = useRef(false)

  const canEdit = myRoles.includes('coach') || myRoles.includes('admin') || myRoles.includes('athlete')

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    cancelledRef.current = false
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return

      // Roles
      const { data: arData } = await supabase
        .from('athlete_roles').select('role_id').eq('athlete_id', myId as string)
      if (!cancelledRef.current && arData && (arData as any[]).length > 0) {
        const roleIds = (arData as any[]).map((r: any) => r.role_id)
        const { data: rData } = await supabase.from('roles').select('name').in('id', roleIds)
        if (!cancelledRef.current && rData)
          setMyRoles((rData as any[]).map((r: any) => r.name).filter(Boolean))
      }

      const { data } = await supabase
        .from('nutrition')
        .select('id, section_key, title, content, updated_at')
        .eq('athlete_id', myId as string)
      if (!cancelledRef.current) setRows((data ?? []) as NutritionRow[])
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => { cancelledRef.current = true }
  }, [loadData])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getRow(key: string): NutritionRow | null {
    return rows.find(r => r.section_key === key) ?? null
  }
  function getContent(key: string): string {
    return getRow(key)?.content ?? SECTIONS.find(s => s.key === key)?.defaultContent ?? ''
  }
  function getTitle(key: string): string {
    return getRow(key)?.title ?? SECTIONS.find(s => s.key === key)?.defaultTitle ?? ''
  }
  function isCustom(key: string): boolean {
    return getRow(key) != null
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────
  function startEdit(key: string) {
    setEditKey(key)
    setEditTitle(getTitle(key))
    setEditContent(getContent(key))
  }
  function cancelEdit() {
    setEditKey(null)
  }

  async function saveSection() {
    if (!editKey) return
    setSaving(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId) throw new Error('Athlete ID tidak ditemukan')

      const sec    = SECTIONS.find(s => s.key === editKey)!
      const titleToSave = editTitle.trim() || sec.defaultTitle
      const existing = getRow(editKey)

      if (existing) {
        await supabase.from('nutrition')
          .update({ title: titleToSave, content: editContent, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      } else {
        await supabase.from('nutrition')
          .insert({ athlete_id: myId as string, section_key: editKey, title: titleToSave, content: editContent })
      }
      await loadData()
      setEditKey(null)
      showToast('✓ Konten berhasil disimpan')
    } catch {
      showToast('✗ Gagal menyimpan')
    } finally {
      setSaving(false)
    }
  }

  async function resetSection(key: string) {
    if (!confirm('Reset ke konten default? Perubahan yang disimpan akan hilang.')) return
    const existing = getRow(key)
    if (!existing) return
    try {
      await supabase.from('nutrition').delete().eq('id', existing.id)
      await loadData()
      if (editKey === key) setEditKey(null)
      showToast('✓ Konten direset ke default')
    } catch {
      showToast('✗ Gagal mereset')
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Memuat data nutrisi...
      </div>
    )
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {/* ── Toast ── */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* ── Tab selector ── */}
      <div className="bg-white rounded-xl shadow-sm p-1.5 flex gap-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'nutrition' | 'fueling')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab description ── */}
      <div className="text-xs text-gray-400 -mt-3 px-1">
        {TABS.find(t => t.key === activeTab)?.desc}
      </div>

      {/* ── Panduan Format ── */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
          Panduan Format
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {FORMAT_GUIDE.map(g => (
            <div key={g.syntax} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <code className="text-xs font-mono text-indigo-600 block mb-1">{g.syntax}</code>
              <div className="text-xs text-gray-500">{g.result}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Konten setiap seksi mendukung Markdown. Klik <strong>Edit</strong> untuk mengubah konten dan judul seksi.
        </p>
      </div>

      {/* ── Sections — filter by active tab ── */}
      {SECTIONS.filter(sec => TABS.find(t => t.key === activeTab)?.sections.includes(sec.key)).map(sec => {
        const isEditing  = editKey === sec.key
        const custom     = isCustom(sec.key)
        const lastUpdate = getRow(sec.key)?.updated_at

        return (
          <div key={sec.key} className="bg-white rounded-xl shadow-sm overflow-hidden">

            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
              style={{ borderLeftWidth: 4, borderLeftColor: sec.color, borderLeftStyle: 'solid' }}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{sec.icon}</span>
                <div>
                  <h2 className="font-gsans text-xl text-indigo-700 uppercase">
                    {getTitle(sec.key)}
                  </h2>
                  {custom && lastUpdate && (
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      Diubah {new Date(lastUpdate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              {canEdit && !isEditing && (
                <div className="flex items-center gap-2">
                  {custom && (
                    <button
                      onClick={() => resetSection(sec.key)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(sec.key)}
                    className="text-xs px-3 py-1.5 rounded-lg border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50 transition-colors font-medium"
                  >
                    ✏️ Edit
                  </button>
                </div>
              )}

              {canEdit && isEditing && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cancelEdit}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    Batal
                  </button>
                  {custom && (
                    <button
                      onClick={() => resetSection(sec.key)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={saveSection}
                    disabled={saving}
                    className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors font-medium"
                  >
                    {saving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </div>
              )}
            </div>

            {/* Content area */}
            <div className="p-5">
              {isEditing ? (
                <div className="space-y-3">
                  {/* Title input */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                      Judul Seksi
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      placeholder={sec.defaultTitle}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                  {/* Content textarea */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">
                      Konten (Markdown)
                    </label>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={16}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 font-mono focus:outline-none focus:border-indigo-400 resize-y"
                      placeholder="Tulis konten dengan format Markdown..."
                    />
                  </div>
                  {/* Live preview */}
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase mb-2">Preview</div>
                    <div
                      className="bg-gray-50 rounded-lg p-4 border border-gray-100 min-h-[80px]"
                      dangerouslySetInnerHTML={{ __html: parseMarkdown(editContent) }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className="min-h-[60px]"
                  dangerouslySetInnerHTML={{ __html: parseMarkdown(getContent(sec.key)) }}
                />
              )}
            </div>

          </div>
        )
      })}

    </div>
  )
}
