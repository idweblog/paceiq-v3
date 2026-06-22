import { useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = 'green' | 'yellow' | 'red' | 'black'

interface MidsessionIssue {
  id: string
  symptom: string
  action: string
  severity: Severity
  decision_detail: string | null
  sort_order: number
}

interface TreatmentProtocol {
  id: string
  section_key: string
  title: string | null
  content: string | null
  updated_at: string
}

// ─── Severity config ──────────────────────────────────────────────────────────
const SEVERITY_CONFIG: Record<Severity, { label: string; bg: string; color: string; border: string; badge: string }> = {
  green:  { label: 'Continue',   bg: '#d1fae5', color: '#065f46', border: '#6ee7b7', badge: '✅ Continue'  },
  yellow: { label: 'Warning',    bg: '#fef3c7', color: '#92400e', border: '#fde68a', badge: '⚠️ Warning'   },
  red:    { label: 'STOP',       bg: '#fee2e2', color: '#991b1b', border: '#fca5a5', badge: '🔴 STOP'       },
  black:  { label: 'Emergency',  bg: '#1e293b', color: '#f8fafc', border: '#334155', badge: '🚨 Emergency'  },
}

// ─── Default midsession issues (dari v2.11) ───────────────────────────────────
const DEFAULT_ISSUES: Omit<MidsessionIssue, 'id' | 'sort_order'>[] = [
  { symptom: 'HR di luar zona target (sustained)',      action: 'Slow down 30 det/km, extend walk break ke 45s',            severity: 'green',  decision_detail: 'Lanjutkan di pace lebih lambat' },
  { symptom: 'Mild side stitch',                        action: 'Inhale deep, exhale forcefully on opposite footstrike',     severity: 'green',  decision_detail: 'Biasanya hilang 2–3 menit' },
  { symptom: 'Cramping (calf/hamstring)',               action: 'Stop, gentle stretch, sip elektrolit',                     severity: 'yellow', decision_detail: 'Pace lebih lambat — jika recur → STOP' },
  { symptom: 'Sharp pain di joint',                     action: 'STOP IMMEDIATELY',                                          severity: 'red',    decision_detail: 'Walk home, ice protocol' },
  { symptom: 'Pusing / mual',                           action: 'STOP, sit di tempat teduh, sip elektrolit',                severity: 'red',    decision_detail: 'Hydrate, rest' },
  { symptom: 'Vision blur / disorientation',            action: 'STOP NOW, sit, call for help if persist',                  severity: 'black',  decision_detail: 'Possible heat stroke — EMERGENCY' },
]

// ─── Nav sections ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  { key: 'midsession', label: 'Saat Latihan',   icon: '🏃',  badge: 'A' },
  { key: 'recovery',   label: 'Pasca Latihan',  icon: '💪',  badge: 'B' },
  { key: 'doms',       label: 'DOMS',           icon: '😣',  badge: 'C' },
  { key: 'acute',      label: 'Cedera Acute',   icon: '🚨',  badge: 'D' },
  { key: 'foam',       label: 'Foam Rolling',   icon: '🧘',  badge: 'E' },
]

