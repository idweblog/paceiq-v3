import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface Race {
  id: string
  name: string
  status: string
  event_date: string | null
}

interface ChecklistItem {
  id: string
  phase: 'pre' | 'post'
  category: string | null
  label: string
  is_checked: boolean
  sort_order: number
}

const DEFAULT_ITEMS: Omit<ChecklistItem, 'id'>[] = [
  { phase: 'pre', category: 'Dokumen', label: 'BIB number & race kit diambil', is_checked: false, sort_order: 1 },
  { phase: 'pre', category: 'Dokumen', label: 'Konfirmasi start wave & jam', is_checked: false, sort_order: 2 },
  { phase: 'pre', category: 'Perlengkapan', label: 'Sepatu race (sudah break-in)', is_checked: false, sort_order: 3 },
  { phase: 'pre', category: 'Perlengkapan', label: 'Pakaian race (sudah dicoba)', is_checked: false, sort_order: 4 },
  { phase: 'pre', category: 'Perlengkapan', label: 'GPS Watch + charged', is_checked: false, sort_order: 5 },
  { phase: 'pre', category: 'Perlengkapan', label: 'Earphone / musik (opsional)', is_checked: false, sort_order: 6 },
  { phase: 'pre', category: 'Nutrisi', label: 'Gel / energy bar sesuai rencana', is_checked: false, sort_order: 7 },
  { phase: 'pre', category: 'Nutrisi', label: 'Elektrolit / salt tabs', is_checked: false, sort_order: 8 },
  { phase: 'pre', category: 'Nutrisi', label: 'Sarapan race day sudah diplan', is_checked: false, sort_order: 9 },
  { phase: 'pre', category: 'Logistik', label: 'Transportasi ke start line sudah atur', is_checked: false, sort_order: 10 },
  { phase: 'pre', category: 'Logistik', label: 'Jam bangun pagi race day', is_checked: false, sort_order: 11 },
  { phase: 'pre', category: 'Tubuh', label: 'Tidur cukup H-2 dan H-1', is_checked: false, sort_order: 12 },
  { phase: 'pre', category: 'Tubuh', label: 'Hidrasi optimal 2 hari sebelum', is_checked: false, sort_order: 13 },
  { phase: 'post', category: 'Recovery', label: 'Cooldown jalan 10–15 menit', is_checked: false, sort_order: 1 },
  { phase: 'post', category: 'Recovery', label: 'Rehidrasi + elektrolit', is_checked: false, sort_order: 2 },
  { phase: 'post', category: 'Recovery', label: 'Makan dalam 30–60 menit post-race', is_checked: false, sort_order: 3 },
  { phase: 'post', category: 'Recovery', label: 'Ice bath / contrast shower (opsional)', is_checked: false, sort_order: 4 },
  { phase: 'post', category: 'Evaluasi', label: 'Catat split time & kondisi per km', is_checked: false, sort_order: 5 },
  { phase: 'post', category: 'Evaluasi', label: 'Input actual finish time di Race Management', is_checked: false, sort_order: 6 },
  { phase: 'post', category: 'Evaluasi', label: 'Review apa yang berhasil & perlu diperbaiki', is_checked: false, sort_order: 7 },
]

