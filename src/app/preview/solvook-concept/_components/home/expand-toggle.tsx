import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'

// 목록 아래 펼치기·접기 버튼(22번 17절). 글자는 DB 값이고 '지금 누르면 할 일'을 받는다(collapseMarketHomeItems 의 toggleLabel).
export function ExpandToggle({
  label,
  expanded,
  controls,
  onToggle,
}: {
  label: string
  expanded: boolean
  // 펼쳐지는 목록의 id
  controls: string
  onToggle: () => void
}) {
  return (
    <div className="border-t border-[var(--studio-border)]">
      <Button
        type="button"
        variant="brandGhost"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
        className="w-full rounded-none font-bold"
      >
        {label}
        <ChevronDown aria-hidden="true" className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </Button>
    </div>
  )
}
