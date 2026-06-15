import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('athletes').select('count').limit(1)
      .then(({ error }) => {
        if (error) {
          setStatus('error')
          setMsg(error.message)
        } else {
          setStatus('ok')
        }
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-medium text-gray-800 mb-2">PaceIQ v3</h1>
        <p className="text-sm text-gray-500">
          Supabase:{' '}
          {status === 'checking' && <span className="text-yellow-600">connecting...</span>}
          {status === 'ok' && <span className="text-green-600">connected ✓</span>}
          {status === 'error' && <span className="text-red-600">error — {msg}</span>}
        </p>
      </div>
    </div>
  )
}

export default App