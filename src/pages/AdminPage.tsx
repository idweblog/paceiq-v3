import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Athlete {
  id: string
  name: string
  email: string
  created_at: string | null
  roles: string[]
}

interface Invite {
  id: string
  code: string
  used: boolean | null
  used_count: number | null
  max_uses: number | null
  is_active: boolean | null
  allowed_email: string[] | null
  expires_at: string | null
  created_at: string | null
  role_id: number | null
}

export default function AdminPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [inviteRole, setInviteRole] = useState(3)
  const [inviteMaxUses, setInviteMaxUses] = useState(1)
  const [inviteEmails, setInviteEmails] = useState('')
  const [newCode, setNewCode] = useState('')
  const [tab, setTab] = useState<'users' | 'invites'>('users')

  const fetchAthletes = async () => {
    setLoadingAthletes(true)
    const { data: athleteData } = await supabase
      .from('athletes')
      .select('id, name, email, created_at')
      .order('created_at', { ascending: false })
    const { data: roleData } = await supabase
      .from('athlete_roles')
      .select('athlete_id, role_id')
    const mapped = (athleteData ?? []).map((a: any) => {
      const ids = (roleData ?? []).filter((r: any) => r.athlete_id === a.id).map((r: any) => r.role_id)
      const roleNames: string[] = []
      if (ids.includes(1)) roleNames.push('admin')
      if (ids.includes(2)) roleNames.push('coach')
      if (ids.includes(3)) roleNames.push('athlete')
      return { ...a, roles: roleNames }
    })
    setAthletes(mapped)
    setLoadingAthletes(false)
  }

  const fetchInvites = async () => {
    setLoadingInvites(true)
    const { data } = await supabase
      .from('coach_invitations')
      .select('*')
      .order('created_at', { ascending: false })
    setInvites(data ?? [])
    setLoadingInvites(false)
  }

  useEffect(() => { fetchAthletes(); fetchInvites() }, [])

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

  const toggleActive = async (inv: Invite) => {
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

  const inviteStatus = (inv: Invite) => {
    if (!inv.is_active) return { label: 'Disabled', cls: 'bg-gray-100 text-gray-500' }
    if (inv.expires_at && new Date(inv.expires_at) < new Date())
      return { label: 'Expired', cls: 'bg-yellow-100 text-yellow-700' }
    if ((inv.max_uses ?? 0) > 0 && (inv.used_count ?? 0) >= (inv.max_uses ?? 0))
      return { label: 'Full', cls: 'bg-orange-100 text-orange-700' }
    return { label: 'Active', cls: 'bg-green-100 text-green-700' }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h2 className="text-lg font-medium text-gray-800 mb-6">Admin Panel</h2>

      <div className="flex gap-2 mb-6">
        {(['users', 'invites'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {t === 'users' ? 'Users' : 'Invite Codes'}
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
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Roles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {athletes.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-800">{a.name}</td>
                    <td className="px-4 py-3 text-gray-500">{a.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {a.roles.map(r => (
                          <span key={r} className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge(r)}`}>{r}</span>
                        ))}
                      </div>
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
    </div>
  )
}
