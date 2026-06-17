import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
import { useAuth } from './contexts/AuthContext'
import GroupPage from './pages/GroupPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
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
        <Route path="admin" element={<AdminPage />} />
        <Route path="/group" element={<ProtectedRoute><GroupPage /></ProtectedRoute>} />
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