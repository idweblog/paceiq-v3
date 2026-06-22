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
const SEVERITY_CONFIG: Record<Severity, {
  label: string; icon: string
  headerBg: string; headerText: string
  bodyBg: string; bodyBorder: string; bodyText: string
  badgeText: string
}> = {
  green: {
    label: 'Lanjutkan', icon: '✅',
    headerBg: '#16a34a', headerText: '#ffffff',
    bodyBg: '#f0fdf4', bodyBorder: '#bbf7d0', bodyText: '#14532d',
    badgeText: 'LANJUTKAN'
  },
  yellow: {
    label: 'Peringatan', icon: '⚠️',
    headerBg: '#d97706', headerText: '#ffffff',
    bodyBg: '#fffbeb', bodyBorder: '#fde68a', bodyText: '#78350f',
    badgeText: 'PERINGATAN'
  },
  red: {
    label: 'STOP', icon: '🛑',
    headerBg: '#dc2626', headerText: '#ffffff',
    bodyBg: '#fef2f2', bodyBorder: '#fecaca', bodyText: '#7f1d1d',
    badgeText: 'STOP SEKARANG'
  },
  black: {
    label: 'Emergency', icon: '🚨',
    headerBg: '#0f172a', headerText: '#f8fafc',
    bodyBg: '#1e293b', bodyBorder: '#334155', bodyText: '#f8fafc',
    badgeText: 'DARURAT — MINTA BANTUAN'
  },
}

// ─── Default midsession issues ────────────────────────────────────────────────
const DEFAULT_ISSUES: Omit<MidsessionIssue, 'id' | 'sort_order'>[] = [
  { symptom: 'HR di luar zona target (sustained)', action: 'Slow down 30 det/km, extend walk break ke 45s', severity: 'green', decision_detail: 'Lanjutkan di pace lebih lambat' },
  { symptom: 'Mild side stitch', action: 'Inhale deep, exhale forcefully on opposite footstrike', severity: 'green', decision_detail: 'Biasanya hilang 2–3 menit' },
  { symptom: 'Cramping (calf/hamstring)', action: 'Stop, gentle stretch, sip elektrolit', severity: 'yellow', decision_detail: 'Pace lebih lambat — jika recur → STOP' },
  { symptom: 'Sharp pain di joint', action: 'STOP IMMEDIATELY. Jangan lanjutkan lari dalam kondisi apapun.', severity: 'red', decision_detail: 'Walk home pelan, ice 15–20 menit' },
  { symptom: 'Pusing / mual', action: 'STOP, duduk di tempat teduh, sip elektrolit perlahan', severity: 'red', decision_detail: 'Hydrate, istirahat minimal 10 menit' },
  { symptom: 'Vision blur / disorientation', action: 'STOP NOW. Duduk, minta bantuan orang sekitar.', severity: 'black', decision_detail: 'Possible heat stroke — hubungi panitia / 119' },
]

// ─── Nav sections ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  { key: 'midsession', label: 'Saat Latihan',  icon: '🏃', badge: 'A' },
  { key: 'recovery',   label: 'Pasca Latihan', icon: '💪', badge: 'B' },
  { key: 'doms',       label: 'DOMS',          icon: '😣', badge: 'C' },
  { key: 'acute',      label: 'Cedera Acute',  icon: '🚨', badge: 'D' },
  { key: 'foam',       label: 'Foam Rolling',  icon: '🧘', badge: 'E' },
]

// ─── Default markdown content ─────────────────────────────────────────────────
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
1. Calf & Achilles (paling kritis untuk pelari)
2. Quad & IT-band (terutama post-LR)
3. Glute medius (stabilisasi pinggul)
4. Hip flexor (psoas — sering ketat pada pelari)
5. Upper back / thoracic spine

