import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from '../hooks/useAthlete'
import { useRole } from '../hooks/useRole'
import { PageHeader } from '../components/ui/PageHeader'
import { EmptyState } from '../components/ui/EmptyState'

interface Group {
  id: string
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
  is_active: boolean | null
  created_at: string | null
  member_count?: number
}

interface GroupMember {
  id: string
  group_id: string
  athlete_id: string
  joined_at: string | null
  status: string | null
  athletes: { name: string } | null
}

interface Notification {
  id: string
  title: string
  body: string | null
  type: string | null
  is_read: boolean | null
  created_at: string | null
  group_id: string | null
}

type ActiveTab = 'groups' | 'notifications'

export default function GroupPage() {
  const { athlete } = useAthlete()
  const athleteId = athlete?.id ?? null
  const { isCoach } = useRole()

  const [activeTab, setActiveTab] = useState<ActiveTab>('groups')
  const [myGroups, setMyGroups] = useState<Group[]>([])
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [members, setMembers] = useState<GroupMember[]>([])
  const [joinedGroups, setJoinedGroups] = useState<Group[]>([])
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteSearch, setInviteSearch] = useState<{ id: string; name: string } | null>(null)
  const [inviteSearching, setInviteSearching] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', start_date: '', end_date: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    if (athleteId) { loadAll(); loadNotifications() }
    return () => { cancelledRef.current = true }
  }, [athleteId, isCoach])

  async function loadAll() {
    setLoading(true); setError(null)
    try {
      if (isCoach) { await loadMyGroups() } else { await loadJoinedGroups() }
    } catch { if (!cancelledRef.current) setError('Gagal memuat data grup.') }
    finally { if (!cancelledRef.current) setLoading(false) }
  }

  async function loadMyGroups() {
    const { data, error: err } = await supabase
      .from('group_programs').select('*')
      .eq('coach_athlete_id', athleteId!).order('created_at', { ascending: false })
    if (err) throw err
    if (cancelledRef.current) return
    const groups: Group[] = []
    for (const g of data ?? []) {
      const { count } = await supabase.from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', g.id).eq('status', 'active')
      groups.push({ ...g, member_count: count ?? 0 })
    }
    if (!cancelledRef.current) setMyGroups(groups)
  }

  async function loadJoinedGroups() {
    const { data, error: err } = await supabase.from('group_members')
      .select('group_id, status, group_programs ( id, name, description, start_date, end_date, is_active, created_at )')
      .eq('athlete_id', athleteId!).eq('status', 'active')
    if (err) throw err
    if (cancelledRef.current) return
    const groups: Group[] = (data ?? []).map((m: any) => m.group_programs).filter(Boolean)
    setJoinedGroups(groups)
  }

  async function loadMembers(groupId: string) {
    const { data, error: err } = await supabase.from('group_members')
      .select('id, group_id, athlete_id, joined_at, status, athletes ( name )')
      .eq('group_id', groupId).order('joined_at', { ascending: true })
    if (err) { if (!cancelledRef.current) setError('Gagal memuat anggota.'); return }
    if (!cancelledRef.current) setMembers((data as unknown as GroupMember[]) ?? [])
  }

  async function loadNotifications() {
    const { data, error: err } = await supabase.from('notifications').select('*')
      .eq('recipient_athlete_id', athleteId!).order('created_at', { ascending: false }).limit(50)
    if (err || cancelledRef.current) return
    const notifs = (data as Notification[]) ?? []
    setNotifications(notifs)
    setUnreadCount(notifs.filter(n => !n.is_read).length)
  }

  function openCreateModal() {
    setForm({ name: '', description: '', start_date: '', end_date: '' })
    setShowGroupModal(true)
  }

  async function handleSaveGroup() {
    if (!form.name.trim()) { setError('Nama grup wajib diisi.'); return }
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('group_programs').insert({
      coach_athlete_id: athleteId!, name: form.name.trim(),
      description: form.description.trim() || null,
      start_date: form.start_date || null, end_date: form.end_date || null, is_active: true,
    })
    setSaving(false)
    if (err) { setError('Gagal membuat grup: ' + err.message); return }
    setShowGroupModal(false); loadMyGroups()
  }

  async function handleToggleActive(group: Group) {
    const { error: err } = await supabase.from('group_programs')
      .update({ is_active: !group.is_active }).eq('id', group.id)
    if (err) { setError('Gagal mengubah status grup.'); return }
    loadMyGroups()
    if (selectedGroup?.id === group.id)
      setSelectedGroup(prev => prev ? { ...prev, is_active: !prev.is_active } : null)
  }

  async function handleDeleteGroup(groupId: string) {
    if (!confirm('Hapus grup ini? Semua anggota akan dikeluarkan.')) return
    const { error: err } = await supabase.from('group_programs').delete().eq('id', groupId)
    if (err) { setError('Gagal menghapus grup.'); return }
    if (selectedGroup?.id === groupId) setSelectedGroup(null)
    loadMyGroups()
  }

  async function handleSearchAthlete() {
    if (!inviteQuery.trim()) return
    setInviteSearching(true); setInviteSearch(null); setError(null)
    const { data, error: err } = await supabase.from('athletes').select('id, name')
      .ilike('name', `%${inviteQuery.trim()}%`).limit(5)
    setInviteSearching(false)
    if (err || !data?.length) { setError('Atlet tidak ditemukan.'); return }
    setInviteSearch(data[0] as { id: string; name: string })
  }

  async function handleInviteAthlete() {
    if (!inviteSearch || !selectedGroup) return
    setSaving(true); setError(null)
    const { data: existing } = await supabase.from('group_members').select('id')
      .eq('group_id', selectedGroup.id).eq('athlete_id', inviteSearch.id).maybeSingle()
    if (existing) { setError('Atlet sudah terdaftar di grup ini.'); setSaving(false); return }
    const { error: errMember } = await supabase.from('group_members').insert({
      group_id: selectedGroup.id, athlete_id: inviteSearch.id, status: 'active',
    })
    if (errMember) { setError('Gagal menambahkan anggota.'); setSaving(false); return }
    await supabase.from('notifications').insert({
      recipient_athlete_id: inviteSearch.id, sender_athlete_id: athleteId!,
      group_id: selectedGroup.id, title: `Undangan Grup: ${selectedGroup.name}`,
      body: `Anda telah ditambahkan ke grup "${selectedGroup.name}".`,
      type: 'group_invite', is_read: false,
    })
    setSaving(false); setShowInviteModal(false); setInviteQuery(''); setInviteSearch(null)
    loadMembers(selectedGroup.id); loadMyGroups()
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Keluarkan anggota ini dari grup?')) return
    const { error: err } = await supabase.from('group_members').delete().eq('id', memberId)
    if (err) { setError('Gagal mengeluarkan anggota.'); return }
    if (selectedGroup) loadMembers(selectedGroup.id)
    loadMyGroups()
  }

  async function handleMarkRead(notifId: string) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', notifId)
    loadNotifications()
  }

  async function handleMarkAllRead() {
    await supabase.from('notifications').update({ is_read: true })
      .eq('recipient_athlete_id', athleteId!).eq('is_read', false)
    loadNotifications()
  }

  function handleSelectGroup(group: Group) {
    setSelectedGroup(group); loadMembers(group.id)
  }

  if (loading) return (
    <div className="p-6 text-center text-gray-500 dark:text-gray-400">Memuat data grup...</div>
  )

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Group Training" subtitle="Manajemen grup latihan" />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">
          {error}<button onClick={() => setError(null)} className="ml-3 underline">Tutup</button>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['groups', 'notifications'] as ActiveTab[]).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}>
            {tab === 'groups' ? 'Grup' : (
              <span className="flex items-center gap-1.5">Notifikasi
                {unreadCount > 0 && <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{unreadCount}</span>}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'groups' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 dark:text-gray-100">{isCoach ? 'Grup Saya' : 'Grup Diikuti'}</h2>
              {isCoach && <button onClick={openCreateModal} className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">+ Buat Grup</button>}
            </div>
            {(isCoach ? myGroups : joinedGroups).length === 0 ? (
              <EmptyState title={isCoach ? 'Belum ada grup' : 'Belum bergabung grup'} description={isCoach ? 'Buat grup baru untuk mulai.' : 'Anda belum bergabung ke grup manapun.'} />
            ) : (
              (isCoach ? myGroups : joinedGroups).map(group => (
                <div key={group.id} onClick={() => handleSelectGroup(group)}
                  className={`rounded-lg border p-4 cursor-pointer transition-all ${selectedGroup?.id === group.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-800 dark:text-gray-100">{group.name}</p>
                      {group.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{group.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {isCoach && <span>{group.member_count ?? 0} anggota</span>}
                        {group.start_date && <span>{group.start_date} → {group.end_date ?? '...'}</span>}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${group.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                      {group.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div>
            {!selectedGroup ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-sm text-gray-400">Pilih grup untuk melihat detail</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-100">{selectedGroup.name}</h3>
                  {isCoach && (
                    <div className="flex gap-2">
                      <button onClick={() => handleToggleActive(selectedGroup)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        {selectedGroup.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button onClick={() => { setShowInviteModal(true); setInviteQuery(''); setInviteSearch(null) }} className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">+ Tambah Anggota</button>
                      <button onClick={() => handleDeleteGroup(selectedGroup.id)} className="text-xs px-2.5 py-1 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">Hapus</button>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Anggota ({members.length})</p>
                  {members.length === 0 ? <p className="text-sm text-gray-400">Belum ada anggota.</p> : (
                    members.map(m => (
                      <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                        <div>
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{m.athletes?.name ?? '—'}</p>
                          <p className="text-xs text-gray-400">Bergabung: {m.joined_at ? new Date(m.joined_at).toLocaleDateString('id-ID') : '—'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${m.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500'}`}>{m.status ?? 'active'}</span>
                          {isCoach && <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-500 hover:text-red-700 transition-colors">Keluarkan</button>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-gray-400">{unreadCount > 0 ? `${unreadCount} belum dibaca` : 'Semua sudah dibaca'}</p>
            {unreadCount > 0 && <button onClick={handleMarkAllRead} className="text-xs text-indigo-600 hover:underline">Tandai semua dibaca</button>}
          </div>
          {notifications.length === 0 ? <EmptyState title="Belum ada notifikasi" /> : (
            notifications.map(n => (
              <div key={n.id} className={`rounded-lg border p-4 transition-colors ${!n.is_read ? 'border-indigo-200 bg-indigo-50 dark:bg-indigo-900/10 dark:border-indigo-800' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{n.title}</p>
                    {n.body && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{n.body}</p>}
                    <p className="text-xs text-gray-400 mt-1">{n.created_at ? new Date(n.created_at).toLocaleString('id-ID') : ''}</p>
                  </div>
                  {!n.is_read && <button onClick={() => handleMarkRead(n.id)} className="text-xs text-indigo-600 hover:underline shrink-0">Tandai dibaca</button>}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Buat Grup Baru</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Nama Grup <span className="text-red-500">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Contoh: Tim HM Bandung 2026"
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Deskripsi</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Opsional"
                  className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Tanggal Mulai</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Tanggal Selesai</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowGroupModal(false)} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Batal</button>
              <button onClick={handleSaveGroup} disabled={saving} className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-60">{saving ? 'Menyimpan...' : 'Buat Grup'}</button>
            </div>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Tambah Anggota ke "{selectedGroup?.name}"</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cari nama atlet</label>
                <div className="flex gap-2 mt-1">
                  <input type="text" value={inviteQuery} onChange={e => { setInviteQuery(e.target.value); setInviteSearch(null) }} placeholder="Ketik nama atlet..."
                    className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button onClick={handleSearchAthlete} disabled={inviteSearching} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-60">{inviteSearching ? '...' : 'Cari'}</button>
                </div>
              </div>
              {inviteSearch && (
                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">Ditemukan: {inviteSearch.name}</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">Klik "Tambahkan" untuk menambahkan ke grup.</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setShowInviteModal(false); setInviteSearch(null); setInviteQuery('') }} className="flex-1 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">Batal</button>
              <button onClick={handleInviteAthlete} disabled={!inviteSearch || saving} className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors disabled:opacity-60">{saving ? 'Menambahkan...' : 'Tambahkan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
