import { useState } from 'react'
import { PageHeader } from '../components/ui/PageHeader'

interface Section {
  id: string
  title: string
  icon: string
  content: { heading?: string; text: string }[]
}

const SECTIONS: Section[] = [
  {
    id: 'vdot',
    title: 'VDOT & Jack Daniels Formula',
    icon: '📐',
    content: [
      { text: 'VDOT adalah estimasi VO₂max efektif yang dikembangkan oleh Jack Daniels, PhD. Nilai ini dihitung dari performa lomba atau time trial, bukan tes laboratorium.' },
      { heading: 'Formula VO₂ pada kecepatan v (m/menit)', text: 'VO₂ = -4.60 + 0.182258v + 0.000104v²' },
      { heading: 'Persentase VO₂max yang digunakan', text: '%VO₂max = 0.8 + 0.1894393·e^(-0.012778t) + 0.2989558·e^(-0.1932605t)\ndimana t = waktu finish dalam menit' },
      { heading: 'VDOT', text: 'VDOT = VO₂ / %VO₂max' },
      { text: 'Dari VDOT, pace training per zone (E, M, T, I, R) dapat diturunkan menggunakan inverse formula. PaceIQ menggunakan binary search untuk inversion ini.' },
      { heading: 'Referensi', text: 'Daniels, J. (2005). Daniels\' Running Formula (2nd ed.). Human Kinetics.' },
    ]
  },
  {
    id: 'galloway',
    title: 'Run-Walk-Run (Galloway Method)',
    icon: '🏃',
    content: [
      { text: 'Metode Run-Walk-Run (RWR) dikembangkan oleh Jeff Galloway. Interval jalan yang strategis memungkinkan pelari mempertahankan pace lebih lama dengan risiko cedera lebih rendah.' },
      { heading: 'Blended Pace (Harmonic Mean)', text: 'Pace_blended = (t_run + t_walk) / (d_run + d_walk)\ndimana d_run = t_run / pace_run dan d_walk = t_walk / pace_walk' },
      { text: 'PaceIQ menggunakan formula harmonic mean ini untuk menghitung pace blended dan projected finish time secara akurat.' },
      { heading: 'Rekomendasi Rasio', text: 'Rasio optimal bergantung pada pace target. Pelari dengan pace 7:00/km umumnya menggunakan 120:30 (lari 2 menit, jalan 30 detik).' },
      { heading: 'Referensi', text: 'Galloway, J. (2016). Run Walk Run Method. Meyer & Meyer Sport.' },
    ]
  },
  {
    id: 'trimp',
    title: 'TRIMP Bannister & Training Load',
    icon: '⚡',
    content: [
      { text: 'TRIMP (Training Impulse) adalah metrik untuk mengkuantifikasi beban latihan berdasarkan durasi dan intensitas HR.' },
      { heading: 'Formula TRIMP Bannister', text: 'TRIMP = D × HRR × 0.64 × e^(1.92 × HRR)\ndimana D = durasi (menit), HRR = (HR_avg - HR_rest) / (HR_max - HR_rest)' },
      { heading: 'CTL (Chronic Training Load)', text: 'CTL = rata-rata TRIMP harian dalam 42 hari terakhir (EWMA). Representasi kebugaran (fitness).' },
      { heading: 'ATL (Acute Training Load)', text: 'ATL = rata-rata TRIMP harian dalam 7 hari terakhir (EWMA). Representasi kelelahan (fatigue).' },
      { heading: 'TSB (Training Stress Balance)', text: 'TSB = CTL - ATL. Representasi form. Positif = segar, negatif = lelah.' },
      { heading: 'Referensi', text: 'Bannister, E.W. (1991). Modeling Elite Athletic Performance. Human Kinetics.\nFitts, R.H., et al. (1994). Training-related adaptations. Journal of Applied Physiology.' },
    ]
  },
  {
    id: 'acwr',
    title: 'ACWR & Injury Risk',
    icon: '⚠️',
    content: [
      { text: 'Acute:Chronic Workload Ratio (ACWR) adalah rasio beban latihan 7 hari terakhir dibagi rata-rata 28 hari terakhir.' },
      { heading: 'Formula', text: 'ACWR = ATL₇ / CTL₂₈' },
      { heading: 'Interpretasi', text: '0.8–1.3: Sweet spot — risiko cedera rendah, adaptasi optimal\n< 0.8: Undertraining — kurang stimulus\n1.3–1.5: Warning zone — monitor ketat\n> 1.5: Danger zone — risiko cedera tinggi' },
      { text: 'ACWR di atas 1.5 berkorelasi dengan peningkatan risiko cedera non-kontak sebesar 2–4× lipat dibanding sweet spot.' },
      { heading: 'Referensi', text: 'Gabbett, T.J. (2016). The training-injury prevention paradox. British Journal of Sports Medicine, 50(5), 273-280.' },
    ]
  },
  {
    id: 'herzones',
    title: 'HR Zones (Joe Friel)',
    icon: '❤️',
    content: [
      { text: 'PaceIQ menggunakan sistem 7 zone HR berbasis LTHR (Lactate Threshold Heart Rate) yang dikembangkan oleh Joe Friel.' },
      { heading: 'Zone 1 — Recovery', text: '< 81% LTHR. Pemulihan aktif, sangat ringan.' },
      { heading: 'Zone 2 — Aerobic', text: '81–89% LTHR. Dasar aerobik, bisa bicara dengan nyaman.' },
      { heading: 'Zone 3 — Tempo', text: '90–93% LTHR. Moderately hard, napas mulai terbatas.' },
      { heading: 'Zone 4 — Sub-threshold', text: '94–99% LTHR. Hard, mendekati threshold.' },
      { heading: 'Zone 5a — Super-threshold', text: '100–102% LTHR. Di sekitar lactate threshold.' },
      { heading: 'Zone 5b — Aerobic Capacity', text: '103–106% LTHR. VO₂max territory.' },
      { heading: 'Zone 5c — Anaerobic', text: '> 106% LTHR. Sprint, anaerobik.' },
      { heading: 'Referensi', text: 'Friel, J. (2009). The Triathlete\'s Training Bible (3rd ed.). VeloPress.' },
    ]
  },
  {
    id: 'lthr',
    title: 'LTHR & Lactate Threshold',
    icon: '🔬',
    content: [
      { text: 'Lactate Threshold Heart Rate (LTHR) adalah HR pada intensitas di mana laktat mulai terakumulasi lebih cepat dari kemampuan tubuh membersihkannya.' },
      { heading: 'Cara menentukan LTHR (Friel Protocol)', text: '1. Lari 30 menit all-out (solo, bukan race)\n2. Catat rata-rata HR pada 20 menit terakhir\n3. Nilai tersebut adalah LTHR kamu' },
      { text: 'LTHR adalah titik referensi utama untuk semua zone latihan di PaceIQ. Update LTHR setiap 6–8 minggu atau setelah peningkatan signifikan.' },
      { heading: 'Referensi', text: 'Friel, J. (2009). The Triathlete\'s Training Bible. VeloPress.\nConconi, F., et al. (1982). Determination of the anaerobic threshold. Journal of Applied Physiology.' },
    ]
  },
  {
    id: 'ews',
    title: 'EWS — Early Warning System',
    icon: '🚨',
    content: [
      { text: 'Early Warning System (EWS) adalah sistem monitoring subjektif harian untuk mendeteksi tanda-tanda overtraining, underrecovery, atau penurunan performa sebelum berdampak.' },
      { heading: 'Metrics yang dipantau', text: 'Mood, Fatigue, Stress, Sleep Quality, Muscle Soreness, Motivation — semua dalam skala 1–5.\nResting HR dan HRV sebagai indikator objektif.' },
      { heading: 'Composite Score', text: 'Rata-rata dari 6 subjective metrics. Score < 3.0 adalah warning zone — pertimbangkan untuk reduce intensity atau ambil hari istirahat.' },
      { heading: 'HRV (Heart Rate Variability)', text: 'HRV rendah (relatif terhadap baseline personal) mengindikasikan sistem saraf parasimpatik belum fully recovered. Korelasi kuat dengan readiness untuk latihan keras.' },
      { heading: 'Referensi', text: 'Meeusen, R., et al. (2013). Prevention, diagnosis and treatment of overtraining syndrome. European Journal of Sport Science.\nKendall, K.L., et al. (2017). HRV as a monitoring tool. International Journal of Sports Physiology.' },
    ]
  },
  {
    id: 'riegel',
    title: 'Prediksi Race (Riegel Formula)',
    icon: '🏁',
    content: [
      { text: 'PaceIQ menggunakan formula Riegel untuk memprediksi finish time di jarak berbeda berdasarkan performa yang sudah diketahui.' },
      { heading: 'Formula Riegel', text: 'T₂ = T₁ × (D₂/D₁)^1.06\ndimana T = waktu finish, D = jarak' },
      { text: 'Eksponen 1.06 mencerminkan kenyataan bahwa pelari melambat secara non-linear seiring jarak bertambah. Nilai ini adalah rata-rata empiris dari ribuan data race.' },
      { heading: 'Akurasi', text: 'Paling akurat untuk prediksi dalam range 5K–Marathon. Untuk prediksi HM dari Magic Mile (1.6 km), gunakan faktor koreksi Galloway: T_HM = T_MM × 1.06 × (21097/1609)^1.06' },
      { heading: 'Referensi', text: 'Riegel, P.S. (1981). Athletic Records and Human Endurance. American Scientist, 69(3), 285-290.' },
    ]
  },
  {
    id: 'wbgt',
    title: 'Heat & WBGT Adjustment',
    icon: '🌡️',
    content: [
      { text: 'Panas dan kelembaban secara signifikan mempengaruhi performa lari. PaceIQ menyediakan heat mode adjustment untuk pace zones.' },
      { heading: 'WBGT (Wet Bulb Globe Temperature)', text: 'WBGT = 0.567 × T_dry + 0.393 × e + 3.94\ndimana e = tekanan uap (hPa), T = suhu (°C)' },
      { heading: 'Dampak pada Performa', text: '< 10°C: Optimal\n10–15°C: Minimal impact\n15–20°C: 1–2% slower\n20–25°C: 3–5% slower\n25–30°C: 5–8% slower\n> 30°C: 8–12% slower atau lebih' },
      { text: 'Untuk kondisi Makassar dan kota-kota tropis Indonesia, heat adjustment sangat relevan — terutama untuk latihan siang dan race yang start pagi namun berakhir saat matahari tinggi.' },
      { heading: 'Referensi', text: 'Ely, M.R., et al. (2007). Impact of weather on marathon-running performance. Medicine & Science in Sports & Exercise.' },
    ]
  },
  {
    id: 'ctlceiling',
    title: 'CTL Ceiling & Training Age',
    icon: '📊',
    content: [
      { text: 'CTL (Chronic Training Load) memiliki batas atas yang aman berdasarkan training age dan kapasitas adaptasi individu.' },
      { heading: 'CTL Ceiling PaceIQ', text: 'Training Age < 2 tahun: CTL ceiling 75\nTraining Age 2–5 tahun: CTL ceiling 92\nTraining Age > 5 tahun: CTL ceiling 110' },
      { text: 'Nilai ini diturunkan dari referensi Mujika & Padilla (2003) dengan faktor koreksi 0.88 untuk atlet masters (usia 40+) karena kapasitas recovery yang lebih rendah.' },
      { heading: 'Training Age', text: 'Training age adalah jumlah tahun seseorang berlatih secara konsisten dan terstruktur — bukan usia biologis. Pelari pemula dengan usia 40 tahun memiliki training age 0, bukan 40.' },
      { heading: 'Referensi', text: 'Mujika, I. & Padilla, S. (2003). Scientific bases for precompetition tapering strategies. Medicine & Science in Sports & Exercise.\nFoster, C. (1998). Monitoring training in athletes with reference to overtraining syndrome. Medicine & Science in Sports & Exercise.' },
    ]
  },
]

export default function ReferensiPage() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id)
  const active = SECTIONS.find(s => s.id === activeId)!

  return (
    <div className="p-6 max-w-5xl">
      <PageHeader title="Referensi & Metodologi" subtitle="Landasan ilmiah metodologi training PaceIQ" />

      <div className="flex gap-6">
        {/* Sidebar nav */}
        <div className="w-52 shrink-0">
          <div className="space-y-1">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  activeId === s.id
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-gray-600 hover:bg-gray-50 border border-transparent'
                }`}
              >
                <span className="mr-2">{s.icon}</span>
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">
              {active.icon} {active.title}
            </h2>
            <div className="space-y-4">
              {active.content.map((block, i) => (
                <div key={i}>
                  {block.heading && (
                    <h3 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-1">
                      {block.heading}
                    </h3>
                  )}
                  <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
                    {block.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}