> 💡 Lakukan setelah lari (otot hangat = lebih efektif). Bisa digabung dengan static stretch 10–15 menit sesudahnya.`
  }
}

// ─── Panduan Format ───────────────────────────────────────────────────────────
const FORMAT_GUIDE = [
  { syntax: '# Judul',   result: 'Heading besar' },
  { syntax: '## Judul',  result: 'Heading sedang' },
  { syntax: '### Judul', result: 'Heading kecil' },
  { syntax: '**teks**',  result: 'Teks tebal' },
  { syntax: '*teks*',    result: 'Teks miring' },
  { syntax: '- item',    result: 'Bullet list' },
  { syntax: '1. item',   result: 'Numbered list' },
  { syntax: '> catatan', result: 'Callout biru' },
  { syntax: '`kode`',    result: 'Inline code' },
  { syntax: '```...```', result: 'Code block' },
  { syntax: '| A | B |', result: 'Tabel' },
  { syntax: '[enter×2]', result: 'Paragraf baru' },
]

// ─── Markdown parser ──────────────────────────────────────────────────────────
function parseMarkdown(text: string): string {
  if (!text) return ''
  const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
  text = text.replace(/```([\s\S]*?)```/g, (_,code) => `\x00CODEBLOCK\x00${esc(code).trim()}\x00ENDCODE\x00`)
  text = text.replace(/`([^`]+)`/g, (_,code) =>
    `<code style="background:#f3f4f6;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:0.78rem;color:#4f46e5">${esc(code)}</code>`)
  const lines = text.split('\n')
  let html = '', inList = false, inOL = false, inTable = false, tableRows: string[] = []
  const flushList = () => { if(inList){html+='</ul>';inList=false} if(inOL){html+='</ol>';inOL=false} }
  const flushTable = () => {
    if (!tableRows.length) return
    const parseRow = (row: string) => row.split('|').slice(1,-1).map(c=>c.trim())
    const header = parseRow(tableRows[0]), body = tableRows.slice(2)
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
    if (/^#\s+/.test(line)&&!/^##/.test(line)) { flushList(); html+=`<div style="font-size:1.1rem;font-weight:700;color:#1e1b4b;margin:14px 0 4px;border-bottom:2px solid #e0e7ff;padding-bottom:4px">${line.replace(/^#\s+/,'')}</div>`; continue }
    if (/^##\s+/.test(line)&&!/^###/.test(line)) { flushList(); html+=`<div style="font-size:0.9rem;font-weight:700;color:#1f2937;margin:10px 0 3px">${line.replace(/^##\s+/,'')}</div>`; continue }
    if (/^###\s+/.test(line)) { flushList(); html+=`<div style="font-size:0.72rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;margin:8px 0 2px">${line.replace(/^###\s+/,'')}</div>`; continue }
    if (/^&gt;\s+/.test(line)) { flushList(); html+=`<div style="background:#eff6ff;border-left:3px solid #4f46e5;border-radius:0 6px 6px 0;padding:8px 12px;margin:8px 0;font-size:0.8rem;color:#1e40af;line-height:1.6">${line.replace(/^&gt;\s+/,'')}</div>`; continue }
    if (/^-\s+/.test(line)) { if(inOL){html+='</ol>';inOL=false} if(!inList){html+='<ul style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:disc">';inList=true} html+=`<li style="margin-bottom:2px">${line.replace(/^-\s+/,'')}</li>`; continue }
    if (/^\d+\.\s+/.test(line)) { if(inList){html+='</ul>';inList=false} if(!inOL){html+='<ol style="margin:4px 0 4px 18px;line-height:1.7;font-size:0.83rem;color:#374151;list-style-type:decimal">';inOL=true} html+=`<li style="margin-bottom:2px">${line.replace(/^\d+\.\s+/,'')}</li>`; continue }
    flushList()
    if (line.trim()==='') {
      const next = lines[i+1]?.trim()??'x'
      html += next==='' ? '<div style="margin-bottom:20px"></div>' : '<div style="margin-bottom:5px"></div>'
      if (next==='') i++; continue }
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
  const [issueForm, setIssueForm]     = useState<Partial<MidsessionIssue> | null>(null)
  const [issueEditId, setIssueEditId] = useState<string | null>(null)
  const [issueSaving, setIssueSaving] = useState(false)
  const [editKey, setEditKey]         = useState<string | null>(null)
  const [editTitle, setEditTitle]     = useState('')
  const [editContent, setEditContent] = useState('')
  const [mdSaving, setMdSaving]       = useState(false)

  const cancelledRef = useRef(false)
  const myIdRef      = useRef<string | null>(null)
  const canEdit      = myRoles.includes('coach') || myRoles.includes('admin')

  const loadData = useCallback(async () => {
    cancelledRef.current = false
    setLoading(true)
    try {
      const { data: myId } = await supabase.rpc('get_my_athlete_id')
      if (!myId || cancelledRef.current) return
      myIdRef.current = myId as string
      const { data: arData } = await supabase.from('athlete_roles').select('role_id').eq('athlete_id', myId as string)
      if (!cancelledRef.current && arData && (arData as any[]).length > 0) {
        const roleIds = (arData as any[]).map((r:any) => r.role_id)
        const { data: rData } = await supabase.from('roles').select('name').in('id', roleIds)
        if (!cancelledRef.current && rData) setMyRoles((rData as any[]).map((r:any) => r.name).filter(Boolean))
      }
      const { data: issData } = await supabase.from('treatment_issues')
        .select('id, symptom, action, severity, decision_detail, sort_order')
        .eq('athlete_id', myId as string).order('sort_order', { ascending: true })
      if (!cancelledRef.current) setIssues((issData ?? []) as any[])
      const { data: proData } = await supabase.from('treatment_protocols')
        .select('id, section_key, title, content, updated_at').eq('athlete_id', myId as string)
      if (!cancelledRef.current) setProtocols((proData ?? []) as any[])
    } finally { if (!cancelledRef.current) setLoading(false) }
  }, [])

  useEffect(() => { loadData(); return () => { cancelledRef.current = true } }, [loadData])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const getDisplayIssues = (): MidsessionIssue[] =>
    issues.length > 0 ? issues : DEFAULT_ISSUES.map((d,i) => ({ ...d, id: `default-${i}`, sort_order: i }))

  async function saveIssue() {
    if (!issueForm || !myIdRef.current) return
    setIssueSaving(true)
    try {
      const myId = myIdRef.current
      if (issues.length === 0) {
        await supabase.from('treatment_issues').insert(DEFAULT_ISSUES.map((d,i) => ({ athlete_id: myId, ...d, sort_order: i })) as any)
      }
      if (issueEditId && !issueEditId.startsWith('default-')) {
        await supabase.from('treatment_issues').update({ symptom: issueForm.symptom, action: issueForm.action, severity: issueForm.severity, decision_detail: issueForm.decision_detail } as any).eq('id', issueEditId)
      } else {
        const maxOrder = Math.max(0, ...getDisplayIssues().map(i => i.sort_order))
        await supabase.from('treatment_issues').insert({ athlete_id: myId, symptom: issueForm.symptom, action: issueForm.action, severity: issueForm.severity ?? 'green', decision_detail: issueForm.decision_detail, sort_order: maxOrder + 1 } as any)
      }
      await loadData(); setIssueEditId(null); setIssueForm(null); showToast('✓ Issue disimpan')
    } catch { showToast('✗ Gagal menyimpan') } finally { setIssueSaving(false) }
  }

  async function deleteIssue(id: string) {
    if (!confirm('Hapus issue ini?')) return
    await supabase.from('treatment_issues').delete().eq('id', id)
    await loadData(); showToast('✓ Issue dihapus')
  }

  async function moveIssue(id: string, dir: -1|1) {
    const list = [...issues]; const idx = list.findIndex(i => i.id === id)
    if (idx < 0) return; const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= list.length) return
    ;[list[idx], list[newIdx]] = [list[newIdx], list[idx]]
    await Promise.all([
      supabase.from('treatment_issues').update({ sort_order: newIdx } as any).eq('id', list[newIdx].id),
      supabase.from('treatment_issues').update({ sort_order: idx } as any).eq('id', list[idx].id),
    ]); await loadData()
  }

  async function resetIssues() {
    if (!confirm('Reset semua issue ke default?')) return
    if (!myIdRef.current) return
    await supabase.from('treatment_issues').delete().eq('athlete_id', myIdRef.current)
    await loadData(); showToast('✓ Issues direset ke default')
  }

  const getProtocol = (key: string) => protocols.find(p => p.section_key === key) ?? null
  const getProtocolContent = (key: string) => getProtocol(key)?.content ?? MARKDOWN_DEFAULTS[key]?.content ?? ''
  const getProtocolTitle = (key: string) => getProtocol(key)?.title ?? MARKDOWN_DEFAULTS[key]?.title ?? ''

  async function saveMd() {
    if (!editKey || !myIdRef.current) return
    setMdSaving(true)
    try {
      const existing = getProtocol(editKey)
      const titleToSave = editTitle.trim() || (MARKDOWN_DEFAULTS[editKey]?.title ?? editKey)
      if (existing) {
        await supabase.from('treatment_protocols').update({ title: titleToSave, content: editContent, updated_at: new Date().toISOString() } as any).eq('id', existing.id)
      } else {
        await supabase.from('treatment_protocols').insert({ athlete_id: myIdRef.current, section_key: editKey, title: titleToSave, content: editContent } as any)
      }
      await loadData(); setEditKey(null); showToast('✓ Protokol disimpan')
    } catch { showToast('✗ Gagal menyimpan') } finally { setMdSaving(false) }
  }

  async function resetMd(key: string) {
    if (!confirm('Reset ke konten default?')) return
    const existing = getProtocol(key)
    if (!existing) return
    await supabase.from('treatment_protocols').delete().eq('id', existing.id)
    await loadData(); if (editKey === key) setEditKey(null); showToast('✓ Direset ke default')
  }

  const activeNav = NAV_SECTIONS.find(n => n.key === activeKey)!
  const displayIssues = getDisplayIssues()
  const isDefaultIssues = issues.length === 0

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat treatment protocol...</div>

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">

      {toast && <div className="fixed top-4 right-4 z-50 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">{toast}</div>}

      {/* ── Nav pills ── */}
      <div className="bg-white rounded-xl shadow-sm p-2 flex gap-2 flex-wrap">
        {NAV_SECTIONS.map(nav => (
          <button key={nav.key}
            onClick={() => { setActiveKey(nav.key); setEditKey(null); setIssueForm(null) }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeKey === nav.key ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500 hover:text-indigo-600 hover:bg-indigo-50'
            }`}>
            <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${
              activeKey === nav.key ? 'bg-white text-indigo-600' : 'bg-indigo-100 text-indigo-600'
            }`}>{nav.badge}</span>
            {nav.icon} {nav.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SEKSI A — MID-SESSION ISSUES                                        */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeKey === 'midsession' && (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-1">
                  🏃 Saat Latihan — Mid-Session Issues
                </h2>
                <p className="text-xs text-gray-400">
                  Panduan penanganan masalah yang muncul saat sesi lari berlangsung.
                  {isDefaultIssues && <span className="text-amber-500 ml-1">Menampilkan data default.</span>}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 ml-4">
                  {!isDefaultIssues && (
                    <button onClick={resetIssues}
                      className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                      Reset Default
                    </button>
                  )}
                  <button onClick={() => { setIssueEditId(null); setIssueForm({ symptom:'', action:'', severity:'green', decision_detail:'' }) }}
                    className="text-xs px-3 py-1 rounded-lg border border-emerald-500 text-emerald-600 hover:bg-emerald-50 transition-colors font-medium">
                    + Tambah Issue
                  </button>
                </div>
              )}
            </div>

            {/* Add form */}
            {issueForm && !issueEditId && (
              <div className="mt-4">
                <IssueForm form={issueForm} onChange={setIssueForm} onSave={saveIssue} onCancel={() => setIssueForm(null)} saving={issueSaving} isNew />
              </div>
            )}
          </div>

          {/* Issue cards — 2 col grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {displayIssues.map((iss, idx) => {
              const sev = SEVERITY_CONFIG[iss.severity as Severity] ?? SEVERITY_CONFIG.green
              const isEditing = issueEditId === iss.id
              return (
                <div key={iss.id} className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
                  {/* Severity strip header */}
                  <div className="px-4 py-3 flex items-center justify-between gap-2"
                    style={{ backgroundColor: sev.headerBg }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold flex-shrink-0" style={{ color: sev.headerText, opacity: 0.7 }}>#{idx+1}</span>
                      <span className="font-bold text-sm leading-tight" style={{ color: sev.headerText }}>{sev.icon} {sev.badgeText}</span>
                    </div>
                    {canEdit && !isEditing && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => moveIssue(iss.id, -1)} disabled={idx===0||iss.id.startsWith('default-')}
                          className="p-1 rounded text-white opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity text-xs">▲</button>
                        <button onClick={() => moveIssue(iss.id, 1)} disabled={idx===displayIssues.length-1||iss.id.startsWith('default-')}
                          className="p-1 rounded text-white opacity-60 hover:opacity-100 disabled:opacity-20 transition-opacity text-xs">▼</button>
                        <button onClick={() => { setIssueEditId(iss.id); setIssueForm({...iss}) }}
                          className="text-xs px-2 py-1 rounded text-white border border-white border-opacity-40 hover:bg-white hover:bg-opacity-20 transition-colors">Edit</button>
                        {!iss.id.startsWith('default-') && (
                          <button onClick={() => deleteIssue(iss.id)}
                            className="text-xs px-2 py-1 rounded text-white border border-white border-opacity-40 hover:bg-red-600 transition-colors">Hapus</button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="p-4">
                      <IssueForm form={issueForm!} onChange={setIssueForm} onSave={saveIssue} onCancel={() => { setIssueEditId(null); setIssueForm(null) }} saving={issueSaving} />
                    </div>
                  ) : (
                    <div className="p-4 space-y-3">
                      {/* Symptom */}
                      <div>
                        <div className="text-xs font-medium text-gray-400 uppercase mb-1">Gejala / Situasi</div>
                        <div className="text-sm font-semibold text-gray-800">{iss.symptom}</div>
                      </div>
                      {/* Action */}
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                        <div className="text-xs font-medium text-gray-400 uppercase mb-1">⚡ Tindakan Segera</div>
                        <div className="text-sm text-gray-700 leading-relaxed">{iss.action}</div>
                      </div>
                      {/* Decision */}
                      {iss.decision_detail && (
                        <div className="rounded-lg px-3 py-2 text-xs font-medium"
                          style={{ background: sev.bodyBg, border: `1px solid ${sev.bodyBorder}`, color: sev.bodyText }}>
                          {iss.decision_detail}
                        </div>
                      )}
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
        <div className="space-y-4">
          {/* Panduan Format collapsed */}
          <details className="bg-white rounded-xl shadow-sm overflow-hidden group">
            <summary className="flex items-center justify-between px-5 py-3.5 cursor-pointer select-none list-none border-b border-gray-100 hover:bg-gray-50 transition-colors">
              <h2 className="font-gsans text-base text-indigo-700 uppercase">📖 Panduan Format</h2>
              <span className="text-xs text-gray-400 group-open:hidden">Klik untuk lihat</span>
              <span className="text-xs text-gray-400 hidden group-open:inline">Tutup ▲</span>
            </summary>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {FORMAT_GUIDE.map(g => (
                  <div key={g.syntax} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                    <code className="text-xs font-mono text-indigo-600 block mb-1">{g.syntax}</code>
                    <div className="text-xs text-gray-500">{g.result}</div>
                  </div>
                ))}
              </div>
            </div>
          </details>

          {/* Content section */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100"
              style={{ borderLeftWidth: 4, borderLeftColor: '#4f46e5', borderLeftStyle: 'solid' }}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{activeNav.icon}</span>
                <div>
                  <h2 className="font-gsans text-xl text-indigo-700 uppercase">{getProtocolTitle(activeKey)}</h2>
                  {getProtocol(activeKey)?.updated_at && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      Diubah {new Date(getProtocol(activeKey)!.updated_at).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' })}
                    </div>
                  )}
                </div>
              </div>
              {canEdit && editKey !== activeKey && (
                <button onClick={() => { setEditKey(activeKey); setEditTitle(getProtocolTitle(activeKey)); setEditContent(getProtocolContent(activeKey)) }}
                  className="text-xs px-3 py-1 rounded-lg border border-indigo-500 text-indigo-600 hover:bg-indigo-50 transition-colors">
                  Edit
                </button>
              )}
              {canEdit && editKey === activeKey && (
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditKey(null)} className="text-xs px-3 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors">Batal</button>
                  {getProtocol(activeKey) && (
                    <button onClick={() => resetMd(activeKey)} className="text-xs px-3 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">Reset</button>
                  )}
                  <button onClick={saveMd} disabled={mdSaving}
                    className="text-xs px-4 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                    {mdSaving ? '...' : 'Simpan'}
                  </button>
                </div>
              )}
            </div>
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
        </div>
      )}

    </div>
  )
}

// ─── IssueForm ────────────────────────────────────────────────────────────────
function IssueForm({ form, onChange, onSave, onCancel, saving, isNew=false }: {
  form: Partial<MidsessionIssue>; onChange: (f: Partial<MidsessionIssue>) => void
  onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean
}) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
      {isNew && <div className="text-xs font-bold text-indigo-600 uppercase mb-1">Tambah Issue Baru</div>}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Gejala / Situasi</label>
        <input type="text" value={form.symptom??''} onChange={e => onChange({...form, symptom:e.target.value})}
          placeholder="Contoh: Sharp pain di lutut kiri"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Tindakan Segera</label>
        <textarea value={form.action??''} onChange={e => onChange({...form, action:e.target.value})}
          placeholder="Deskripsi tindakan yang harus dilakukan" rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400 resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Status</label>
          <select value={form.severity??'green'} onChange={e => onChange({...form, severity:e.target.value as Severity})}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400">
            {Object.entries(SEVERITY_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase mb-1 block">Detail Keputusan</label>
          <input type="text" value={form.decision_detail??''} onChange={e => onChange({...form, decision_detail:e.target.value})}
            placeholder="Contoh: Walk home, es 20 menit"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-indigo-400" />
        </div>
      </div>
      <div className="flex gap-2">
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
