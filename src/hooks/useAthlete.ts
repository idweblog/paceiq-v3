import { useEffect, useState } from 'react'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export type Athlete = Database['public']['Tables']['athletes']['Row']

export function useAthlete() {
  const { user } = useAuth()
  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setAthlete(null)
      setLoading(false)
      return
    }

    let cancelled = false

    const fetchAthlete = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('auth_id', user.id)
        .single()

      if (cancelled) return

      if (error) {
        console.error('useAthlete error:', error.message)
        setAthlete(null)
      } else {
        setAthlete(data)
      }
      setLoading(false)
    }

    fetchAthlete()

    return () => { cancelled = true }
  }, [user?.id])

  return { athlete, loading }
}
