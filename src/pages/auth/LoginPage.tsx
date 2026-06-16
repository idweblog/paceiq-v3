import { useState } from 'react'
import { supabase } from '../../lib/supabase'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'register') {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }

      const userId = data.user?.id
      if (!userId) { setError('Gagal mendapatkan user ID.'); setLoading(false); return }

      const { error: rpcError } = await supabase.rpc('register_athlete', {
        p_auth_id: userId,
        p_name:    name,
        p_email:   email,
      })

      if (rpcError) { setError(rpcError.message); setLoading(false); return }

      setInfo('Registrasi berhasil! Silakan login.')
      setMode('login')

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
