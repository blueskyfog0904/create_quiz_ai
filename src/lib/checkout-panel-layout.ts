// 11번 6-2 원칙 3: 장바구니 결제 칸을 sticky 로 붙일지 고른다. 화면(장바구니)과 관리자 미리보기가 같은 함수를 쓴다.
// 아래 묶음(금액 줄·동의·버튼 줄) + 위 영역 최소 높이가 칸 최대 안쪽 높이에 들어가면 sticky, 아니면 보통 흐름.
// sticky 이면서 넘치는 상태는 없다. 판정은 첫 그리기 직후·글꼴 로드 끝·창 크기 바뀜·고지 사본 교체 때만 한다(쓰는 도중에는 하지 않음).

export type CheckoutPanelMode = 'sticky' | 'flow'

// 위 영역(제목·알림 자리·선택 목록 머리)이 sticky 일 때 남겨야 하는 최소 높이(px)
export const CHECKOUT_PANEL_TOP_MIN_HEIGHT = 120

export interface CheckoutPanelMeasure {
  // 아래 묶음 높이(px, 테두리 포함)
  bottomHeight: number
  // 칸 최대 안쪽 높이(px) = 보기 영역 높이 - sticky top - 칸 위아래 여백·테두리
  maxInnerHeight: number
  topMinHeight?: number
}

export function decideCheckoutPanelMode({ bottomHeight, maxInnerHeight, topMinHeight = CHECKOUT_PANEL_TOP_MIN_HEIGHT }: CheckoutPanelMeasure): CheckoutPanelMode {
  if (!Number.isFinite(bottomHeight) || !Number.isFinite(maxInnerHeight) || bottomHeight <= 0 || maxInnerHeight <= 0) return 'flow'
  return bottomHeight + topMinHeight <= maxInnerHeight ? 'sticky' : 'flow'
}

// 관리자 미리보기 기준(6-2 수용 기준): 1366×768 노트북의 보기 영역은 약 640px.
export const LAPTOP_PREVIEW_VIEWPORT = { width: 1366, height: 640 } as const

// 장바구니 결제 칸 sticky 자리(머리글 아래 top)와 칸 위아래 여백·테두리 합(px). 장바구니 화면과 미리보기가 같은 값을 쓴다.
export const CHECKOUT_PANEL_STICKY_TOP = 128
export const CHECKOUT_PANEL_CHROME_HEIGHT = 16 + 2

export function checkoutPanelMaxInnerHeight(viewportHeight: number): number {
  return viewportHeight - CHECKOUT_PANEL_STICKY_TOP - CHECKOUT_PANEL_CHROME_HEIGHT
}

// 장바구니 결제 칸 폭(lg 2단의 오른쪽 열, px)과 안쪽 글 폭(테두리 1px·좌우 여백 20px 를 뺀 값). 장바구니 화면의 열 class
// (cart-page-view.tsx 'lg:grid-cols-[minmax(0,1fr)_400px]')와 관리자 미리보기가 같은 값을 쓴다(계약 시험이 묶음).
export const CHECKOUT_PANEL_WIDTH = 400
export const CHECKOUT_PANEL_CONTENT_WIDTH = CHECKOUT_PANEL_WIDTH - 2 - 40

// 관리자 미리보기용 여유(글꼴 차이 macOS·Windows): 이만큼 더 들어가야 통과로 본다.
export const CHECKOUT_PANEL_PREVIEW_MARGIN = 24
