import type { ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'

// 11번 6-2: 장바구니 결제 칸의 아래 묶음(금액 한 줄, 동의, 버튼 줄). sticky 판정에 쓰는 높이를 재는 상자다.
// 원칙 2: 상태에 따라 생기고 사라지는 보이는 줄을 두지 않는다(알림·부족 안내·부분 보유 확인은 위 영역).
// 장바구니 화면과 관리자 미리보기가 같은 부품을 그린다.
export interface CartCheckoutPanelBottomProps {
  // '합계 N · 결제 후 잔액 M' 또는 '· 부족 M'(단위 없음, tabular-nums)
  amountLine: ReactNode
  consent: ReactNode
  buttonRow: ReactNode
  className?: string
  measureRef?: Ref<HTMLDivElement>
}

export function CartCheckoutPanelBottom({ amountLine, consent, buttonRow, className, measureRef }: CartCheckoutPanelBottomProps) {
  return (
    <div ref={measureRef} data-checkout-panel-bottom="" className={cn('space-y-3 border-t border-[var(--studio-border)] pt-3', className)}>
      <p className="text-sm font-bold tabular-nums text-[var(--studio-ink)] max-lg:break-keep lg:whitespace-nowrap">{amountLine}</p>
      <div>{consent}</div>
      <div>{buttonRow}</div>
    </div>
  )
}
