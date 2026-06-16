interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'default' | 'green' | 'amber' | 'red' | 'indigo'
}

const accentMap = {
  default: 'border-gray-200',
  green: 'border-green-400',
  amber: 'border-amber-400',
  red: 'border-red-400',
  indigo: 'border-indigo-400',
}

export function StatCard({ label, value, sub, accent = 'default' }: StatCardProps) {
  return (
    <div className={`bg-white rounded-xl border-l-4 ${accentMap[accent]} shadow-sm p-4`}>
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}