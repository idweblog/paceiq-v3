import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'

// ============================================================
// TYPES
// ============================================================
interface AthleteSettings {
  resting_hr: number | null
  hrv_baseline: number | null
  tl_trimp_base: number
  tl_rpe_weight: number
  tl_heat_low: number
  tl_heat_mod: number
  tl_heat_high: number
  tl_pen_whey: number
  tl_pen_bcaa: number
  tl_pen_creatine: number
  training_age_years: number | null
  birth_date: string | null
  gender: string | null
}


interface ProgramSession {
  id: string
  session_date: string
  program_type: string
  notes: string | null
  details?: { zone_name: string; distance_km: number | null; est_duration_min: number | null }[]
}

interface EwsEntry {
  entry_date: string
  resting_hr: number | null
  hrv: number | null
  sleep_hours: number | null
  sleep_quality: number | null
  muscle_soreness: number | null
  motivation: number | null
}

interface TrainingSession {
  id: string
  athlete_id: string
  session_date: string
  session_type: string
  duration_min: number | null
  distance_km: number | null
  avg_hr: number | null
  max_hr: number | null
  hr_part1: number | null
  hr_part2: number | null
  hr_drift_pct: number | null
  rpe: number | null
  perceived_feel: string | null
  heat_condition: string | null
  sup_whey: boolean
  sup_bcaa: boolean
  sup_creatine: boolean
  notes: string | null
  program_session_id: string | null
  // computed fields
  pace: string | null
  daily_tl: number | null
  atl: number | null
  ctl: number | null
  tsb: number | null
  acwr: number | null
  risk_flag: string | null
  deload_signal: string | null
  next_rec: string | null
  efficiency_index: number | null
  stimulus: string | null
  eff_tag: string | null
  rqs: number | null
  fatigue_score: number | null
  readiness: number | null
  hr_zone: number | null
  hr_intensity_pct: number | null
  pace_zone_name: string | null
  srpe_load: number | null
  hr_load: number | null
  base_load: number | null
  fatigue_mult: number | null
  drift_penalty: number | null
  maxhr_penalty: number | null
  plan_duration: number | null
  plan_rpe: number | null
  plan_load: number | null
  plan_vs_actual: string | null
  load_deviation_pct: number | null
  recovery_need: string | null
  session_quality: string | null
  three_day_risk: string | null
  z_score: number | null
  personal_load_status: string | null
}

interface LogForm {
  session_date: string
  session_type: string
  program_session_id: string
  duration_min: string
  distance_km: string
  avg_hr: string
  max_hr: string
  hr_part1: string
  hr_part2: string
  rpe: string
  perceived_feel: string
  heat_condition: string
  sup_whey: boolean
  sup_bcaa: boolean
  sup_creatine: boolean
  notes: string
}

interface TLSettings {
  trimp_base: number
  rpe_weight: number
  heat_low: number
  heat_mod: number
  heat_high: number
  pen_whey: number
  pen_bcaa: number
  pen_creatine: number
}

interface CalcResult {
  pace: string
  hr_drift_pct: number
  hrZone: number
  hrIntPct: number
  paceZoneName: string
  srpeLoad: number
  hrLoad: number
  baseLoad: number
  fatigueMult: number
  driftPenalty: number
  maxHRPenalty: number
  heatFactor: number
  dailyTL: number
  dailyCat: string
  planLoad: number
  planVsActual: string
  loadDevPct: number
  readiness: number
  rqs: number
  baseRecHours: number
  effectiveRecHours: number
  recoveryNeed: string
  stimulus: string
  effTag: string
  effIdx: number
  riskFlag: string
  ewsScore: number
  atl: number
  ctl: number
  tsb: number
  acwr: number
  ewmaLabel: string
  form: number
  zScore: number
  deloadSig: string
  nextRec: string
  sessionQuality: string
  threeDayLabel: string
  personalLoad: string
}

// ============================================================
// CONSTANTS
// ============================================================
const PROGRAM_TYPES = [
  'EASY RUN (EZ)', 'LONGRUN (LR)', 'MEDIUM RUN (MD-R)', 'FARTLEK (SPEED PLAY)',
  'SUB-TEMPO (SPEED)', 'TEMPO RUN (SPEED)', 'SUB-THRESHOLD RUN (SPEED)',
  'THRESHOLD RUN (SPEED)', 'SUPRA-THRESHOLD RUN (SPEED)', 'SPECIFIC LONGRUN (S-LR)',
  'MIXED PACE (SPEED)', 'VCR TEST / TIME TRIAL', 'RACE DAY',
  'STRENGTH - (SENIN)', 'RUNNING DRILLS - (Kamis)', 'ST / RD (Mandiri)',
]

const PERCEIVED_FEELS = ['Luar Biasa', 'Baik', 'Biasa', 'Berat', 'Sangat Berat']
const HEAT_CONDITIONS = ['Low', 'Mod', 'High']
const PAGE_SIZE = 14

const VCR_ZONES = [
  { name: 'Recovery',      pct_min: 0.64, pct_max: 0.68 },
  { name: 'Long Run',      pct_min: 0.69, pct_max: 0.71 },
  { name: 'Easy',          pct_min: 0.74, pct_max: 0.76 },
  { name: 'Moderate',      pct_min: 0.83, pct_max: 0.85 },
  { name: 'Tempo',         pct_min: 0.88, pct_max: 0.90 },
  { name: 'Threshold',     pct_min: 0.92, pct_max: 0.94 },
  { name: 'Aerobic Power', pct_min: 1.00, pct_max: 1.02 },
  { name: 'VO2Max',        pct_min: 1.03, pct_max: 1.05 },
  { name: 'Anaerob',       pct_min: 1.09, pct_max: 1.15 },
]

const DEFAULT_TL_SETTINGS: TLSettings = {
  trimp_base: 1.0, rpe_weight: 1.05,
  heat_low: 1.0, heat_mod: 1.15, heat_high: 1.30,
  pen_whey: 0.06, pen_bcaa: 0.04, pen_creatine: 0.03,
}

// ============================================================
// HELPERS
// ============================================================
function fmtDateShort(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

// Get Monday of a given date's week
function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}
function getSundayOfWeek(dateStr: string): string {
  const mon = getMondayOfWeek(dateStr)
  const d = new Date(mon + 'T00:00:00')
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
}

