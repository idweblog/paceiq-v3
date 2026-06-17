import { useState } from 'react'
import { supabase } from '../../lib/supabase'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'register') {
      if (inviteCode.trim()) {
        const { data: invite } = await supabase
          .from('coach_invitations')
          .select('id, used_count, max_uses, is_active, expires_at, allowed_email')
          .eq('code', inviteCode.trim().toUpperCase())
          .single()

        if (!invite) {
          setError('Kode invite tidak ditemukan.')
          setLoading(false)
          return
        }
        if (!invite.is_active) {
          setError('Kode invite telah dinonaktifkan.')
          setLoading(false)
          return
        }
        if (new Date(invite.expires_at as string) < new Date()) {
          setError('Kode invite sudah kadaluarsa.')
          setLoading(false)
          return
        }
        const maxUses = (invite.max_uses as number) ?? 1
        const usedCount = (invite.used_count as number) ?? 0
        if (maxUses > 0 && usedCount >= maxUses) {
          setError('Kode invite sudah mencapai batas penggunaan.')
          setLoading(false)
          return
        }
        const allowedEmails = (invite.allowed_email as string[]) ?? []
        if (allowedEmails.length > 0 &&
            !allowedEmails.map((e: string) => e.toLowerCase()).includes(email.toLowerCase())) {
          setError('Email tidak sesuai dengan kode invite.')
          setLoading(false)
          return
        }
      }

      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      const userId = data.user?.id
      if (!userId) { setError('Gagal mendapatkan user ID.'); setLoading(false); return }

      const { error: rpcError } = await supabase.rpc('register_athlete', {
        p_auth_id: userId,
        p_name: name,
        p_email: email,
      })

      if (rpcError) {
        await supabase.auth.signOut()
        setError('Gagal membuat profil. Silakan coba lagi atau hubungi admin.')
        setLoading(false)
        return
      }

      if (inviteCode.trim()) {
        const { data: athleteData } = await supabase
          .from('athletes')
          .select('id')
          .eq('auth_id', userId)
          .single()

        if (athleteData) {
          const { data: claimResult } = await supabase.rpc('claim_invite', {
            p_code: inviteCode.trim().toUpperCase(),
            p_athlete_id: athleteData.id,
            p_email: email,
          })
          if (claimResult === 0) {
            setError('Kode invite tidak valid.')
            setLoading(false)
            return
          }
          if (claimResult === 2) {
            setError('Email tidak sesuai dengan kode invite.')
            setLoading(false)
            return
          }
        }
      }

      setInfo('Registrasi berhasil! Silakan login.')
      setMode('login')
      setName('')
      setEmail('')
      setPassword('')
      setInviteCode('')

    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) { setError(signInError.message); setLoading(false); return }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <h1 className="text-xl font-medium text-gray-800 mb-1">PaceIQ v3</h1>
        <p className="text-sm text-gray-400 mb-6">Train Smarter. Run Faster.</p>

        <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
          <button
            onClick={() => { setMode('login'); setError(''); setInfo('') }}
            className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${mode === 'login' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}
          >Login</button>
          <button
            onClick={() => { setMode('register'); setError(''); setInfo('') }}
            className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${mode === 'register' ? 'bg-white shadow-sm text-gray-800 font-medium' : 'text-gray-500'}`}
          >Register</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Nama lengkap</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Nama lengkap"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Kode invite <span className="text-gray-400">(opsional)</span>
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase tracking-widest"
                  placeholder="XXXXXXXX"
                  maxLength={8}
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Memproses...' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
