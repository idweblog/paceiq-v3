import { useAuth } from './contexts/AuthContext'
import LoginPage from './pages/auth/LoginPage'
import DashboardPage from './pages/DashboardPage'

function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    )
  }

  return session ? <DashboardPage /> : <LoginPage />
}

export default App
