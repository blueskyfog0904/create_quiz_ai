// 한국 시간(UTC+9, 서머타임 없음) 날짜 표시. 서버·브라우저 시간대와 무관하게 같은 글자가 나오게 오프셋으로 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function toKstParts(value: string | Date) {
  const kst = new Date(new Date(value).getTime() + KST_OFFSET_MS)
  return {
    year: kst.getUTCFullYear(),
    month: String(kst.getUTCMonth() + 1).padStart(2, '0'),
    day: String(kst.getUTCDate()).padStart(2, '0'),
    hours: String(kst.getUTCHours()).padStart(2, '0'),
    minutes: String(kst.getUTCMinutes()).padStart(2, '0'),
  }
}

// YYYY.MM.DD (한국 시간)
export function formatKstDate(value: string | Date): string {
  const parts = toKstParts(value)
  return `${parts.year}.${parts.month}.${parts.day}`
}

// YYYY.MM.DD HH:mm (한국 시간)
export function formatKstDateTime(value: string | Date): string {
  const parts = toKstParts(value)
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hours}:${parts.minutes}`
}
