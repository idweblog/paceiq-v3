import { useAuth } from '../contexts/AuthContext'
import { useAthlete } from '../hooks/useAthlete'
import { useRole } from '../hooks/useRole'
import AdminPage from './AdminPage'
import { useState } from 'react'

export default function DashboardPage() {
  const { signOut } = useAuth()
  const { athlete, loading } = useAthlete()
  const { isAdmin, loading: roleLoading } = useRole()
  const [page, setPage] = useState<'home' | 'admin'>('home')

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-base font-medium text-gray-800">PaceIQ v3</span>
          <button
            onClick={() => setPage('home')}
            className={`text-sm px-3 py-1 rounded-lg transition-colors ${page === 'home' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
          >Dashboard</button>
          {isAdmin && (
            <button
              onClick={() => setPage('admin')}
              className={`text-sm px-3 py-1 rounded-lg transition-colors ${page === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
            >Admin</button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{athlete?.name}</span>
          <button onClick={signOut} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Sign out
          </button>
        </div>
      </nav>

      {page === 'home' && (
        <div className="flex items-center justify-center mt-24">
          <div className="text-center">
            <p className="text-gray-400 text-sm">Dashboard coming soon — Fase 3</p>
          </div>
        </div>
      )}

      {page === 'admin' && <AdminPage />}
    </div>
  )
}
