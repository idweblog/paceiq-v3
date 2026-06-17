import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type AthleteRow = Database['public']['Tables']['athletes']['Row']
type RoleRow = Database['public']['Tables']['athlete_roles']['Row']
type InviteRow = Database['public']['Tables']['coach_invitations']['Row']
type Policy = 'invitation_only' | 'open_email_verification' | 'open_admin_approval'

interface AthleteWithRoles extends AthleteRow {
  roles: string[]
}

export default function AdminPage() {
  const [athletes, setAthletes] = useState<AthleteWithRoles[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [pendingAthletes, setPendingAthletes] = useState<AthleteRow[]>([])
  const [policy, setPolicy] = useState<Policy>('open_email_verification')
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [loadingPolicy, setLoadingPolicy] = useState(true)
  const [loadingPending, setLoadingPending] = useState(false)
  const [assigningRole, setAssigningRole] = useState<string | null>(null)
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState(3)
  const [inviteMaxUses, setInviteMaxUses] = useState(1)
  const [inviteEmails, setInviteEmails] = useState('')
  const [newCode, setNewCode] = useState('')
  const [tab, setTab] = useState<'users' | 'invites' | 'registration'>('users')
  const { user: currentUser } = useAuth()
  const cancelledRef = useRef(false)

  const fetchAthletes = async () => {
    setLoadingAthletes(true)
    const { data: athleteData } = await supabase
      .from('athletes')
      .select('id, name, email, created_at, auth_id, status')
      .order('created_at', { ascending: false })
    const { data: roleData } = await supabase
      .from('athlete_roles')
      .select('athlete_id, role_id')
    const mapped = (athleteData ?? []).map((a: AthleteRow) => {
      const ids = (roleData ?? [] as RoleRow[])
        .filter((r: RoleRow) => r.athlete_id === a.id)
        .map((r: RoleRow) => r.role_id)
      const roleNames: string[] = []
      if (ids.includes(1)) roleNames.push('admin')
      if (ids.includes(2)) roleNames.push('coach')
      if (ids.includes(3)) roleNames.push('athlete')
      return { ...a, roles: roleNames }
    })
    if (!cancelledRef.current) { setAthletes(mapped); setLoadingAthletes(false) }
  }

  const fetchInvites = async () => {
    setLoadingInvites(true)
    const { data } = await supabase
      .from('coach_invitations')
      .select('*')
      .order('created_at', { ascending: false })
    if (!cancelledRef.current) { setInvites(data ?? []); setLoadingInvites(false) }
  }

  const fetchPolicy = async () => {
    setLoadingPolicy(true)
    const { data } = await supabase.rpc('get_registration_policy')
    if (!cancelledRef.current) {
      setPolicy((data as Policy) ?? 'open_email_verification')
      setLoadingPolicy(false)
    }
  }

  const fetchPending = async () => {
    setLoadingPending(true)
    const { data } = await supabase
      .from('athletes')
      .select('id, name, email, created_at, auth_id, status')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (!cancelledRef.current) { setPendingAthletes(data ?? []); setLoadingPending(false) }
  }

  useEffect(() => {
    cancelledRef.current = false
    fetchAthletes()
    fetchInvites()
    fetchPolicy()
    return () => { cancelledRef.current = true }
  }, [])

  useEffect(() => {
    if (tab === 'registration') fetchPending()
  }, [tab])

  // Realtime: update pending queue live
  useEffect(() => {
    const channel = supabase
      .channel('admin-pending-athletes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'athletes' }, () => {
        if (!cancelledRef.current) fetchPending()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  const savePolicy = async (p: Policy) => {
    setSavingPolicy(true)
    const { error } = await supabase.rpc('set_registration_policy', { p_policy: p } as never)
    if (error) alert('Gagal menyimpan policy: ' + error.message)
    else setPolicy(p)
    setSavingPolicy(false)
  }

  const approveAthlete = async (id: string) => {
    await supabase.from('athletes').update({ status: 'active' }).eq('id', id)
    fetchPending()
    fetchAthletes()
  }

  const rejectAthlete = async (id: string) => {
    if (!confirm('Tolak dan suspend akun ini?')) return
    await supabase.from('athletes').update({ status: 'suspended' }).eq('id', id)
    fetchPending()
    fetchAthletes()
  }

  const deleteAthlete = async (a: AthleteWithRoles) => {
    if (!confirm(`Hapus user "${a.name}" (${a.email})? Semua data akan dihapus permanen.`)) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ athlete_id: a.id }),
    })
    const result = await res.json()
    if (!res.ok) alert('Gagal menghapus: ' + result.error)
    else fetchAthletes()
  }

  const toggleRole = async (a: AthleteWithRoles, roleName: string, roleId: number) => {
    setAssigningRole(a.id + roleName)
    const hasRole = a.roles.includes(roleName)
    if (hasRole) {
      await supabase.from('athlete_roles').delete()
        .eq('athlete_id', a.id).eq('role_id', roleId)
    } else {
      await supabase.from('athlete_roles').insert({ athlete_id: a.id, role_id: roleId })
    }
    setAssigningRole(null)
    fetchAthletes()
  }

  const generateInvite = async () => {
    setGeneratingInvite(true)
    setNewCode('')
    const emailList = inviteEmails
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0)
    const { data, error } = await supabase.rpc('generate_invite_code', {
      p_role_id: inviteRole,
      p_max_uses: inviteMaxUses,
      p_allowed_emails: emailList.length > 0 ? emailList : null,
    })
    if (error) alert('Error: ' + error.message)
    else { setNewCode(data); fetchInvites() }
    setGeneratingInvite(false)
  }

  const toggleActive = async (inv: InviteRow) => {
    await supabase
      .from('coach_invitations')
      .update({ is_active: !inv.is_active })
      .eq('id', inv.id)
    fetchInvites()
  }

  const deleteInvite = async (id: string) => {
    if (!confirm('Hapus kode invite ini?')) return
    await supabase.from('coach_invitations').delete().eq('id', id)
    fetchInvites()
  }

  const roleLabel = (id: number | null) =>
    id === 1 ? 'Admin' : id === 2 ? 'Coach' : 'Athlete'

  const roleBadge = (name: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-700',
      coach: 'bg-blue-100 text-blue-700',
      athlete: 'bg-green-100 text-green-700',
    }
    return colors[name] ?? 'bg-gray-100 text-gray-600'
  }

  const inviteStatus = (inv: InviteRow) => {
    if (!inv.is_active) return { label: 'Disabled', cls: 'bg-gray-100 text-gray-500' }
    if (inv.expires_at && new Date(inv.expires_at) < new Date())
      return { label: 'Expired', cls: 'bg-yellow-100 text-yellow-700' }
    if ((inv.max_uses ?? 0) > 0 && (inv.used_count ?? 0) >= (inv.max_uses ?? 0))
      return { label: 'Full', cls: 'bg-orange-100 text-orange-700' }
    return { label: 'Active', cls: 'bg-green-100 text-green-700' }
  }

  const policyOptions: { value: Policy; label: string; desc: string }[] = [
    { value: 'invitation_only', label: 'Invitation Only', desc: 'Registrasi hanya dengan kode invite valid.' },
    { value: 'open_email_verification', label: 'Open + Email Verification', desc: 'Bebas register, wajib verifikasi email sebelum login.' },
    { value: 'open_admin_approval', label: 'Open + Admin Approval', desc: 'Bebas register, Admin harus approve sebelum akun aktif.' },
  ]

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h2 className="text-lg font-medium text-gray-800 mb-6">Admin Panel</h2>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(['users', 'invites', 'registration'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {t === 'users' ? 'Users' : t === 'invites' ? 'Invite Codes' : (
              <span className="flex items-center gap-1.5">
                Registrasi
                {pendingAthletes.length > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-medium">
                    {pendingAthletes.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loadingAthletes ? <p className="text-sm text-gray-400 p-6">Loading...</p> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Nama</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Roles</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Assign Role</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {athletes.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{a.name}</td>
                    <td className="px-4 py-3 text-gray-500">{a.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        a.status === 'active' ? 'bg-green-100 text-green-700' :
                        a.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {a.roles.map(r => (
                          <span key={r} className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge(r)}`}>{r}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {[{ name: 'admin', id: 1 }, { name: 'coach', id: 2 }, { name: 'athlete', id: 3 }].map(role => (
                          <button
                            key={role.name}
                            onClick={() => toggleRole(a, role.name, role.id)}
                            disabled={assigningRole === a.id + role.name}
                            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                              a.roles.includes(role.name)
                                ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                                : 'border-gray-200 text-gray-400 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'
                            } disabled:opacity-50`}
                          >
                            {a.roles.includes(role.name) ? '✓' : '+'} {role.name}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteAthlete(a)}
                        disabled={a.auth_id === currentUser?.id}
                        className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'invites' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Generate invite code</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value={3}>Athlete</option>
                  <option value={2}>Coach</option>
                  <option value={1}>Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Maks. penggunaan (0 = unlimited)</label>
                <input
                  type="number"
                  min={0}
                  value={inviteMaxUses}
                  onChange={e => setInviteMaxUses(Number(e.target.value))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">
                Email restriction <span className="text-gray-400">(opsional — pisahkan dengan koma)</span>
              </label>
              <textarea
                value={inviteEmails}
                onChange={e => setInviteEmails(e.target.value)}
                placeholder="user1@email.com, user2@email.com"
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
              {inviteEmails.trim() && (
                <p className="text-xs text-gray-400 mt-1">
                  {inviteEmails.split(',').map(e => e.trim()).filter(e => e).length} email terdaftar
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={generateInvite}
                disabled={generatingInvite}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {generatingInvite ? 'Generating...' : 'Generate'}
              </button>
              {newCode && (
                <span className="font-mono text-lg font-medium text-indigo-600 tracking-widest">{newCode}</span>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loadingInvites ? <p className="text-sm text-gray-400 p-6">Loading...</p> : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Code</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Role</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Pakai</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Email restriction</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Expires</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invites.map(inv => {
                    const status = inviteStatus(inv)
                    const emails = inv.allowed_email ?? []
                    return (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono font-medium text-gray-800 tracking-widest">{inv.code}</td>
                        <td className="px-4 py-3 text-gray-500">{roleLabel(inv.role_id)}</td>
                        <td className="px-4 py-3 text-gray-500">
                          {inv.used_count ?? 0}/{inv.max_uses === 0 ? '∞' : (inv.max_uses ?? '∞')}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[180px]">
                          {emails.length === 0 ? '—' : (
                            <span title={emails.join(', ')}>
                              {emails[0]}{emails.length > 1 ? ` +${emails.length - 1} lainnya` : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.cls}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString('id-ID') : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => toggleActive(inv)}
                              className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                            >
                              {inv.is_active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              onClick={() => deleteInvite(inv.id)}
                              className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {invites.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">Belum ada invite code</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'registration' && (
        <div className="space-y-6">
          {/* Policy Switcher */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-medium text-gray-700 mb-1">Kebijakan Registrasi</p>
            <p className="text-xs text-gray-400 mb-4">Tentukan bagaimana user baru bisa bergabung ke platform.</p>
            {loadingPolicy ? <p className="text-sm text-gray-400">Loading...</p> : (
              <div className="space-y-3">
                {policyOptions.map(opt => (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      policy === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="policy"
                      value={opt.value}
                      checked={policy === opt.value}
                      onChange={() => savePolicy(opt.value)}
                      disabled={savingPolicy}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                ))}
                {savingPolicy && <p className="text-xs text-indigo-500">Menyimpan...</p>}
              </div>
            )}
          </div>

          {/* Approval Queue */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Antrian Persetujuan</p>
                <p className="text-xs text-gray-400 mt-0.5">Akun yang menunggu aktivasi Admin.</p>
              </div>
              {policy !== 'open_admin_approval' && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                  Tidak aktif pada mode ini
                </span>
              )}
            </div>
            {loadingPending ? (
              <p className="text-sm text-gray-400 p-6">Loading...</p>
            ) : pendingAthletes.length === 0 ? (
              <p className="text-sm text-gray-400 p-6 text-center">Tidak ada akun yang menunggu persetujuan.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Nama</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Email</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Daftar</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingAthletes.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-800">{a.name}</td>
                      <td className="px-4 py-3 text-gray-500">{a.email}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {a.created_at ? new Date(a.created_at).toLocaleDateString('id-ID') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => approveAthlete(a.id)}
                            className="text-xs px-3 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 transition-colors font-medium"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectAthlete(a.id)}
                            className="text-xs px-3 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Tolak
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
