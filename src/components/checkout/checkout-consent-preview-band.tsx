// 11번 10-1: 개발 전용 스위치가 켜졌을 때만 머리글 위(보통 흐름)에 그리는 띠. fixed·sticky 로 만들지 않는다.
// 이 글은 localhost 개발 화면에만 보이므로 DB 문구가 아니다.
export function CheckoutConsentPreviewBand({ preview }: { preview: { keysMissing: boolean } | null }) {
  if (!preview) return null
  return (
    <div role="note" className="bg-amber-100 px-4 py-2 text-center text-sm font-bold text-amber-950">
      개발 미리보기 — 결제되지 않음{preview.keysMissing ? ' · 2판 키 없음' : ''}
    </div>
  )
}
