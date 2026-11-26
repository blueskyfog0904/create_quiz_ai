// 11번 묶음 10-1: localhost 에서 2판(접는 동의) 화면을 그려 보는 개발 전용 스위치. 환경 변수 이름은 이 파일에만 둔다.
// 켜는 법: 터미널에서 `CHECKOUT_CONSENT_PREVIEW=2 npm run dev`(.env 는 고치지 않는다).
// 개발 모드이고 Vercel 이 아니며 값이 정확히 '2' 일 때만 참이다. 참이면
//   1. 자료·충전 정책을 읽는 함수가 화면용 값을 2판으로 그린다(스크립트 A 로 저장된 2판 키 사용).
//   2. 두 동의 기록 감싸개가 RPC 를 부르기 전에 'unavailable' 을 돌려줘 결제가 늘 닫힌다.
// 이 함수를 부르는 곳은 위 두 종류뿐이다(계약 시험이 고정). 결제·충전 route, 미들웨어, 화면 껍데기에는 넣지 않는다.
export function isCheckoutConsentPreview(): boolean {
  return process.env.NODE_ENV === 'development'
    && !process.env.VERCEL
    && process.env.CHECKOUT_CONSENT_PREVIEW === '2'
}

// 10-1 미리보기 키 파일(스크립트 A 전에도 2판 화면을 그려 보려고). 스위치와 같은 조건일 때만 읽는다.
// 켜는 법: `CHECKOUT_CONSENT_PREVIEW=2 CHECKOUT_CONSENT_PREVIEW_KEYS_FILE=output/b11-consent-preview-keys.json npm run dev`
// 파일은 스크립트 A 의 초안에서 생성기가 만든다(node supabase/scripts/bundle11_rehearsal/generate.mjs — 손으로 고치지 않음).
// 모양: { "market": { 스크립트 A 가 자료 정책에 넣을 키 }, "point_charge": { 충전 정책에 넣을 키 } }. 화면용 값을 만들 때만 저장된 정책 위에 덮는다.
// 결제·기록 경로는 쓰지 않는다(두 기록 감싸개가 스위치로 RPC 전에 막음). 판·편집 번호 키는 덮지 않는다. 파일이 없거나 깨지면 null(띠에 '2판 키 없음').
export type CheckoutConsentPreviewKeysKind = 'market' | 'point_charge'

const PREVIEW_KEYS_IGNORED = new Set(['consentFormat', 'version', 'refundDays'])

export async function readCheckoutConsentPreviewKeys(kind: CheckoutConsentPreviewKeysKind): Promise<Record<string, unknown> | null> {
  const file = process.env.CHECKOUT_CONSENT_PREVIEW_KEYS_FILE
  if (!isCheckoutConsentPreview() || !file) return null
  try {
    const { readFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const parsed = JSON.parse(await readFile(resolve(process.cwd(), file), 'utf8')) as unknown
    const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)[kind] : null
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return null
    return Object.fromEntries(Object.entries(keys as Record<string, unknown>).filter(([key]) => !PREVIEW_KEYS_IGNORED.has(key)))
  } catch {
    return null
  }
}