function paceFromDurDist(durMin: number, distKm: number): string {
  if (!durMin || !distKm) return ''
  const secPerKm = (durMin * 60) / distKm
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function paceToSecPerKm(paceStr: string): number {
  const parts = paceStr.split(':')
  if (parts.length !== 2) return 0
  return parseInt(parts[0]) * 60 + parseInt(parts[1])
}

function getPaceZone(vcr: number, secPerKm: number): string {
  if (!vcr || !secPerKm) return '—'
  const pct = (1000 / secPerKm) / vcr
  for (const z of VCR_ZONES) {
    if (pct >= z.pct_min - 0.005 && pct <= z.pct_max + 0.005) return z.name
  }
  if (pct < VCR_ZONES[0].pct_min) return 'Below Recovery'
  return 'Above Anaerob'
}

// Joe Friel 7-zone HR from LTHR
function getHRZone(avgHR: number, lthr: number): number {
  if (!avgHR || !lthr) return 1
  const pct = avgHR / lthr
  if (pct >= 1.06) return 7
  if (pct >= 1.03) return 6
  if (pct >= 1.00) return 5
  if (pct >= 0.94) return 4  // 5b
  if (pct >= 0.90) return 4  // 5a → collapse to 4 for 7-zone
  if (pct >= 0.85) return 3
  if (pct >= 0.82) return 2
  return 1
}

// EWS Score calculation (v2.11 locked: 35% physio + 30% sleep + 20% DOMS + 15% energy)
function calcEWSScore(
  rhr: number, hrv: number, sleep: number, qual: number,
  doms: number, energy: number,
  baselineRHR: number, baselineHRV: number
): number {
  const rhrDelta = rhr - baselineRHR
  const hrvDelta = baselineHRV - hrv  // lower HRV = more fatigue
  const physioRaw = Math.max(0, Math.min(100, (rhrDelta * 3) + (hrvDelta * 2)))
  const sleepRaw  = Math.max(0, Math.min(100, ((8 - sleep) * 10) + ((5 - qual) * 6)))
  const domsRaw   = Math.max(0, Math.min(100, doms * 20))
  const energyRaw = Math.max(0, Math.min(100, (5 - energy) * 20))
  return physioRaw * 0.35 + sleepRaw * 0.30 + domsRaw * 0.20 + energyRaw * 0.15
}

// Week label
function weekLabel(dateStr: string): string {
  const mon = getMondayOfWeek(dateStr)
  const sun = getSundayOfWeek(dateStr)
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
  return `${fmt(mon)} – ${fmt(sun)}`
}

// ============================================================
// MAIN ENGINE — Training Load Calculation (v2.11 parity)
// ============================================================
function calcTrainingLoad(
  form: LogForm,
  settings: TLSettings,
  refMaxHR: number,
  refHRrest: number,
  lthr: number,
  ewsScore: number,
  vcr: number,
  savedSessions: TrainingSession[]  // all previously saved sessions, sorted asc
): CalcResult {
  const dur   = parseFloat(form.duration_min)  || 0
  const dist  = parseFloat(form.distance_km)   || 0
  const avgHR = parseFloat(form.avg_hr)        || 0
  const maxHR = parseFloat(form.max_hr)        || 0
  const hr1   = parseFloat(form.hr_part1)      || 0
  const hr2   = parseFloat(form.hr_part2)      || 0
  const rpe   = parseFloat(form.rpe)           || 0
  const planDur = 0  // filled from linked program session if any (passed as 0 when not linked)
  const planRPE = 0

  // Pace & drift
  const pace = (dur > 0 && dist > 0) ? paceFromDurDist(dur, dist) : ''
  const secPerKm = pace ? paceToSecPerKm(pace) : 0
  const driftPct = (hr1 > 0 && hr2 > 0) ? ((hr2 - hr1) / hr1) * 100 : 0

  // HR Zone (Joe Friel, LTHR-based)
  const hrZone = (avgHR > 0 && lthr > 0) ? getHRZone(avgHR, lthr) : 1
  const hrIntPct = (avgHR > 0 && lthr > 0) ? (avgHR / lthr) * 100 : 0

  // Pace Zone (VCR-based)
  const paceZoneName = (vcr > 0 && secPerKm > 0) ? getPaceZone(vcr, secPerKm) : '—'

  // ── TRIMP Bannister ──
  let hrLoad = 0
  if (avgHR > 0 && refMaxHR > refHRrest) {
    const hrr = Math.max(0, Math.min(1, (avgHR - refHRrest) / (refMaxHR - refHRrest)))
    hrLoad = dur * hrr * 0.64 * Math.exp(1.92 * hrr) * settings.trimp_base
  }

  // ── sRPE (Carl Foster) ──
  const srpeLoad = dur * rpe * settings.rpe_weight

  // ── Base Load ──
  const baseLoad = hrLoad > 0 ? (srpeLoad * 0.65) + (hrLoad * 0.35) : srpeLoad

  // ── Fatigue Multiplier (EWS) ──
  const fatigueMult = 1 + (ewsScore / 100) * 0.40

  // ── HR Drift Penalty ──
  const driftPenalty = driftPct > 5 ? 1 + ((driftPct - 5) / 100) : 1.0

  // ── Max HR Penalty (linear, personal) ──
  let maxHRPenalty = 1.0
  if (maxHR > 0 && refMaxHR > 0) {
    const pct = (maxHR / refMaxHR) * 100
    if (pct <= 95)       maxHRPenalty = 1.0
    else if (pct <= 100) maxHRPenalty = 1.0 + ((pct - 95) / 5) * 0.05
    else if (pct <= 105) maxHRPenalty = 1.05 + ((pct - 100) / 5) * 0.10
    else                 maxHRPenalty = 1.15
  }

  // ── Heat Factor ──
  const heatFactor = form.heat_condition === 'High' ? settings.heat_high
    : form.heat_condition === 'Mod' ? settings.heat_mod
    : settings.heat_low

  // ── Daily TL Final ──
  const dailyTL = baseLoad * fatigueMult * driftPenalty * maxHRPenalty * heatFactor
  const dailyCat = dailyTL > 600 ? 'Severe' : dailyTL > 400 ? 'Hard' : dailyTL > 200 ? 'Moderate' : 'Light'

  // ── Plan vs Actual ──
  const planLoad = planDur * planRPE
  const loadDevPct = planLoad > 0 ? ((dailyTL - planLoad) / planLoad) * 100 : 0
  const planVsActual = planLoad > 0
    ? (Math.abs(loadDevPct) <= 10 ? 'On Target' : loadDevPct > 10 ? 'Over' : 'Under')
    : '—'

  // ── Readiness ──
  const readiness = Math.max(0, 100 - ewsScore)

  // ── RQS ──
  let rqs = 1.0
  if (form.sup_whey)     rqs += settings.pen_whey
  if (form.sup_bcaa)     rqs += settings.pen_bcaa
  if (form.sup_creatine) rqs += settings.pen_creatine

  // ── Recovery Need ──
  const baseRecHours = dailyTL > 600 ? 72 : dailyTL > 400 ? 48 : dailyTL > 200 ? 24 : 12
  const effectiveRecHours = Math.round(baseRecHours / rqs)
  const recoveryNeed = effectiveRecHours > 48
    ? `${effectiveRecHours}j (Berat)`
    : effectiveRecHours > 24
    ? `${effectiveRecHours}j (Sedang)`
    : `${effectiveRecHours}j (Ringan)`

  // ── Efficiency Index & Stimulus ──
  const effIdx = (dur > 0 && dist > 0 && avgHR > 0) ? ((dist * 1000 / dur) / avgHR) : 0

  const stimulusMap: Record<number, string> = {
    1: 'Fat Burn / Recovery', 2: 'Aerobic Base', 3: 'Aerobic Threshold',
    4: 'Lactate Tolerance', 5: 'VO2max / Neuromuscular',
    6: 'Speed / Power', 7: 'Maximal Effort',
  }
  const stimulus = stimulusMap[hrZone] || 'Aerobic Base'

  const isHeatAffected = (form.heat_condition === 'High' || form.heat_condition === 'Mod') && hrIntPct > 88
  const isFatigueAffected = ewsScore > 30 && hrIntPct > 85
  let effTag = 'Efficient'
  if (isHeatAffected || isFatigueAffected) {
    effTag = 'Heat/Fatigue Affected'
  } else if (driftPct > 5) {
    effTag = 'Cardiac Drift'
  } else if (effIdx > 0) {
    const effThreshold = hrZone <= 2 ? 0.85 : 0.75
    if (effIdx >= effThreshold && driftPct <= 3) effTag = 'Highly Efficient'
  }

  // ── EWMA ATL/CTL (from saved sessions, sorted asc) ──
  const k7  = 1 - Math.exp(-1 / 7)
  const k28 = 1 - Math.exp(-1 / 28)
  const dateStr = form.session_date

  const pastSessions = savedSessions
    .filter(s => s.session_date < dateStr && (s.daily_tl || 0) > 0)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  let atl = 0, ctl = 0
  pastSessions.forEach(s => {
    atl = (s.daily_tl! * k7) + atl * (1 - k7)
    ctl = (s.daily_tl! * k28) + ctl * (1 - k28)
  })
  const atlToday = dailyTL * k7 + atl * (1 - k7)
  const ctlToday = dailyTL * k28 + ctl * (1 - k28)
  const form_tsb = ctl - atl  // TSB = CTL_yesterday - ATL_yesterday

  // ── Cold Start Protection ──
  const dataSessions = pastSessions.length
  const isGracePeriod = dataSessions < 21
  const acwrThreshold = dataSessions < 28 ? 1.5 : 1.3
  const ctlMinimum = 50

  let ewmaRat = 0, ewmaLabel = 'Building Base'
  if (ctlToday > ctlMinimum && !isGracePeriod) {
    ewmaRat = atlToday / ctlToday
    ewmaLabel = ewmaRat > 1.3 ? 'Danger Zone' : ewmaRat > 0.8 ? 'Sweet Spot' : 'Detraining'
  } else {
    ewmaLabel = isGracePeriod ? 'Building Base (Grace Period)' : 'Low CTL — Accumulating'
  }

  const zScore = ctlToday > 0 ? (dailyTL - ctlToday) / Math.max(ctlToday * 0.3, 1) : 0

  // ── Risk Flag ──
  const rqsThresholdBonus = (rqs - 1.0) * 33
  let riskFlag = 'Low'
  if (ewsScore > (45 - rqsThresholdBonus) || dailyTL > 800 || driftPct > 10) riskFlag = 'HIGH'
  else if (ewsScore > (30 - rqsThresholdBonus) || dailyTL > 500) riskFlag = 'Medium'

  // ── 3-Day Projected Risk ──
  let threeDayLabel = '—'
  if (pastSessions.length >= 7) {
    const last7TL = pastSessions.slice(-7).reduce((s, x) => s + (x.daily_tl || 0), 0)
    const avgDaily7 = last7TL / 7
    const densityFactor = 5 / 7
    const projected3Day = (avgDaily7 * densityFactor * 3) + dailyTL
    const threeDayRatio = ctlToday > 0 ? projected3Day / ctlToday : 0
    threeDayLabel = threeDayRatio > 1.3
      ? `${threeDayRatio.toFixed(2)} ⚠ HIGH`
      : threeDayRatio > 1.0
      ? `${threeDayRatio.toFixed(2)} Monitor`
      : `${threeDayRatio.toFixed(2)} OK`
  } else {
    threeDayLabel = `Butuh ≥7 data (${pastSessions.length} ada)`
  }

  // ── Deload Signal ──
  const deloadThresholdAdj = acwrThreshold + (rqs - 1.0) * 0.05
  let deloadSig = 'NO'
  if (!isGracePeriod && ctlToday > ctlMinimum) {
    if (ewmaRat > acwrThreshold || ewsScore > 50) deloadSig = 'YES'
  } else if (ewsScore > 55) {
    deloadSig = 'YES'
  }
  if (!isGracePeriod && ewmaRat > 0 && ewmaRat <= deloadThresholdAdj && ewsScore <= 50) deloadSig = 'NO'

  // ── Next Session Rec ──
  const sessQuality = planVsActual === 'On Target' && driftPct <= 5 ? 'Excellent' : driftPct > 10 ? 'Poor' : 'Good'
  let nextRec = 'Proceed to Plan'
  if (deloadSig === 'YES') {
    nextRec = 'Active Recovery / Full Rest'
  } else if (riskFlag === 'HIGH') {
    nextRec = 'Easy RWR Z1-Z2 Only'
  } else if (dailyCat === 'Severe') {
    nextRec = rqs >= 1.1 ? 'Easy RWR (RQS OK)' : 'Easy RWR / Rest'
  } else if (riskFlag === 'Medium') {
    nextRec = rqs >= 1.07 ? 'Proceed — Monitor HR' : 'Reduce Intensity 10%'
  }

  // ── Personal Load Status ──
  const sisaSesi = Math.max(0, 21 - dataSessions)
  const personalLoad = isGracePeriod
    ? `Building Base (+${sisaSesi} sesi lagi)`
    : ctlToday <= ctlMinimum
    ? 'Low CTL — Accumulating'
    : ewmaLabel

  return {
    pace, hr_drift_pct: driftPct,
    hrZone, hrIntPct, paceZoneName,
    srpeLoad, hrLoad, baseLoad,
    fatigueMult, driftPenalty, maxHRPenalty, heatFactor,
    dailyTL, dailyCat,
    planLoad, planVsActual, loadDevPct,
    readiness, rqs, baseRecHours, effectiveRecHours, recoveryNeed,
    stimulus, effTag, effIdx,
    riskFlag, ewsScore,
    atl: atlToday, ctl: ctlToday, tsb: form_tsb, acwr: ewmaRat,
    ewmaLabel, form: form_tsb, zScore,
    deloadSig, nextRec, sessionQuality: sessQuality,
    threeDayLabel, personalLoad,
  }
}

// Weekly summary engine (v2.11 parity)
function calcWeeklySummary(sessions: TrainingSession[]) {
  const k7  = 1 - Math.exp(-1 / 7)
  const k28 = 1 - Math.exp(-1 / 28)

  const valid = sessions
    .filter(s => s.session_date && (s.daily_tl || 0) > 0)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  if (!valid.length) return []

  // Group by calendar week (Mon–Sun)
  const weekMap: Map<string, TrainingSession[]> = new Map()
  valid.forEach(s => {
    const mon = getMondayOfWeek(s.session_date)
    if (!weekMap.has(mon)) weekMap.set(mon, [])
    weekMap.get(mon)!.push(s)
  })

  const weeks = Array.from(weekMap.entries()).sort(([a], [b]) => a.localeCompare(b))

  return weeks.map(([monStr, sesi]) => {
    const n = sesi.length
    const weeklyTL   = sesi.reduce((s, x) => s + (x.daily_tl || 0), 0)
    const avgDailyTL = weeklyTL / n
    const totalMin   = sesi.reduce((s, x) => s + (x.duration_min || 0), 0)
    const totalKm    = sesi.reduce((s, x) => s + (x.distance_km || 0), 0)
    const easyMin    = sesi.filter(x => x.session_type?.includes('EZ') || x.session_type?.includes('EASY') || x.session_type?.includes('Recovery')).reduce((s, x) => s + (x.duration_min || 0), 0)
    const easyPct    = totalMin > 0 ? (easyMin / totalMin) * 100 : 0
    const avgFatigue = sesi.reduce((s, x) => s + (x.fatigue_score || 0), 0) / n
    const hardSessions = sesi.filter(x => (x.rpe || 0) > 7 || (x.daily_tl || 0) > 600).length

    // SD & Monotony
    let sdDailyTL = 0
    if (n >= 2) {
      const variance = sesi.reduce((s, x) => s + Math.pow((x.daily_tl || 0) - avgDailyTL, 2), 0) / n
      sdDailyTL = Math.sqrt(variance)
    }
    let monotony: number | null = null
    let monotonyDisplay = '—'
    if (n < 2) { monotony = null }
    else if (sdDailyTL === 0) { monotony = Infinity; monotonyDisplay = 'Flat Load' }
    else { monotony = avgDailyTL / sdDailyTL; monotonyDisplay = monotony.toFixed(2) }

    const strain = (monotony !== null && isFinite(monotony)) ? weeklyTL * monotony : null

    // EWMA end-of-week: recompute from scratch up to end of this week
    const allUpToWeek = valid.filter(s => s.session_date <= (sesi[sesi.length - 1].session_date))
    let atl = 0, ctl = 0
    allUpToWeek.forEach(s => {
      atl = (s.daily_tl! * k7) + atl * (1 - k7)
      ctl = (s.daily_tl! * k28) + ctl * (1 - k28)
    })
    const ewmaRatEnd = ctl > 50 && valid.length >= 21 ? atl / ctl : null
    const formEnd = ctl - atl

    // Status & deload
    const mon = isFinite(monotony || 0) ? (monotony || 0) : 999
    let weeklyStatus = '—'
    let deloadSignal = 'Belum diperlukan'
    if (weeklyTL > 0) {
      if      (mon > 2)                          weeklyStatus = 'Risiko meningkat — monotony tinggi'
      else if (ewmaRatEnd && ewmaRatEnd > 1.5)   weeklyStatus = 'Waspada — spike acute load'
      else if (avgFatigue > 70)                  weeklyStatus = 'Waspada — fatigue rata-rata tinggi'
      else if (hardSessions >= 3)                weeklyStatus = 'Waspada — terlalu banyak hard session'
      else if (weeklyTL > 3000)                  weeklyStatus = 'Load mingguan sangat tinggi'
      else                                        weeklyStatus = 'Minggu relatif aman ✓'

      if      (ewmaRatEnd && ewmaRatEnd > 1.5)   deloadSignal = 'Deload disarankan: EWMA spike'
      else if (mon > 2)                           deloadSignal = 'Deload/variasi disarankan: monotony tinggi'
      else if (avgFatigue > 70)                   deloadSignal = 'Deload disarankan: fatigue rata-rata tinggi'
      else if (hardSessions >= 3)                 deloadSignal = 'Kurangi intensitas: hard sessions terlalu banyak'
    }

    const loadCat = weeklyTL < 1000 ? 'Minggu Ringan'
      : weeklyTL < 2000 ? 'Minggu Sedang'
      : weeklyTL < 3000 ? 'Minggu Tinggi'
      : 'Minggu Sangat Tinggi'

    const sunStr = getSundayOfWeek(monStr)
    return {
      weekLabel: weekLabel(monStr),
      monStr, sunStr, n, weeklyTL: Math.round(weeklyTL),
      avgDailyTL: Math.round(avgDailyTL), totalMin: Math.round(totalMin),
      totalKm: parseFloat(totalKm.toFixed(1)),
      easyPct: parseFloat(easyPct.toFixed(1)),
      avgFatigue: parseFloat(avgFatigue.toFixed(1)),
      hardSessions, sdDailyTL: parseFloat(sdDailyTL.toFixed(1)),
      monotony, monotonyDisplay,
      strain: strain !== null ? Math.round(strain) : null,
      ewmaRatEnd, formEnd: Math.round(formEnd),
      weeklyStatus, deloadSignal, loadCat,
    }
  })
}

// ============================================================
// COMPONENT
// ============================================================
export default function DailyLogPage() {
  const [tab, setTab] = useState<'dashboard' | 'input'>('dashboard')
  const [athleteId, setAthleteId] = useState<string | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [settings, setSettings] = useState<AthleteSettings | null>(null)
  const [tlSettings, setTlSettings] = useState<TLSettings>(DEFAULT_TL_SETTINGS)
  const [lthr, setLthr] = useState(0)
  const [vcr, setVcr] = useState(0)
  const [maxHR, setMaxHR] = useState(0)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [ewsEntries, setEwsEntries] = useState<EwsEntry[]>([])
  const [programSessions, setProgramSessions] = useState<ProgramSession[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tlSettingsForm, setTlSettingsForm] = useState<TLSettings>(DEFAULT_TL_SETTINGS)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canEdit = roles.includes('coach') || roles.includes('admin')

  const FORM_BLANK: LogForm = {
    session_date: todayISO(), session_type: 'EASY RUN (EZ)',
    program_session_id: '',
    duration_min: '', distance_km: '', avg_hr: '', max_hr: '',
    hr_part1: '', hr_part2: '', rpe: '',
    perceived_feel: 'Baik', heat_condition: 'Low',
    sup_whey: false, sup_bcaa: false, sup_creatine: false, notes: '',
  }
  const [form, setForm] = useState<LogForm>(FORM_BLANK)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // ── INIT ──
  useEffect(() => {
    async function init() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: ath } = await supabase.from('athletes').select('id').eq('auth_id', user.id).single()
      if (!ath) return
      setAthleteId(ath.id)

      const { data: roleRows } = await supabase.from('athlete_roles').select('role_id').eq('athlete_id', ath.id)
      const roleIds = (roleRows || []).map((r: any) => r.role_id)
      if (roleIds.length) {
        const { data: rn } = await supabase.from('roles').select('name').in('id', roleIds)
        setRoles((rn || []).map((r: any) => r.name))
      }

      // Settings
      const { data: settingsRow } = await (supabase as any)
        .from('athlete_settings').select('*').eq('athlete_id', ath.id).single()
      if (settingsRow) {
        setSettings(settingsRow)
        const tls: TLSettings = {
          trimp_base:   settingsRow.tl_trimp_base   ?? 1.0,
          rpe_weight:   settingsRow.tl_rpe_weight   ?? 1.05,
          heat_low:     settingsRow.tl_heat_low     ?? 1.0,
          heat_mod:     settingsRow.tl_heat_mod     ?? 1.15,
          heat_high:    settingsRow.tl_heat_high    ?? 1.30,
          pen_whey:     settingsRow.tl_pen_whey     ?? 0.06,
          pen_bcaa:     settingsRow.tl_pen_bcaa     ?? 0.04,
          pen_creatine: settingsRow.tl_pen_creatine ?? 0.03,
        }
        setTlSettings(tls)
        setTlSettingsForm(tls)

        // MaxHR from training age / birth date
        if (settingsRow.birth_date) {
          const age = new Date().getFullYear() - new Date(settingsRow.birth_date).getFullYear()
          setMaxHR(220 - age)
        }
      }

      // TT History for LTHR & VCR
      const { data: tt } = await (supabase as any)
        .from('tt_history').select('distance_km,finish_time_sec,lthr_calculated')
        .eq('athlete_id', ath.id).order('tt_date', { ascending: false }).limit(1).single()
      if (tt) {
        if (tt.lthr_calculated) setLthr(tt.lthr_calculated)
        if (tt.distance_km && tt.finish_time_sec) {
          setVcr((tt.distance_km * 1000) / tt.finish_time_sec)
        }
      }

      await Promise.all([
        loadSessions(ath.id),
        loadEws(ath.id),
        loadProgramSessions(ath.id),
      ])
      setLoading(false)
    }
    init()
  }, [])

  async function loadSessions(athId: string) {
    const { data } = await (supabase as any)
      .from('training_sessions').select('*')
      .eq('athlete_id', athId)
      .order('session_date', { ascending: false })
    setSessions(data || [])
  }

  async function loadEws(athId: string) {
    const { data } = await (supabase as any)
      .from('ews_entries')
      .select('entry_date,resting_hr,hrv,sleep_hours,sleep_quality,muscle_soreness,motivation')
      .eq('athlete_id', athId).order('entry_date', { ascending: true })
    setEwsEntries(data || [])
  }

  async function loadProgramSessions(athId: string) {
    // Load sessions from active race program
    const { data: races } = await (supabase as any)
      .from('races').select('id,status').eq('athlete_id', athId)
    const activeRace = (races || []).find((r: any) => r.status === 'A')
      || (races || []).find((r: any) => r.status !== 'done')
    if (!activeRace) return

    const { data: ps } = await (supabase as any)
      .from('program_sessions').select('id,session_date,program_type,notes')
      .eq('athlete_id', athId).eq('race_id', activeRace.id)
      .order('session_date', { ascending: true })
    setProgramSessions(ps || [])
  }

  // ── EWS score for a given date ──
  function getEWSForDate(dateStr: string): number {
    if (!ewsEntries.length || !settings) return 0
    const entry = ewsEntries.find(e => e.entry_date === dateStr)
    if (!entry) return 0

    const rhr    = entry.resting_hr
    const hrv    = entry.hrv
    const sleep  = entry.sleep_hours
    const qual   = entry.sleep_quality
    const doms   = entry.muscle_soreness
    const energy = entry.motivation

    if (!rhr || !hrv || sleep == null || qual == null || doms == null || energy == null) return 0

    const baselineRHR = settings.resting_hr || 55
    const baselineHRV = settings.hrv_baseline || 60

    const before = ewsEntries.filter(e => e.entry_date < dateStr)
    let effRHR = baselineRHR, effHRV = baselineHRV
    if (before.length >= 21) {
      const last30 = before.slice(-30)
      const rhrVals = last30.map(e => e.resting_hr).filter((v): v is number => v != null)
      const hrvVals = last30.map(e => e.hrv).filter((v): v is number => v != null)
      effRHR = rhrVals.length ? rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length : baselineRHR
      effHRV = hrvVals.length ? hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length : baselineHRV
    } else if (before.length >= 8) {
      const rhrVals = before.map(e => e.resting_hr).filter((v): v is number => v != null)
      const hrvVals = before.map(e => e.hrv).filter((v): v is number => v != null)
      const rollingRHR = rhrVals.length ? rhrVals.reduce((a, b) => a + b, 0) / rhrVals.length : baselineRHR
      const rollingHRV = hrvVals.length ? hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length : baselineHRV
      effRHR = rollingRHR * 0.5 + baselineRHR * 0.5
      effHRV = rollingHRV * 0.5 + baselineHRV * 0.5
    }

    return calcEWSScore(rhr, hrv, sleep, qual, doms, energy, effRHR, effHRV)
  }

  // ── Available program sessions for linking (same calendar week, not yet linked) ──
  function availableProgramSessions(): ProgramSession[] {
    if (!form.session_date) return []
    const mon = getMondayOfWeek(form.session_date)
    const sun = getSundayOfWeek(form.session_date)
    const linkedIds = new Set(
      sessions
        .filter(s => s.program_session_id && s.id !== editingId)
        .map(s => s.program_session_id!)
    )
    return programSessions.filter(ps =>
      ps.session_date >= mon &&
      ps.session_date <= sun &&
      !linkedIds.has(ps.id)
    )
  }

  // ── Live calculation (useEffect pattern, sama seperti EWS) ──
  const [calc, setCalc] = useState<CalcResult | null>(null)

  useEffect(() => {
    // Minimal: durasi wajib untuk apapun. RPE tidak wajib — pace & zone tetap tampil tanpa RPE.
    if (!form.duration_min) { setCalc(null); return }
    const refHRrest = settings?.resting_hr || 55
    const refMaxHR  = maxHR || 180
    const refLthr   = lthr || (refMaxHR * 0.87)
    const ewsScore  = getEWSForDate(form.session_date)
    const sortedAsc = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
    setCalc(calcTrainingLoad(form, tlSettings, refMaxHR, refHRrest, refLthr, ewsScore, vcr, sortedAsc))
  }, [form, settings, maxHR, lthr, vcr, tlSettings, sessions, ewsEntries])

  // ── Auto-fill from linked program session ──
  useEffect(() => {
    if (!form.program_session_id) return
    const ps = programSessions.find(p => p.id === form.program_session_id)
    if (ps) {
      setForm(f => ({ ...f, session_type: ps.program_type }))
    }
  }, [form.program_session_id])

  // ── Save Log ──
  async function saveLog() {
    if (!athleteId) return
    if (!form.session_date || !form.duration_min || !form.rpe) {
      showToast('Tanggal, durasi, dan RPE wajib diisi', false); return
    }
    setSaving(true)
    try {
      const refHRrest = settings?.resting_hr || 55
      const refMaxHR  = maxHR || 180
      const refLthr   = lthr || (refMaxHR * 0.87)
      const ewsScore  = getEWSForDate(form.session_date)
      const sortedAsc = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
      const c = calcTrainingLoad(form, tlSettings, refMaxHR, refHRrest, refLthr, ewsScore, vcr, sortedAsc)

      const payload = {
        athlete_id:            athleteId,
        session_date:          form.session_date,
        session_type:          form.session_type,
        program_session_id:    form.program_session_id || null,
        duration_min:          parseFloat(form.duration_min) || null,
        distance_km:           parseFloat(form.distance_km)  || null,
        avg_hr:                parseFloat(form.avg_hr)       || null,
        max_hr:                parseFloat(form.max_hr)       || null,
        hr_part1:              parseFloat(form.hr_part1)     || null,
        hr_part2:              parseFloat(form.hr_part2)     || null,
        hr_drift_pct:          c.hr_drift_pct || null,
        rpe:                   parseFloat(form.rpe)          || null,
        perceived_feel:        form.perceived_feel || null,
        heat_condition:        form.heat_condition,
        sup_whey:              form.sup_whey,
        sup_bcaa:              form.sup_bcaa,
        sup_creatine:          form.sup_creatine,
        notes:                 form.notes || null,
        pace:                  c.pace || null,
        daily_tl:              Math.round(c.dailyTL),
        atl:                   Math.round(c.atl),
        ctl:                   Math.round(c.ctl),
        tsb:                   Math.round(c.tsb),
        acwr:                  parseFloat(c.acwr.toFixed(3)),
        risk_flag:             c.riskFlag,
        deload_signal:         c.deloadSig,
        next_rec:              c.nextRec,
        efficiency_index:      parseFloat(c.effIdx.toFixed(3)),
        stimulus:              c.stimulus,
        eff_tag:               c.effTag,
        rqs:                   parseFloat(c.rqs.toFixed(3)),
        fatigue_score:         parseFloat(c.ewsScore.toFixed(1)),
        readiness:             parseFloat(c.readiness.toFixed(1)),
        hr_zone:               c.hrZone,
        hr_intensity_pct:      parseFloat(c.hrIntPct.toFixed(1)),
        pace_zone_name:        c.paceZoneName,
        srpe_load:             parseFloat(c.srpeLoad.toFixed(2)),
        hr_load:               parseFloat(c.hrLoad.toFixed(2)),
        base_load:             parseFloat(c.baseLoad.toFixed(2)),
        fatigue_mult:          parseFloat(c.fatigueMult.toFixed(3)),
        drift_penalty:         parseFloat(c.driftPenalty.toFixed(3)),
        maxhr_penalty:         parseFloat(c.maxHRPenalty.toFixed(3)),
        plan_duration:         null,
        plan_rpe:              null,
        plan_load:             null,
        plan_vs_actual:        c.planVsActual,
        load_deviation_pct:    parseFloat(c.loadDevPct.toFixed(1)),
        recovery_need:         c.recoveryNeed,
        session_quality:       c.sessionQuality,
        three_day_risk:        c.threeDayLabel,
        z_score:               parseFloat(c.zScore.toFixed(3)),
        personal_load_status:  c.personalLoad,
      }

      if (editingId) {
        await (supabase as any).from('training_sessions').update(payload).eq('id', editingId)
        showToast('Log diperbarui')
      } else {
        await (supabase as any).from('training_sessions').insert(payload)
        showToast('Log berhasil disimpan')
      }

      setForm(FORM_BLANK)
      setEditingId(null)
      await loadSessions(athleteId)
    } catch (e: any) {
      showToast('Gagal: ' + e.message, false)
    } finally {
      setSaving(false)
    }
  }

  async function deleteLog(id: string) {
    if (!confirm('Hapus log latihan ini?')) return
    await (supabase as any).from('training_sessions').delete().eq('id', id)
    showToast('Log dihapus')
    await loadSessions(athleteId!)
  }

  function startEdit(s: TrainingSession) {
    setForm({
      session_date:       s.session_date,
      session_type:       s.session_type,
      program_session_id: s.program_session_id || '',
      duration_min:       s.duration_min?.toString() || '',
      distance_km:        s.distance_km?.toString() || '',
      avg_hr:             s.avg_hr?.toString() || '',
      max_hr:             s.max_hr?.toString() || '',
      hr_part1:           s.hr_part1?.toString() || '',
      hr_part2:           s.hr_part2?.toString() || '',
      rpe:                s.rpe?.toString() || '',
      perceived_feel:     s.perceived_feel || 'Baik',
      heat_condition:     s.heat_condition || 'Low',
      sup_whey:           s.sup_whey || false,
      sup_bcaa:           s.sup_bcaa || false,
      sup_creatine:       s.sup_creatine || false,
      notes:              s.notes || '',
    })
    setEditingId(s.id)
    setTab('input')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveTLSettings() {
    if (!athleteId) return
    await (supabase as any).from('athlete_settings').update({
      tl_trimp_base:   tlSettingsForm.trimp_base,
      tl_rpe_weight:   tlSettingsForm.rpe_weight,
      tl_heat_low:     tlSettingsForm.heat_low,
      tl_heat_mod:     tlSettingsForm.heat_mod,
      tl_heat_high:    tlSettingsForm.heat_high,
      tl_pen_whey:     tlSettingsForm.pen_whey,
      tl_pen_bcaa:     tlSettingsForm.pen_bcaa,
      tl_pen_creatine: tlSettingsForm.pen_creatine,
    }).eq('athlete_id', athleteId)
    setTlSettings(tlSettingsForm)
    setShowSettings(false)
    showToast('Parameter Training Load disimpan')
  }

  // ── Computed dashboard data ──
  const sortedAsc = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
  const latestSession = sessions[0] || null
  const currentCTL  = latestSession?.ctl  || 0
  const currentATL  = latestSession?.atl  || 0
  const currentTSB  = latestSession?.tsb  || 0
  const currentACWR = latestSession?.acwr || 0

  const today = todayISO()
  const monThisWeek = getMondayOfWeek(today)
  const sunThisWeek = getSundayOfWeek(today)
  const thisWeekSessions = sessions.filter(s =>
    s.session_date >= monThisWeek && s.session_date <= sunThisWeek)
  const thisWeekPlanned = programSessions.filter(ps =>
    ps.session_date >= monThisWeek && ps.session_date <= sunThisWeek)
  const thisWeekMissed = thisWeekPlanned.filter(ps =>
    !sessions.some(s => s.program_session_id === ps.id) && ps.session_date < today).length

  const weeklyData = calcWeeklySummary(sortedAsc).slice(-8)
  const chartData = weeklyData.map(w => ({
    week: w.weekLabel.split('–')[0].trim(),
    weeklyTL: w.weeklyTL,
    acwr: w.ewmaRatEnd ? parseFloat(w.ewmaRatEnd.toFixed(2)) : null,
    strain: w.strain,
    monotony: w.monotony !== null && isFinite(w.monotony) ? parseFloat((w.monotony as number).toFixed(2)) : null,
  }))

  // Deload alert
  const deloadActive = latestSession?.deload_signal === 'YES'
  const acwrDanger  = currentACWR > 1.3

  // Pagination
  const totalPages = Math.ceil(sessions.length / PAGE_SIZE)
  const pagedSessions = sessions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Linked program session info
  const linkedPS = form.program_session_id
    ? programSessions.find(p => p.id === form.program_session_id)
    : null

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Memuat...</div>
  )

  // ── RISK COLORS ──
  const riskColor = (flag: string | null) =>
    flag === 'HIGH' ? 'text-red-600 bg-red-50' : flag === 'Medium' ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50'
  const acwrColor = (v: number) =>
    v > 1.3 ? 'text-red-600' : v > 1.0 ? 'text-amber-500' : v >= 0.8 ? 'text-green-600' : 'text-blue-500'
  const tsbColor = (v: number) =>
    v > 10 ? 'text-green-600' : v < -20 ? 'text-red-600' : 'text-gray-700'

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.ok ? 'bg-gray-800' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-gsans text-xl text-indigo-700 uppercase tracking-wide">Log Latihan Harian</h1>
            <p className="text-xs text-gray-400 mt-0.5">Realisasi sesi + Training Load monitoring</p>
          </div>
          <div className="flex gap-2">
            {canEdit && (
              <button onClick={() => setShowSettings(true)}
                className="border border-gray-200 text-gray-500 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50">
                ⚙️ Parameter TL
              </button>
            )}
            <button onClick={() => { setTab('input'); setForm(FORM_BLANK); setEditingId(null) }}
              className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700">
              + Input Log
            </button>
          </div>
        </div>
      </div>

      {/* Tabs — pola EWS */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['dashboard', 'input'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'dashboard' ? '📊 Dashboard & Tren' : '✏️ Input & Riwayat'}
          </button>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TAB 1: DASHBOARD */}
      {/* ================================================================ */}
      {tab === 'dashboard' && (
        <div className="space-y-6">

          {/* Alert Banner */}
          {(deloadActive || acwrDanger || thisWeekMissed > 1) && (
            <div className="space-y-2">
              {deloadActive && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
                  <span className="text-lg">🔴</span>
                  <span className="text-red-700 font-medium">Deload Signal Aktif — Kurangi volume & intensitas. Prioritaskan Easy/Recovery.</span>
                </div>
              )}
              {acwrDanger && !deloadActive && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
                  <span className="text-lg">🟠</span>
                  <span className="text-amber-700 font-medium">ACWR {currentACWR.toFixed(2)} — Acute load spike. Monitor intensitas dan recovery.</span>
                </div>
              )}
              {thisWeekMissed > 1 && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm">
                  <span className="text-lg">⚠️</span>
                  <span className="text-orange-700 font-medium">{thisWeekMissed} sesi program pekan ini belum terlaksana.</span>
                </div>
              )}
            </div>
          )}

          {/* Snapshot CTL/ATL/TSB/ACWR */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Snapshot Terkini</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'CTL', sub: 'Chronic Load (Fitness)', val: currentCTL, color: 'text-indigo-600' },
                { label: 'ATL', sub: 'Acute Load (Fatigue)',   val: currentATL, color: 'text-orange-500' },
                { label: 'TSB', sub: 'Form (Freshness)',       val: currentTSB, color: tsbColor(currentTSB) },
                { label: 'ACWR', sub: 'Acute:Chronic Ratio',   val: currentACWR ? currentACWR.toFixed(2) : '—', color: acwrColor(currentACWR) },
              ].map(item => (
                <div key={item.label} className="bg-gray-50 rounded-xl p-4 text-center">
                  <div className={`text-2xl font-bold ${item.color}`}>{item.val}</div>
                  <div className="text-xs font-bold text-gray-700 mt-1">{item.label}</div>
                  <div className="text-[10px] text-gray-400">{item.sub}</div>
                </div>
              ))}
            </div>
            {!latestSession && (
              <div className="text-center py-6 text-gray-400 text-sm mt-4">Belum ada data log. Mulai input di tab Input & Riwayat.</div>
            )}
          </div>

          {/* Ringkasan Pekan Ini */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
              Ringkasan Pekan Ini
              <span className="ml-2 text-xs font-normal text-gray-400 normal-case">{weekLabel(today)}</span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                {
                  label: 'Sesi Terlaksana',
                  val: `${thisWeekSessions.length} / ${thisWeekPlanned.length || '—'}`,
                  color: 'text-indigo-600',
                },
                {
                  label: 'Total Jarak',
                  val: `${thisWeekSessions.reduce((s, x) => s + (x.distance_km || 0), 0).toFixed(1)} km`,
                  color: 'text-gray-800',
                },
                {
                  label: 'Total Durasi',
                  val: `${Math.round(thisWeekSessions.reduce((s, x) => s + (x.duration_min || 0), 0))} mnt`,
                  color: 'text-gray-800',
                },
                {
                  label: 'Avg RPE',
                  val: thisWeekSessions.length
                    ? (thisWeekSessions.reduce((s, x) => s + (x.rpe || 0), 0) / thisWeekSessions.length).toFixed(1)
                    : '—',
                  color: 'text-gray-800',
                },
                {
                  label: 'Sesi Missed',
                  val: thisWeekMissed > 0 ? thisWeekMissed : '0',
                  color: thisWeekMissed > 0 ? 'text-red-500' : 'text-green-600',
                },
              ].map(item => (
                <div key={item.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <div className={`text-xl font-bold ${item.color}`}>{item.val}</div>
                  <div className="text-[10px] font-medium text-gray-400 uppercase mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Charts */}
          {chartData.length > 0 ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {/* Chart 1: Weekly TL + ACWR */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Weekly TL & ACWR</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="tl" orientation="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="acwr" orientation="right" domain={[0, 2.5]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="tl" dataKey="weeklyTL" name="Weekly TL" fill="#6366f1" radius={[4,4,0,0]} opacity={0.8} />
                    <Line yAxisId="acwr" type="monotone" dataKey="acwr" name="ACWR" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                    <ReferenceLine yAxisId="acwr" y={1.3} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '1.3', fontSize: 9, fill: '#dc2626' }} />
                    <ReferenceLine yAxisId="acwr" y={0.8} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '0.8', fontSize: 9, fill: '#f59e0b' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Chart 2: Strain + Monotony */}
              <div className="bg-white rounded-xl shadow-sm p-5">
                <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">Strain & Monotony</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="strain" orientation="left" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="monotony" orientation="right" domain={[0, 3.5]} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="strain" dataKey="strain" name="Strain" fill="#fb923c" radius={[4,4,0,0]} opacity={0.8} />
                    <Line yAxisId="monotony" type="monotone" dataKey="monotony" name="Monotony" stroke="#eab308" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                    <ReferenceLine yAxisId="monotony" y={2} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '2.0', fontSize: 9, fill: '#dc2626' }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center text-gray-400 text-sm">
              <div className="text-4xl mb-3">📈</div>
              <div>Chart tersedia setelah minimal 2 minggu data log masuk.</div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB 2: INPUT & RIWAYAT */}
      {/* ================================================================ */}
      {tab === 'input' && (
        <div className="space-y-6">

          {/* Form Input */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
              {editingId ? '✏️ Edit Log Latihan' : '+ Input Log Latihan'}
            </h2>

            <div className="space-y-4">
              {/* Row 1: Identitas */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tanggal *</div>
                  <input type="date" value={form.session_date}
                    onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Tipe Sesi *</div>
                  <select value={form.session_type}
                    onChange={e => setForm(f => ({ ...f, session_type: e.target.value }))}
                    disabled={!!form.program_session_id}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-400">
                    {PROGRAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">
                    Realisasi Sesi Program
                    <span className="ml-1 text-gray-300 font-normal normal-case">(opsional)</span>
                  </div>
                  <select value={form.program_session_id}
                    onChange={e => setForm(f => ({ ...f, program_session_id: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    <option value="">— Tidak ada / Free Run —</option>
                    {availableProgramSessions().map(ps => (
                      <option key={ps.id} value={ps.id}>
                        {fmtDateShort(ps.session_date)} — {ps.program_type}
                      </option>
                    ))}
                  </select>
                  {linkedPS && (
                    <div className="mt-1 text-[10px] text-indigo-500 bg-indigo-50 px-2 py-1 rounded">
                      ✓ Tipe sesi diisi otomatis dari program
                    </div>
                  )}
                  {form.session_date && availableProgramSessions().length === 0 && !form.program_session_id && (
                    <div className="mt-1 text-[10px] text-gray-400">
                      Tidak ada sesi program tersedia untuk pekan ini
                    </div>
                  )}
                </div>
              </div>

              {/* Row 2: Data Aktual */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Durasi *</div>
                  {/* Dua input tersinkron: menit (angka) + jam:menit (HH:MM) */}
                  <div className="flex gap-1">
                    <input
                      type="number" min="0" value={form.duration_min} placeholder="menit"
                      onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))}
                      className="w-1/2 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <input
                      type="text" placeholder="j:mm"
                      value={form.duration_min
                        ? (() => {
                            const tot = Math.round(parseFloat(form.duration_min) || 0)
                            const h = Math.floor(tot / 60)
                            const m = tot % 60
                            return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m > 0 ? `0:${String(m).padStart(2, '0')}` : ''
                          })()
                        : ''
                      }
                      onChange={e => {
                        const val = e.target.value.trim()
                        // Terima format J:MM atau JJ:MM
                        const match = val.match(/^(\d+):(\d{0,2})$/)
                        if (match) {
                          const totalMin = parseInt(match[1]) * 60 + (parseInt(match[2]) || 0)
                          setForm(f => ({ ...f, duration_min: totalMin > 0 ? String(totalMin) : '' }))
                        } else if (val === '' || val === '0:' || val === '0') {
                          setForm(f => ({ ...f, duration_min: '' }))
                        }
                      }}
                      className="w-1/2 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">menit · atau j:mm (mis. 1:45)</p>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Jarak (km)</div>
                  <input type="number" step="0.01" value={form.distance_km} placeholder="10.0"
                    onChange={e => setForm(f => ({ ...f, distance_km: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Avg Pace</div>
                  <div className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-indigo-600 font-bold">
                    {calc?.pace ? `${calc.pace}/km` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Pace Zone</div>
                  <div className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600 font-medium">
                    {calc?.paceZoneName || '—'}
                  </div>
                </div>
              </div>

              {/* Row 3: HR Data */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Avg (bpm)</div>
                  <input type="number" value={form.avg_hr} placeholder="145"
                    onChange={e => setForm(f => ({ ...f, avg_hr: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Max (bpm)</div>
                  <input type="number" value={form.max_hr} placeholder="165"
                    onChange={e => setForm(f => ({ ...f, max_hr: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Paruh 1 (bpm)</div>
                  <input type="number" value={form.hr_part1} placeholder="140"
                    onChange={e => setForm(f => ({ ...f, hr_part1: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Paruh 2 (bpm)</div>
                  <input type="number" value={form.hr_part2} placeholder="152"
                    onChange={e => setForm(f => ({ ...f, hr_part2: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">HR Drift</div>
                  <div className="w-full border border-gray-100 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-600 font-medium">
                    {calc && calc.hr_drift_pct !== 0
                      ? `${calc.hr_drift_pct > 0 ? '+' : ''}${calc.hr_drift_pct.toFixed(1)}%`
                      : '—'}
                  </div>
                </div>
              </div>

              {/* Row 4: Subjektif */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">RPE (1–10) *</div>
                  <input type="number" min="1" max="10" value={form.rpe} placeholder="6"
                    onChange={e => setForm(f => ({ ...f, rpe: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Perceived Feel</div>
                  <select value={form.perceived_feel}
                    onChange={e => setForm(f => ({ ...f, perceived_feel: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {PERCEIVED_FEELS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">Heat Condition</div>
                  <select value={form.heat_condition}
                    onChange={e => setForm(f => ({ ...f, heat_condition: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {HEAT_CONDITIONS.map(h => <option key={h} value={h}>{h === 'Low' ? 'Low (Normal)' : h === 'Mod' ? 'Moderate (Panas)' : 'High (Sangat Panas)'}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase mb-1">EWS Fatigue Pull</div>
                  <div className={`w-full border rounded-lg px-3 py-2 text-sm font-bold ${calc ? (calc.ewsScore > 45 ? 'bg-red-50 text-red-600 border-red-200' : calc.ewsScore > 30 ? 'bg-amber-50 text-amber-600 border-amber-200' : calc.ewsScore > 15 ? 'bg-green-50 text-green-600 border-green-200' : 'bg-indigo-50 text-indigo-600 border-indigo-200') : 'border-gray-100 bg-gray-50 text-gray-400'}`}>
                    {calc ? `${calc.ewsScore.toFixed(1)} — ${calc.ewsScore > 45 ? 'Kelelahan Tinggi' : calc.ewsScore > 30 ? 'Waspada' : calc.ewsScore > 15 ? 'Kondisi Baik' : 'Sangat Prima'}` : '—'}
                  </div>
                </div>
              </div>

              {/* Row 5: Suplemen */}
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-2">Suplemen (RQS)</div>
                <div className="flex gap-4">
                  {[
                    { key: 'sup_whey', label: 'Whey Protein' },
                    { key: 'sup_bcaa', label: 'BCAA' },
                    { key: 'sup_creatine', label: 'Creatine' },
                  ].map(s => (
                    <label key={s.key} className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
                      <input type="checkbox" checked={(form as any)[s.key]}
                        onChange={e => setForm(f => ({ ...f, [s.key]: e.target.checked }))}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-300" />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Row 6: Catatan */}
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase mb-1">Catatan</div>
                <textarea value={form.notes} rows={2}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Rute, kondisi sepatu, catatan coaching, hal-hal spesifik sesi ini..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
              </div>

              {/* Live Output — selalu tampil */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-gray-500 uppercase">Output Kalkulasi</div>
                  <button onClick={() => setShowDetail(d => !d)}
                    className="text-xs text-indigo-500 hover:underline">
                    {showDetail ? '▲ Sembunyikan detail' : '▼ Detail lengkap (28 metrik)'}
                  </button>
                </div>

                {/* 4 Panel Utama — selalu tampil */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {/* Panel A: Load */}
                  <div className="bg-indigo-50 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-indigo-700 uppercase mb-2">⚡ Load</div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Daily TL</span>
                      <span className="text-lg font-bold text-indigo-700">{calc ? Math.round(calc.dailyTL) : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Kategori</span>
                      {calc ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${calc.dailyCat === 'Severe' ? 'bg-red-100 text-red-600' : calc.dailyCat === 'Hard' ? 'bg-orange-100 text-orange-600' : calc.dailyCat === 'Moderate' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>{calc.dailyCat}</span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Plan vs Actual</span>
                      <span className="text-xs font-bold text-gray-700">{calc ? calc.planVsActual : '—'}</span>
                    </div>
                  </div>

                  {/* Panel B: Physiology */}
                  <div className="bg-green-50 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-green-700 uppercase mb-2">💓 Physiology</div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">HR Zone</span>
                      <span className="text-sm font-bold text-gray-800">{calc ? `Z${calc.hrZone} (${calc.hrIntPct.toFixed(0)}% LTHR)` : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Pace Zone</span>
                      <span className="text-xs font-bold text-gray-700">{calc ? calc.paceZoneName : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Stimulus</span>
                      <span className="text-xs font-medium text-gray-600">{calc ? calc.stimulus : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Eff. Tag</span>
                      <span className={`text-xs font-bold ${calc?.effTag === 'Highly Efficient' ? 'text-green-600' : calc?.effTag === 'Cardiac Drift' ? 'text-amber-600' : calc?.effTag === 'Heat/Fatigue Affected' ? 'text-red-500' : 'text-gray-600'}`}>{calc ? calc.effTag : '—'}</span>
                    </div>
                  </div>

                  {/* Panel C: Risk */}
                  <div className="bg-red-50 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-red-700 uppercase mb-2">⚠️ Risk</div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Risk Flag</span>
                      {calc ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${riskColor(calc.riskFlag)}`}>{calc.riskFlag}</span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Deload Signal</span>
                      <span className={`text-xs font-bold ${calc?.deloadSig === 'YES' ? 'text-red-600' : calc?.deloadSig === 'NO' ? 'text-green-600' : 'text-gray-300'}`}>{calc ? calc.deloadSig : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">3-Day Risk</span>
                      <span className="text-xs font-medium text-gray-600">{calc ? calc.threeDayLabel : '—'}</span>
                    </div>
                  </div>

                  {/* Panel D: Recovery */}
                  <div className="bg-amber-50 rounded-xl p-4 space-y-2">
                    <div className="text-xs font-bold text-amber-700 uppercase mb-2">🔄 Recovery</div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Recovery Need</span>
                      <span className="text-xs font-bold text-gray-800">{calc ? calc.recoveryNeed : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">RQS</span>
                      <span className="text-xs font-bold text-gray-700">{calc ? calc.rqs.toFixed(2) : '—'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Next Rec.</span>
                      <span className="text-xs font-medium text-indigo-600">{calc ? calc.nextRec : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Detail 28 Metrik */}
                {showDetail && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <div className="text-xs font-bold text-gray-600 uppercase mb-3">Detail Lengkap — 28 Metrik</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
                      {[
                        { label: 'HR Intensity',  val: calc ? `${calc.hrIntPct.toFixed(1)}%` : '—' },
                        { label: 'HR Zone',        val: calc ? `Z${calc.hrZone}` : '—' },
                        { label: 'sRPE Load',      val: calc ? calc.srpeLoad.toFixed(1) : '—' },
                        { label: 'HR Load',        val: calc ? calc.hrLoad.toFixed(1) : '—' },
                        { label: 'Base Load',      val: calc ? calc.baseLoad.toFixed(1) : '—' },
                        { label: 'Fatigue Mult',   val: calc ? `×${calc.fatigueMult.toFixed(2)}` : '—' },
                        { label: 'Drift Penalty',  val: calc ? `×${calc.driftPenalty.toFixed(2)}` : '—' },
                        { label: 'MaxHR Penalty',  val: calc ? `×${calc.maxHRPenalty.toFixed(2)}` : '—' },
                        { label: 'Daily TL',       val: calc ? Math.round(calc.dailyTL) : '—' },
                        { label: 'Category',       val: calc ? calc.dailyCat : '—' },
                        { label: 'Daily Status',   val: calc ? calc.planVsActual : '—' },
                        { label: 'Readiness',      val: calc ? `${calc.readiness.toFixed(1)}` : '—' },
                        { label: 'Load Dev %',     val: calc ? `${calc.loadDevPct.toFixed(1)}%` : '—' },
                        { label: 'Rec Need',       val: calc ? calc.recoveryNeed : '—' },
                        { label: 'Sess Quality',   val: calc ? calc.sessionQuality : '—' },
                        { label: 'Eff. Index',     val: calc ? calc.effIdx.toFixed(3) : '—' },
                        { label: 'Session Type',   val: calc ? calc.stimulus : '—' },
                        { label: 'Eff. Tag',       val: calc ? calc.effTag : '—' },
                        { label: 'Risk Flag',      val: calc ? calc.riskFlag : '—' },
                        { label: '3-Day Risk',     val: calc ? calc.threeDayLabel : '—' },
                        { label: 'Next Rec',       val: calc ? calc.nextRec : '—' },
                        { label: 'ATL (EWMA7)',    val: calc ? Math.round(calc.atl) : '—' },
                        { label: 'CTL (EWMA28)',   val: calc ? Math.round(calc.ctl) : '—' },
                        { label: 'ACWR Ratio',     val: calc ? calc.acwr.toFixed(2) : '—' },
                        { label: 'Form (TSB)',     val: calc ? Math.round(calc.tsb) : '—' },
                        { label: 'Z-Score',        val: calc ? calc.zScore.toFixed(2) : '—' },
                        { label: 'Pers. Load',     val: calc ? calc.personalLoad : '—' },
                        { label: 'Deload Sig',     val: calc ? calc.deloadSig : '—' },
                      ].map(item => (
                        <div key={item.label} className="bg-white rounded-lg p-2 border border-gray-100">
                          <div className="text-[9px] font-bold text-gray-400 uppercase mb-0.5">{item.label}</div>
                          <div className="text-xs font-bold text-gray-700 truncate">{item.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button onClick={saveLog} disabled={saving || !canEdit}
                  className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
                  {saving ? 'Menyimpan...' : editingId ? '✓ Update Log' : '✓ Simpan Log'}
                </button>
                {editingId && (
                  <button onClick={() => { setEditingId(null); setForm(FORM_BLANK) }}
                    className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
                    Batal
                  </button>
                )}
                {!canEdit && (
                  <span className="text-xs text-gray-400 self-center">Athlete hanya bisa melihat — edit oleh coach/admin</span>
                )}
              </div>
            </div>
          </div>

          {/* Riwayat Log */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="font-gsans text-xl text-indigo-700 uppercase border-b border-indigo-100 pb-2 mb-4">
              Riwayat Log
              <span className="ml-2 text-xs font-normal text-gray-400 normal-case">{sessions.length} sesi tersimpan</span>
            </h2>

            {sessions.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <div className="text-4xl mb-3">📋</div>
                <div>Belum ada log latihan. Mulai input di atas.</div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Tanggal', 'Tipe Sesi', 'Jarak', 'Durasi', 'Pace', 'HR Avg', 'RPE', 'Daily TL', 'Kategori', 'Link', 'Aksi'].map(h => (
                          <th key={h} className="text-left py-2 px-2 font-medium text-gray-400 uppercase text-[10px] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSessions.map(s => {
                        const linkedProgram = s.program_session_id
                          ? programSessions.find(p => p.id === s.program_session_id)
                          : null
                        return (
                          <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                            <td className="py-2.5 px-2 whitespace-nowrap font-medium text-gray-800">{fmtDateShort(s.session_date)}</td>
                            <td className="py-2.5 px-2 max-w-[140px]">
                              <span className="truncate block text-gray-700">{s.session_type}</span>
                            </td>
                            <td className="py-2.5 px-2 text-gray-700">{s.distance_km ? `${s.distance_km.toFixed(1)} km` : '—'}</td>
                            <td className="py-2.5 px-2 text-gray-700">{s.duration_min ? `${s.duration_min} mnt` : '—'}</td>
                            <td className="py-2.5 px-2 font-mono text-gray-700">{s.pace ? `${s.pace}/km` : '—'}</td>
                            <td className="py-2.5 px-2 text-gray-700">{s.avg_hr ? `${s.avg_hr} bpm` : '—'}</td>
                            <td className="py-2.5 px-2 text-gray-700">{s.rpe ?? '—'}</td>
                            <td className="py-2.5 px-2 font-bold text-indigo-600">{s.daily_tl ? Math.round(s.daily_tl) : '—'}</td>
                            <td className="py-2.5 px-2">
                              {s.daily_tl ? (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  s.daily_tl > 600 ? 'bg-red-100 text-red-600'
                                  : s.daily_tl > 400 ? 'bg-orange-100 text-orange-600'
                                  : s.daily_tl > 200 ? 'bg-yellow-100 text-yellow-600'
                                  : 'bg-green-100 text-green-600'
                                }`}>
                                  {s.daily_tl > 600 ? 'Severe' : s.daily_tl > 400 ? 'Hard' : s.daily_tl > 200 ? 'Moderate' : 'Light'}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="py-2.5 px-2">
                              {linkedProgram ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-600">
                                  ✓ Linked
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
                                  Free
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="flex gap-1">
                                {canEdit && (
                                  <>
                                    <button onClick={() => startEdit(s)}
                                      className="border border-indigo-500 text-indigo-600 text-[10px] px-2 py-0.5 rounded-lg hover:bg-indigo-50">
                                      Edit
                                    </button>
                                    <button onClick={() => deleteLog(s.id)}
                                      className="border border-red-200 text-red-500 text-[10px] px-2 py-0.5 rounded-lg hover:bg-red-50">
                                      Hapus
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                    <div className="text-xs text-gray-400">
                      Halaman {page} dari {totalPages} ({sessions.length} total)
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-30">← Prev</button>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="border border-gray-200 text-gray-600 text-xs px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-30">Next →</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* MODAL: TL Settings */}
      {/* ================================================================ */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-gsans text-lg text-indigo-700">⚙️ Parameter Training Load</h3>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-3">TRIMP & sRPE</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'trimp_base', label: 'TRIMP Base Multiplier', default: '1.0' },
                    { key: 'rpe_weight', label: 'RPE Weight', default: '1.05' },
                  ].map(f => (
                    <div key={f.key}>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">{f.label}</div>
                      <input type="number" step="0.01"
                        value={(tlSettingsForm as any)[f.key]}
                        onChange={e => setTlSettingsForm(s => ({ ...s, [f.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-3">Heat Factor</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: 'heat_low', label: 'Heat Low' },
                    { key: 'heat_mod', label: 'Heat Mod' },
                    { key: 'heat_high', label: 'Heat High' },
                  ].map(f => (
                    <div key={f.key}>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">{f.label}</div>
                      <input type="number" step="0.01"
                        value={(tlSettingsForm as any)[f.key]}
                        onChange={e => setTlSettingsForm(s => ({ ...s, [f.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase mb-3">RQS Penalties (Suplemen)</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { key: 'pen_whey', label: 'Whey Protein' },
                    { key: 'pen_bcaa', label: 'BCAA' },
                    { key: 'pen_creatine', label: 'Creatine' },
                  ].map(f => (
                    <div key={f.key}>
                      <div className="text-xs font-medium text-gray-500 uppercase mb-1">{f.label}</div>
                      <input type="number" step="0.01"
                        value={(tlSettingsForm as any)[f.key]}
                        onChange={e => setTlSettingsForm(s => ({ ...s, [f.key]: parseFloat(e.target.value) || 0 }))}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-2 justify-end">
              <button onClick={() => { setTlSettingsForm(tlSettings); setShowSettings(false) }}
                className="border border-gray-300 text-gray-600 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">Batal</button>
              <button onClick={saveTLSettings}
                className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700">Simpan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