export default function RaceChecklistPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id

  const [races, setRaces] = useState<Race[]>([])
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activePhase, setActivePhase] = useState<'pre' | 'post'>('pre')
  const [newLabel, setNewLabel] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const seedingRef = useRef(false)

  useEffect(() => {
    if (!athleteId) return
    let cancelled = false

    async function load() {
      if (!athleteId) return
      setLoading(true)
      const { data, error } = await supabase
        .from('races')
        .select('id, name, status, event_date')
        .eq('athlete_id', athleteId!)
        .in('status', ['A', 'B', 'planned'])
        .order('event_date', { ascending: true })
      if (error) console.error('[PaceIQ] races:', error.message)
      if (!cancelled && data) {
        setRaces(data)
        if (data.length > 0) setSelectedRaceId(data[0].id)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [athleteId])

  useEffect(() => {
    if (!selectedRaceId || !athleteId) return
    let cancelled = false

    async function load() {
      if (!athleteId || !selectedRaceId) return
      const { data, error } = await supabase
        .from('race_checklist_items')
        .select('id, phase, category, label, is_checked, sort_order')
        .eq('athlete_id', athleteId!)
        .eq('race_id', selectedRaceId!)
        .order('sort_order', { ascending: true })

      if (error) { console.error('[PaceIQ] checklist:', error.message); return }

      if (!cancelled) {
        if (data && data.length === 0 && !seedingRef.current) {
          seedingRef.current = true
          await seedDefaults()
          seedingRef.current = false
        } else if (data) {
          setItems(data as ChecklistItem[])
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [selectedRaceId, athleteId])

  async function seedDefaults() {
    if (!selectedRaceId || !athleteId) return
    const payload = DEFAULT_ITEMS.map(item => ({
      ...item,
      athlete_id: athleteId,
      race_id: selectedRaceId,
    }))
    const { data, error } = await supabase
      .from('race_checklist_items')
      .insert(payload)
      .select('id, phase, category, label, is_checked, sort_order')
    if (error) console.error('[PaceIQ] seed checklist:', error.message)
    if (data) setItems(data as ChecklistItem[])
  }

  async function toggleItem(id: string, current: boolean) {
    const { error } = await supabase
      .from('race_checklist_items')
      .update({ is_checked: !current })
      .eq('id', id)
    if (error) { console.error('[PaceIQ] toggle:', error.message); return }
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_checked: !current } : i))
  }

  async function addItem() {
    if (!newLabel.trim() || !selectedRaceId || !athleteId) return
    const maxOrder = items.filter(i => i.phase === activePhase).length
    const { data, error } = await supabase
      .from('race_checklist_items')
      .insert({
        athlete_id: athleteId,
        race_id: selectedRaceId,
        phase: activePhase,
        category: newCategory || null,
        label: newLabel.trim(),
        is_checked: false,
        sort_order: maxOrder + 1,
      })
      .select('id, phase, category, label, is_checked, sort_order')
    if (error) { console.error('[PaceIQ] add item:', error.message); return }
    if (data) {
      setItems(prev => [...prev, data[0] as ChecklistItem])
      setNewLabel('')
      setNewCategory('')
      setShowAddForm(false)
    }
  }

  async function deleteItem(id: string) {
    const { error } = await supabase.from('race_checklist_items').delete().eq('id', id)
    if (error) { console.error('[PaceIQ] delete item:', error.message); return }
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const phaseItems = items.filter(i => i.phase === activePhase)
  const categories = [...new Set(phaseItems.map(i => i.category ?? 'Umum'))]
  const checkedCount = phaseItems.filter(i => i.is_checked).length
  const totalCount = phaseItems.length
  const pct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Race Checklist" subtitle="Persiapan sebelum dan sesudah race" />
        <p className="text-gray-400 text-sm">Memuat data...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl">
      <PageHeader title="Race Checklist" subtitle="Persiapan sebelum dan sesudah race" />

      {races.length === 0 ? (
        <EmptyState
          title="Belum ada race aktif"
          description="Tambahkan race di menu Race Management terlebih dahulu."
        />
      ) : (
        <>
          <div className="mb-5">
            <label className="block text-xs text-gray-500 mb-1">Pilih Race</label>
            <select
              value={selectedRaceId ?? ''}
              onChange={e => setSelectedRaceId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {races.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.status.toUpperCase()})</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 mb-4">
            {(['pre', 'post'] as const).map(p => (
              <button key={p} onClick={() => setActivePhase(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activePhase === p
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-300'
                }`}>
                {p === 'pre' ? '📋 Pre-Race' : '✅ Post-Race'}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">Progress {activePhase === 'pre' ? 'Pre-Race' : 'Post-Race'}</span>
              <span className="text-xs font-semibold text-indigo-600">{checkedCount}/{totalCount} ({pct}%)</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-2 bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="space-y-4 mb-4">
            {categories.map(cat => {
              const catItems = phaseItems.filter(i => (i.category ?? 'Umum') === cat)
              return (
                <div key={cat} className="bg-white rounded-xl shadow-sm p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{cat}</h4>
                  <div className="space-y-2">
                    {catItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between group">
                        <label className="flex items-center gap-3 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={item.is_checked}
                            onChange={() => toggleItem(item.id, item.is_checked)}
                            className="w-4 h-4 rounded accent-indigo-600"
                          />
                          <span className={`text-sm ${item.is_checked ? 'line-through text-gray-300' : 'text-gray-700'}`}>
                            {item.label}
                          </span>
                        </label>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="text-xs text-red-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {showAddForm ? (
            <div className="bg-white rounded-xl shadow-sm p-4">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Item baru *</label>
                  <input type="text" value={newLabel} placeholder="Contoh: Vaseline untuk anti-blister"
                    onChange={e => setNewLabel(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Kategori (opsional)</label>
                  <input type="text" value={newCategory} placeholder="Perlengkapan"
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={addItem}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                  Tambah
                </button>
                <button onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
                  Batal
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors">
              + Tambah item
            </button>
          )}
        </>
      )}
    </div>
  )
}