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
