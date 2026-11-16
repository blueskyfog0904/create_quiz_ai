// 한국 시간(UTC+9, 서머타임 없음) 기준의 "오늘"과 "이번 달" 시작 시각을 UTC ISO 문자열로 돌려준다.
// 서버 시간대와 무관하게 같은 결과가 나오도록 직접 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

export function getKstPeriodStarts(now: Date = new Date()) {
  const kst = new Date(now.getTime() + KST_OFFSET_MS)
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth()
  const day = kst.getUTCDate()

  return {
    todayStart: new Date(Date.UTC(year, month, day) - KST_OFFSET_MS).toISOString(),
    monthStart: new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS).toISOString(),
    // 화면 표기용: 한국 시간 기준 연·월
    year,
    month: month + 1,
  }
}

// 한국 날짜('YYYY-MM-DD')가 시작하는 시각을 UTC ISO 문자열로 돌려준다. addDays=1이면 다음 날 시작(기간 끝의 경계).
// 형식이 틀리거나 없는 날짜면 null.
export function getKstDateStart(date: string | null | undefined, addDays = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '')
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const utcMidnight = new Date(Date.UTC(year, month - 1, day))
  if (utcMidnight.getUTCFullYear() !== year || utcMidnight.getUTCMonth() !== month - 1 || utcMidnight.getUTCDate() !== day) return null
  return new Date(utcMidnight.getTime() + addDays * 24 * 60 * 60 * 1000 - KST_OFFSET_MS).toISOString()
}
