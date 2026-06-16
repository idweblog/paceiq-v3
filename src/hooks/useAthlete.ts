import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export interface Athlete {
  id: string
  name: string
  email: string
  auth_id: string | null
  created_at: string | null
}

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
    const fetchAthlete = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('auth_id', user.id)
        .single()
      if (error) {
        console.error('useAthlete error:', error.message)
        setAthlete(null)
      } else {
        setAthlete(data)
      }
      setLoading(false)
    }
    fetchAthlete()
  }, [user?.id])

  return { athlete, loading }
}