// ─── Default markdown content (dari v2.11) ────────────────────────────────────
const MARKDOWN_DEFAULTS: Record<string, { title: string; content: string }> = {
  recovery: {
    title: 'Pasca Latihan (Recovery Protocol)',
    content: `## 💪 Recovery Protocol Pasca Latihan

## Window 0–30 menit (Recovery Critical Window)
- 🥛 Carb + Protein 3:1 ratio: chocolate milk 250 ml ATAU pisang + telur + roti
- 💧 Rehidrasi: 500–750 ml air + elektrolit (sip-sip, tidak chug)
- 🧊 Cool-down active: jalan 5–10 menit, jangan langsung duduk

## Window 30 menit – 2 jam
- 🍚 Real meal: nasi/karbohidrat kompleks + protein + sayur + buah
- 💧 Continue hidrasi: 500 ml lagi
- 🧴 Cold shower / contrast shower (3 cycle hot 60s ↔ cold 30s)

## Window 2–24 jam
- 🛏️ Sleep 7–9 jam (PRIORITAS UTAMA)
- 🧘 Light mobility 10–15 menit di malam hari
- ❌ Hindari: alkohol, makanan tinggi gula olahan, begadang`
  },
  doms: {
    title: 'DOMS / Muscle Soreness',
    content: `## 😣 DOMS / Muscle Soreness (post-LR/quality)

## Hari +1 (next day)
- Light activity: walk 20–30 menit, mobility flow 15 menit
- Compression sleeves (calf/quad) 2–4 jam
- Magnesium glycinate 200–300 mg malam (jika belum konsumsi)

## Hari +2
- Easy run 30–40 menit Z1 (active recovery)
- ATAU swimming/cycling 30 menit jika DOMS masih tinggi

## ❌ JANGAN
- Heavy lifting 24–48 jam post-LR
- NSAID (Ibuprofen) rutin — block adaptation signal
- Sauna/hot bath untuk acute inflammation (boleh 48+ jam after)`
  },
  acute: {
    title: 'Cedera Acute (POLICE Protocol)',
    content: `## 🚨 Cedera Acute — POLICE Protocol

*Modern replacement of RICE (Bleakley et al., 2012)*

- **P**rotection — stop activity, support area
- **O**ptimal **L**oading — gentle ROM ASAP (24h after)
- **I**ce — 15–20 menit, tiap 2 jam (24–48 jam pertama)
- **C**ompression — elastic bandage
- **E**levation — di atas level jantung

## Kapan ke Dokter / Sport Medicine
- Pain >7/10 atau persisting >5 hari
- Cannot bear weight
- Visible swelling / deformity
- Suspected stress fracture (point pain pada tulang, worse with hopping test)

> ⚠️ Jangan tunda konsultasi jika ada tanda-tanda di atas. Early intervention = faster return to training.`
  },
  foam: {
    title: 'Foam Rolling Schedule',
    content: `## 🧘 Foam Rolling Schedule (3–5x/minggu)

**Area target:** Calf, quad, IT-band, glute medius, hip flexor, upper back

**Durasi:** 30–60 detik per area

## Aturan Dasar
- Uncomfortable = OK, lanjutkan
- Sharp pain = TIDAK, pindah ke area sekitar
- Napas tetap rileks selama rolling

## Prioritas Post-Run
- Calf & Achilles (paling kritis untuk pelari)
- Quad & IT-band (terutama post-LR)
- Glute medius (stabilisasi pinggul)

## Tips
- Lakukan setelah lari (otot hangat = lebih efektif)
- Bisa digabung dengan static stretch 10–15 menit sesudahnya`
  }
}

