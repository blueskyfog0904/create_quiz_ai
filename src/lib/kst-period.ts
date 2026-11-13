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
