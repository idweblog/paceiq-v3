import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { AppLayout } from './components/layout/AppLayout'
import LoginPage from './pages/auth/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import ProfilPage from './pages/ProfilPage'
import PaceZonesPage from './pages/PaceZonesPage'
import RoadmapPage from './pages/RoadmapPage'
import ProgramPage from './pages/ProgramPage'
import EwsPage from './pages/EwsPage'
import TrainingLoadPage from './pages/TrainingLoadPage'
import DailyLogPage from './pages/DailyLogPage'
import RwrPage from './pages/RwrPage'
import NutritionPage from './pages/NutritionPage'
import TreatmentPage from './pages/TreatmentPage'
import RacesPage from './pages/RacesPage'
import BodyMetricsPage from './pages/BodyMetricsPage'
import ExportPage from './pages/ExportPage'
import ReferensiPage from './pages/ReferensiPage'
import { useEffect } from 'react'
import { useAuth } from './contexts/AuthContext'
import { useRole } from './hooks/useRole'
import GroupPage from './pages/GroupPage'
import CoachDashboardPage from './pages/CoachDashboardPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useRole()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>
  if (!isAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AuthCallback() {
  const navigate = useNavigate()
  useEffect(() => {
    // Supabase akan set session via onAuthStateChange setelah email verified
    const timer = setTimeout(() => navigate('/login?verified=1', { replace: true }), 1500)
    return () => clearTimeout(timer)
  }, [navigate])
  return <div className="flex items-center justify-center h-screen text-gray-400">Memverifikasi email...</div>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="profil" element={<ProfilPage />} />
        <Route path="pace-zones" element={<PaceZonesPage />} />
        <Route path="roadmap" element={<RoadmapPage />} />
        <Route path="program" element={<ProgramPage />} />
        <Route path="ews" element={<EwsPage />} />
        <Route path="training-load" element={<TrainingLoadPage />} />
        <Route path="daily-log" element={<DailyLogPage />} />
        <Route path="rwr" element={<RwrPage />} />
        <Route path="nutrition" element={<NutritionPage />} />
        <Route path="treatment" element={<TreatmentPage />} />
        <Route path="races" element={<RacesPage />} />
        <Route path="body-metrics" element={<BodyMetricsPage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="referensi" element={<ReferensiPage />} />
        <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="group" element={<GroupPage />} />
        <Route path="coach" element={<CoachDashboardPage />} />
      </Route>

    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}