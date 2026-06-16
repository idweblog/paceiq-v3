import { useAuth } from '../contexts/AuthContext'
import { useAthlete } from '../hooks/useAthlete'

export default function DashboardPage() {
  const { signOut } = useAuth()
  const { athlete, loading } = useAthlete()

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm text-center">
        <h1 className="text-xl font-medium text-gray-800 mb-1">PaceIQ v3</h1>
        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-1">Selamat datang,</p>
            <p className="text-base font-medium text-indigo-600 mb-6">{athlete?.name ?? 'Athlete'}</p>
            <button
              onClick={signOut}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </div>
  )
}
