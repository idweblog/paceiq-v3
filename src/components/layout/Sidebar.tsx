import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useRole } from '../../hooks/useRole'

const menuItems = [
  { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  { path: '/profil', label: 'Profil & Analisis', icon: '👤' },
  { path: '/pace-zones', label: 'Pace & HR Zones', icon: '🎯' },
  { path: '/roadmap', label: 'Roadmap & Milestone', icon: '🗺️' },
  { path: '/program', label: 'Program Detail', icon: '📋' },
  { path: '/ews', label: 'EWS Tracker', icon: '⚠️' },
  { path: '/training-load', label: 'Training Load Analytics', icon: '📈' },
  { path: '/daily-log', label: 'Daily Log', icon: '✏️' },
  { path: '/rwr', label: 'RWR Calculator', icon: '🏃' },
  { path: '/nutrition', label: 'Nutrition & Fueling', icon: '🍌' },
  { path: '/treatment', label: 'Treatment Protocol', icon: '💊' },
  { path: '/races', label: 'Race Management', icon: '🏁' },
  { path: '/body-metrics', label: 'Body Metrics', icon: '⚖️' },
  { path: '/export', label: 'Export / Import', icon: '💾' },
  { path: '/referensi', label: 'Referensi & Metodologi', icon: '📚' },
  { path: '/group', label: 'Group Training', icon: '👥' },
]

const coachItems = [
  { path: '/coach', label: 'Coach Dashboard', icon: '🎓' },
]

const adminItems = [
  { path: '/admin', label: 'Admin Panel', icon: '⚙️' },
]

export function Sidebar() {
  const { signOut, user } = useAuth()
  const { isCoach } = useRole()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <aside className="w-64 min-h-screen bg-indigo-950 text-white flex flex-col">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-indigo-800">
        <h1 className="text-xl font-bold text-white">PaceIQ</h1>
        <p className="text-xs text-indigo-300 mt-0.5">Train Smarter. Run Faster.</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-0.5">
          {menuItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                  }`
                }
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>

        {/* Coach section */}
        {isCoach && (
          <div className="mt-4 pt-4 border-t border-indigo-800">
            <p className="px-3 mb-1 text-xs font-semibold uppercase text-indigo-400 tracking-wider">Coach</p>
            <ul className="space-y-0.5">
              {coachItems.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white font-medium'
                          : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                      }`
                    }
                  >
                    <span className="text-base leading-none">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Admin section */}
        <div className="mt-4 pt-4 border-t border-indigo-800">
          <p className="px-3 mb-1 text-xs font-semibold uppercase text-indigo-400 tracking-wider">Admin</p>
          <ul className="space-y-0.5">
            {adminItems.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white font-medium'
                        : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'
                    }`
                  }
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-indigo-800">
        <p className="text-xs text-indigo-300 truncate mb-2">{user?.email}</p>
        <button
          onClick={handleSignOut}
          className="w-full text-xs px-3 py-1.5 rounded bg-indigo-800 hover:bg-indigo-700 text-indigo-100 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </aside>
  )
}
