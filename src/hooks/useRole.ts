import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAthlete } from './useAthlete'

interface RoleData {
  roles: string[]
  isAdmin: boolean
  isCoach: boolean
  isAthlete: boolean
  loading: boolean
}

export function useRole(): RoleData {
  const { athlete, loading: athleteLoading } = useAthlete()
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (athleteLoading) return
    if (!athlete) { setLoading(false); return }

    const fetchRoles = async () => {
      const { data, error } = await supabase
        .from('athlete_roles')
        .select('role_id')
        .eq('athlete_id', athlete.id)

      if (error) {
        console.error('useRole error:', error.message)
        setLoading(false)
        return
      }

      const roleIds = (data ?? []).map((r: any) => r.role_id)
      const roleNames: string[] = []
      if (roleIds.includes(1)) roleNames.push('admin')
      if (roleIds.includes(2)) roleNames.push('coach')
      if (roleIds.includes(3)) roleNames.push('athlete')

      setRoles(roleNames)
      setLoading(false)
    }

    fetchRoles()
  }, [athlete?.id, athleteLoading])

  return {
    roles,
    isAdmin: roles.includes('admin'),
    isCoach: roles.includes('coach'),
    isAthlete: roles.includes('athlete'),
    loading,
  }
}