// ─── Markdown parser (shared dari NutritionPage) ──────────────────────────────
function parseMarkdown(text: string): string {
  if (!text) return ''
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  text = text.replace(/```([\s\S]*?)```/g, (_,code) => `\x00CODEBLOCK\x00${esc(code).trim()}\x00ENDCODE\x00`)
  text = text.replace(/`([^`]+)`/g, (_,code) =>
    `<code style="background:#f3f4f6;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:0.78rem;color:#4f46e5">${esc(code)}</code>`)
  const lines = text.split('\n')
  let html = '', inList = false, inOL = false, inTable = false, tableRows: string[] = []
  const flushList = () => { if (inList){html+='</ul>';inList=false} if(inOL){html+='</ol>';inOL=false} }
  const flushTable = () => {
    if (!tableRows.length) return
    const parseRow = (row: string) => row.split('|').slice(1,-1).map(c=>c.trim())
    const header = parseRow(tableRows[0])
    const body = tableRows.slice(2)
    html += `<div style="overflow-x:auto;margin:8px 0 12px"><table style="width:100%;border-collapse:collapse;font-size:0.8rem">
      <thead><tr>${header.map(h=>`<th style="background:#eef2ff;color:#4338ca;font-weight:700;padding:6px 10px;text-align:left;border:1px solid #e5e7eb">${h}</th>`).join('')}</tr></thead>
      <tbody>${body.map((row,ri)=>{const cells=parseRow(row);const bg=ri%2===0?'white':'#f9fafb';return `<tr style="background:${bg}">${cells.map(c=>`<td style="padding:5px 10px;border:1px solid #e5e7eb;line-height:1.5">${c}</td>`).join('')}</tr>`}).join('')}</tbody>
      </table></div>`
    tableRows=[]; inTable=false
  }
  for (let i=0; i<lines.length; i++) {
    let line = lines[i]
    if (/^\s*\|/.test(line)) { flushList(); inTable=true; tableRows.push(line); continue }
    if (inTable) flushTable()
    line = esc(line)
    line = line.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      flushList(); html+=`<div style="font-size:1.1rem;font-weight:700;color:#1e1b4b;margin:14px 0 4px;border-bottom:2px solid #e0e7ff;padding-bottom:4px">${line.replace(/^#\s+/,'')}</div>`; continue }
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      flushList(); html+=`<div style="font-size:0.9rem;font-weight:700;color:#1f2937;margin:10px 0 3px">${line.replace(/^##\s+/,'')}</div>`; continue }
    if (/^###\s+/.test(line)) {
      flushList(); html+=`<div style="font-size:0.72rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px">${line.replace(/^###\s+/,'')}</div>`; continue }
    if (/^&gt;\s+/.test(line)) {
      flushList(); html+=`<div style="background:#eff6ff;border-left:3px solid #4f46e5;border-radius:0 6px 6px 0;padding:8px 12px;margin:8px 0;font-size:0.8rem;color:#1e40af;line-height:1.6">${line.replace(/^&gt;\s+/,'')}</div>`; continue }
    if (/^-\s+/.test(line)) {
      if(inOL){html+='</ol>';inOL=false}
      if(!inList){html+='<ul style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:disc">';inList=true}
      html+=`<li style="margin-bottom:2px">${line.replace(/^-\s+/,'')}</li>`; continue }
    if (/^\d+\.\s+/.test(line)) {
      if(inList){html+='</ul>';inList=false}
      if(!inOL){html+='<ol style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:decimal">';inOL=true}
      html+=`<li style="margin-bottom:2px">${line.replace(/^\d+\.\s+/,'')}</li>`; continue }
    flushList()
    if (line.trim()==='') {
      const nextLine = lines[i+1]?.trim()??'x'
      html += nextLine==='' ? '<div style="margin-bottom:20px"></div>' : '<div style="margin-bottom:5px"></div>'
      if (nextLine==='') i++
      continue }
    if (line.includes('\x00CODEBLOCK\x00')) {
      line.split('\x00CODEBLOCK\x00').forEach((part,pi)=>{
        if(pi%2===0){if(part)html+=`<div style="font-size:0.83rem;color:#374151;line-height:1.6">${part}</div>`}
        else{const code=part.replace('\x00ENDCODE\x00','');html+=`<pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;margin:8px 0 12px;overflow-x:auto;font-family:monospace;font-size:0.78rem;color:#1f2937;line-height:1.7;white-space:pre-wrap">${code}</pre>`}
      }); continue }
    html+=`<div style="font-size:0.83rem;color:#374151;line-height:1.6;margin-bottom:1px">${line}</div>`
  }
  flushList(); if(inTable) flushTable()
  return html
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TreatmentPage() {
  const [activeKey, setActiveKey]     = useState('midsession')
  const [issues, setIssues]           = useState<MidsessionIssue[]>([])
  const [protocols, setProtocols]     = useState<TreatmentProtocol[]>([])
  const [myRoles, setMyRoles]         = useState<string[]>([])
  const [loading, setLoading]         = useState(true)
  const [toast, setToast]             = useState('')

  // Issue form state
  const [issueForm, setIssueForm]     = useState<Partial<MidsessionIssue> | null>(null)
  const [issueEditId, setIssueEditId] = useState<string | null>(null)
  const [issueSaving, setIssueSaving] = useState(false)

  // Markdown edit state
  const [editKey, setEditKey]         = useState<string | null>(null)
  const [editTitle, setEditTitle]     = useState('')
  const [editContent, setEditContent] = useState('')
  const [mdSaving, setMdSaving]       = useState(false)

  const cancelledRef = useRef(false)
  const myIdRef      = useRef<string | null>(null)

  const canEdit = myRoles.includes('coach') || myRoles.includes('admin')

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    cancelledRef.current = false
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return
      myIdRef.current = myId as string

      // Roles
      const { data: arData } = await supabase.from('athlete_roles').select('role_id').eq('athlete_id', myId as string)
      if (!cancelledRef.current && arData && (arData as any[]).length > 0) {
        const roleIds = (arData as any[]).map((r:any) => r.role_id)
        const { data: rData } = await supabase.from('roles').select('name').in('id', roleIds)
        if (!cancelledRef.current && rData) setMyRoles((rData as any[]).map((r:any) => r.name).filter(Boolean))
      }

      // Issues
      const { data: issData } = await supabase
        .from('treatment_issues')
        .select('id, symptom, action, severity, decision_detail, sort_order')
        .eq('athlete_id', myId as string)
        .order('sort_order', { ascending: true })
      if (!cancelledRef.current) setIssues((issData ?? []) as any[])

      // Protocols
      const { data: proData } = await supabase
        .from('treatment_protocols')
        .select('id, section_key, title, content, updated_at')
        .eq('athlete_id', myId as string)
      if (!cancelledRef.current) setProtocols((proData ?? []) as any[])

    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    return () => { cancelledRef.current = true }
  }, [loadData])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // ── Midsession issue handlers ─────────────────────────────────────────────
  function getDisplayIssues(): MidsessionIssue[] {
    if (issues.length > 0) return issues
    // Tampilkan default jika belum ada data
    return DEFAULT_ISSUES.map((d, i) => ({ ...d, id: `default-${i}`, sort_order: i }))
  }

  function startAddIssue() {
    setIssueEditId(null)
    setIssueForm({ symptom: '', action: '', severity: 'green', decision_detail: '' })
  }

  function startEditIssue(iss: MidsessionIssue) {
    setIssueEditId(iss.id)
    setIssueForm({ ...iss })
  }

  function cancelIssueForm() {
    setIssueEditId(null)
    setIssueForm(null)
  }

  async function saveIssue() {
    if (!issueForm || !myIdRef.current) return
    setIssueSaving(true)
    try {
      const myId = myIdRef.current
      // Jika masih default (belum ada di DB), insert semua default dulu
      if (issues.length === 0) {
        const defaultRows = DEFAULT_ISSUES.map((d, i) => ({
          athlete_id: myId, ...d, sort_order: i
        }))
        await supabase.from('treatment_issues').insert(defaultRows as any)
      }

      if (issueEditId && !issueEditId.startsWith('default-')) {
        await supabase.from('treatment_issues')
          .update({ symptom: issueForm.symptom, action: issueForm.action, severity: issueForm.severity, decision_detail: issueForm.decision_detail } as any)
          .eq('id', issueEditId)
      } else {
        const maxOrder = Math.max(0, ...getDisplayIssues().map(i => i.sort_order))
        await supabase.from('treatment_issues')
          .insert({ athlete_id: myId, symptom: issueForm.symptom, action: issueForm.action, severity: issueForm.severity ?? 'green', decision_detail: issueForm.decision_detail, sort_order: maxOrder + 1 } as any)
      }
      await loadData()
      setIssueEditId(null)
      setIssueForm(null)
      showToast('✓ Issue disimpan')
    } catch { showToast('✗ Gagal menyimpan') }
    finally { setIssueSaving(false) }
  }

  async function deleteIssue(id: string) {
    if (!confirm('Hapus issue ini?')) return
    if (id.startsWith('default-')) {
      // Seed semua default ke DB dulu, lalu delete yang dipilih berdasarkan index
      showToast('Hapus dari default tidak langsung, edit dulu untuk menyimpan ke DB')
      return
    }
    await supabase.from('treatment_issues').delete().eq('id', id)
    await loadData()
    showToast('✓ Issue dihapus')
  }

  async function moveIssue(id: string, dir: -1 | 1) {
    const list = [...issues]
    const idx = list.findIndex(i => i.id === id)
    if (idx < 0) return
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= list.length) return
    ;[list[idx], list[newIdx]] = [list[newIdx], list[idx]]
    // Update sort_order
    await Promise.all([
      supabase.from('treatment_issues').update({ sort_order: newIdx } as any).eq('id', list[newIdx].id),
      supabase.from('treatment_issues').update({ sort_order: idx } as any).eq('id', list[idx].id),
    ])
    await loadData()
  }

  async function resetIssues() {
    if (!confirm('Reset semua issue ke default? Perubahan akan hilang.')) return
    if (!myIdRef.current) return
    await supabase.from('treatment_issues').delete().eq('athlete_id', myIdRef.current)
    await loadData()
    showToast('✓ Issues direset ke default')
  }

  // ── Markdown protocol handlers ─────────────────────────────────────────────
  function getProtocol(key: string): TreatmentProtocol | null {
    return protocols.find(p => p.section_key === key) ?? null
  }
  function getProtocolContent(key: string): string {
    return getProtocol(key)?.content ?? MARKDOWN_DEFAULTS[key]?.content ?? ''
  }
  function getProtocolTitle(key: string): string {
    return getProtocol(key)?.title ?? MARKDOWN_DEFAULTS[key]?.title ?? ''
  }

  function startEditMd(key: string) {
    setEditKey(key)
    setEditTitle(getProtocolTitle(key))
    setEditContent(getProtocolContent(key))
  }

  async function saveMd() {
    if (!editKey || !myIdRef.current) return
    setMdSaving(true)
    try {
      const existing = getProtocol(editKey)
      const titleToSave = editTitle.trim() || (MARKDOWN_DEFAULTS[editKey]?.title ?? editKey)
      if (existing) {
        await supabase.from('treatment_protocols')
          .update({ title: titleToSave, content: editContent, updated_at: new Date().toISOString() } as any)
          .eq('id', existing.id)
      } else {
        await supabase.from('treatment_protocols')
          .insert({ athlete_id: myIdRef.current, section_key: editKey, title: titleToSave, content: editContent } as any)
      }
      await loadData()
      setEditKey(null)
      showToast('✓ Protokol disimpan')
    } catch { showToast('✗ Gagal menyimpan') }
    finally { setMdSaving(false) }
  }

  async function resetMd(key: string) {
    if (!confirm('Reset ke konten default?')) return
    const existing = getProtocol(key)
    if (!existing) return
    await supabase.from('treatment_protocols').delete().eq('id', existing.id)
    await loadData()
    if (editKey === key) setEditKey(null)
    showToast('✓ Protokol direset ke default')
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  const activeNav = NAV_SECTIONS.find(n => n.key === activeKey)!
  const displayIssues = getDisplayIssues()
  const isDefaultIssues = issues.length === 0

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat treatment protocol...</div>
  )

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>
      )}

      {/* ── Nav pills ── */}
      <div className="bg-white rounded-xl shadow-sm p-2 flex gap-2 flex-wrap">
        {NAV_SECTIONS.map(nav => (
          <button
            key={nav.key}
            onClick={() => { setActiveKey(nav.key); setEditKey(null); setIssueForm(null) }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeKey === nav.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            }`}
          >
            <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
              activeKey === nav.key ? 'bg-white text-indigo-600' : 'bg-indigo-100 text-indigo-600'
            }`}>{nav.badge}</span>
            {nav.icon} {nav.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI A — MIDSESSION ISSUES                                         */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeKey === 'midsession' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
            style={{ borderLeftWidth: 4, borderLeftColor: '#4f46e5', borderLeftStyle: 'solid' }}>
            <div>
              <h2 className="font-gsans text-xl text-indigo-700 uppercase">🏃 Saat Latihan (Mid-Session Issues)</h2>
              {isDefaultIssues && <div className="text-xs text-amber-500 mt-0.5">Menampilkan data default — edit untuk menyimpan perubahan</div>}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                {!isDefaultIssues && (
                  <button onClick={resetIssues}
                    className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                    Reset Default
                  </button>
                )}
                <button onClick={startAddIssue}
                  className="text-xs px-3 py-1 rounded-lg border border-emerald-500 text-emerald-600 hover:bg-emerald-50 transition-colors font-medium">
                  + Tambah Issue
                </button>
              </div>
            )}
          </div>

          <div className="p-5 space-y-3">
            {/* Add form */}
            {issueForm && !issueEditId && (
              <IssueForm
                form={issueForm}
                onChange={setIssueForm}
                onSave={saveIssue}
                onCancel={cancelIssueForm}
                saving={issueSaving}
                isNew
              />
            )}

            {/* Issue cards */}
            {displayIssues.map((iss, idx) => {
              const sev = SEVERITY_CONFIG[iss.severity as Severity] ?? SEVERITY_CONFIG.green
              const isEditing = issueEditId === iss.id
              return (
                <div key={iss.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Card header */}
                  <div className="bg-indigo-600 px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-indigo-300 flex-shrink-0">#{idx + 1}</span>
                      <span className="text-sm font-semibold text-white leading-snug">{iss.symptom}</span>
                    </div>
                    {canEdit && !isEditing && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => moveIssue(iss.id, -1)} disabled={idx === 0 || iss.id.startsWith('default-')}
                          className="p-1 text-white opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity" title="Naik">▲</button>
                        <button onClick={() => moveIssue(iss.id, 1)} disabled={idx === displayIssues.length - 1 || iss.id.startsWith('default-')}
                          className="p-1 text-white opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity" title="Turun">▼</button>
                        <button onClick={() => startEditIssue(iss)}
                          className="text-xs px-2 py-1 rounded bg-white bg-opacity-20 text-white hover:bg-opacity-30 transition-colors" title="Edit">✏️</button>
                        {!iss.id.startsWith('default-') && (
                          <button onClick={() => deleteIssue(iss.id)}
                            className="text-xs px-2 py-1 rounded bg-red-500 bg-opacity-40 text-red-100 hover:bg-opacity-60 transition-colors" title="Hapus">🗑</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card body */}
                  {isEditing ? (
                    <div className="p-4">
                      <IssueForm
                        form={issueForm!}
                        onChange={setIssueForm}
                        onSave={saveIssue}
                        onCancel={cancelIssueForm}
                        saving={issueSaving}
                      />
                    </div>
                  ) : (
                    <div className="p-4 bg-white">
                      <div className="mb-3">
                        <div className="text-xs font-medium text-gray-400 uppercase mb-1">Immediate Action</div>
                        <div className="text-sm text-gray-700 leading-relaxed">{iss.action}</div>
                      </div>
                      <div className="rounded-lg p-3 flex items-start gap-3"
                        style={{ background: sev.bg, border: `1px solid ${sev.border}` }}>
                        <div>
                          <div className="text-xs font-bold mb-0.5" style={{ color: iss.severity === 'black' ? 'rgba(255,255,255,0.5)' : sev.color }}>
                            Continue / Stop?
                          </div>
                          <div className="text-sm font-bold" style={{ color: sev.color }}>{sev.badge}</div>
                          {iss.decision_detail && (
                            <div className="text-xs mt-0.5 opacity-80" style={{ color: sev.color }}>{iss.decision_detail}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI B–E — MARKDOWN SECTIONS                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeKey !== 'midsession' && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
            style={{ borderLeftWidth: 4, borderLeftColor: '#4f46e5', borderLeftStyle: 'solid' }}>
            <div className="flex items-center gap-3">
              <span className="text-xl">{activeNav.icon}</span>
              <div>
                <h2 className="font-gsans text-xl text-indigo-700 uppercase">{getProtocolTitle(activeKey)}</h2>
                {getProtocol(activeKey)?.updated_at && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    Diubah {new Date(getProtocol(activeKey)!.updated_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                )}
              </div>
            </div>
            {canEdit && editKey !== activeKey && (
              <button onClick={() => startEditMd(activeKey)}
                className="text-xs px-3 py-1 rounded-lg border border-indigo-500 text-indigo-600 hover:bg-indigo-50 transition-colors">
                Edit
              </button>
            )}
            {canEdit && editKey === activeKey && (
              <div className="flex items-center gap-2">
                <button onClick={() => setEditKey(null)}
                  className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">
                  Batal
                </button>
                {getProtocol(activeKey) && (
                  <button onClick={() => resetMd(activeKey)}
                    className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                    Reset
                  </button>
                )}
                <button onClick={saveMd} disabled={mdSaving}
                  className="text-xs px-4 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                  {mdSaving ? '...' : 'Simpan'}
                </button>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="p-5">
            {editKey === activeKey ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Judul Seksi</label>
                  <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Konten (Markdown)</label>
                  <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={18}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 font-mono focus:outline-none focus:border-indigo-400 resize-y" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-2">Preview</div>
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 min-h-[80px]"
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(editContent) }} />
                </div>
              </div>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: parseMarkdown(getProtocolContent(activeKey)) }} />
            )}
          </div>
        </div>
      )}

    </div>
  )
}

// ─── IssueForm Component ──────────────────────────────────────────────────────
function IssueForm({
  form, onChange, onSave, onCancel, saving, isNew = false
}: {
  form: Partial<MidsessionIssue>
  onChange: (f: Partial<MidsessionIssue>) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  isNew?: boolean
}) {
  return (
    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-3">
      {isNew && <div className="text-xs font-bold text-indigo-600 uppercase">Issue Baru</div>}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Symptom / Issue</label>
        <input type="text" value={form.symptom ?? ''} onChange={e => onChange({ ...form, symptom: e.target.value })}
          placeholder="Contoh: Sharp pain di lutut"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Immediate Action</label>
        <textarea value={form.action ?? ''} onChange={e => onChange({ ...form, action: e.target.value })}
          placeholder="Deskripsi aksi yang harus dilakukan segera"
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Severity / Status</label>
          <select value={form.severity ?? 'green'} onChange={e => onChange({ ...form, severity: e.target.value as Severity })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400">
            {Object.entries(SEVERITY_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.badge}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Detail Keputusan</label>
          <input type="text" value={form.decision_detail ?? ''} onChange={e => onChange({ ...form, decision_detail: e.target.value })}
            placeholder="Contoh: Walk home, ice protocol"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving}
          className="text-xs px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors font-medium">
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
        <button onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">
          Batal
        </button>
      </div>
    </div>
  )
}
