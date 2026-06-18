import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

type Mode = 'login' | 'register'
type Policy = 'invitation_only' | 'open_email_verification' | 'open_admin_approval' | null

export default function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [policy, setPolicy] = useState<Policy>(null)

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    if (searchParams.get('verified') === '1') {
      setInfo('Email berhasil diverifikasi! Silakan login.')
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_registration_policy').then(({ data }) => {
      if (!cancelled) setPolicy((data as Policy) ?? 'open_email_verification')
    })
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'register') {
      // Validasi invite code wajib jika policy invitation_only
      if (policy === 'invitation_only' && !inviteCode.trim()) {
        setError('Kode invite diperlukan untuk registrasi.')
        setLoading(false)
        return
      }

      // Validasi invite code SEBELUM signUp agar auth user tidak terbuat jika invite invalid
      if (policy === 'invitation_only') {
        const { data: validResult, error: validError } = await supabase.rpc('validate_invite_code', {
          p_code: inviteCode.trim().toUpperCase(),
          p_email: email,
        } as never)
        if (validError || validResult !== 'ok') {
          setError('Kode invite tidak valid, sudah habis, atau tidak sesuai email. Hubungi admin.')
          setLoading(false)
          return
        }
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      const userId = signUpData.user?.id
      if (!userId) { setError('Gagal mendapatkan user ID.'); setLoading(false); return }

      const { error: rpcError } = await supabase.rpc('register_athlete', {
        p_name: name,
        p_email: email,
        p_auth_id: userId,
        p_invite_code: inviteCode.trim().toUpperCase() || null,
      } as never)

      if (rpcError) {
        await supabase.auth.signOut()
        const msg = rpcError.message ?? ''
        if (msg.includes('INVITE_REQUIRED')) setError('Kode invite diperlukan untuk registrasi.')
        else if (msg.includes('INVITE_INVALID')) setError('Kode invite tidak valid atau sudah habis.')
        else setError('Gagal membuat profil. Silakan coba lagi atau hubungi admin.')
        setLoading(false)
        return
      }


      await supabase.auth.signOut()

      if (policy === 'open_email_verification') {
        setInfo('Registrasi berhasil! Silakan cek email Anda untuk verifikasi sebelum login.')
      } else if (policy === 'open_admin_approval') {
        setInfo('Registrasi berhasil! Akun Anda sedang menunggu persetujuan Admin sebelum bisa digunakan.')
      } else {
        setInfo('Registrasi berhasil! Silakan login.')
      }
      setMode('login')
      setName(''); setEmail(''); setPassword(''); setInviteCode('')
      setLoading(false)
      return

      setInfo('Registrasi berhasil! Silakan login.')
      setMode('login')
      setName(''); setEmail(''); setPassword(''); setInviteCode('')

    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) { setError(signInError.message); setLoading(false); return }

      // Cek status athlete setelah login
      const { data: { user: loggedInUser } } = await supabase.auth.getUser()
      const { data: athleteData } = await supabase
        .from('athletes')
        .select('status')
        .eq('auth_id', loggedInUser?.id ?? '')
        .single()

      if (athleteData?.status === 'pending') {
        await supabase.auth.signOut()
        setError('Akun Anda sedang menunggu persetujuan Admin.')
        setLoading(false)
        return
      }

      if (athleteData?.status === 'suspended') {
        await supabase.auth.signOut()
        setError('Akun Anda telah ditangguhkan. Hubungi admin.')
        setLoading(false)
        return
      }
    }

    setLoading(false)
  }

  const showInviteField = mode === 'register' && (policy === 'invitation_only' || policy === null)
  const inviteOptional = policy !== 'invitation_only'

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

              {showInviteField && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">
                    Kode invite {inviteOptional && <span className="text-gray-400">(opsional)</span>}
                    {!inviteOptional && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    type="text"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    required={!inviteOptional}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase tracking-widest"
                    placeholder="XXXXXXXX"
                    maxLength={8}
                  />
                </div>
              )}

              {policy === 'open_admin_approval' && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  Akun Anda akan direview oleh Admin sebelum bisa mengakses platform.
                </p>
              )}
              {policy === 'open_email_verification' && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                  Setelah register, cek email Anda untuk verifikasi akun.
                </p>
              )}
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
            disabled={loading || (mode === 'register' && policy === null)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Memproses...' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  )
}
