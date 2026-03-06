import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertCircle, Coins, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface CreditConfirmationDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  requiredAmount: number
  currentBalance: number | null
  isLoading?: boolean
  title?: string
  description?: string
}

export function CreditConfirmationDialog({
  open,
  onClose,
  onConfirm,
  requiredAmount,
  currentBalance,
  isLoading = false,
  title = "크레딧 차감 확인",
  description = "AI 생성 또는 데이터 처리를 위해 크레딧이 사용됩니다."
}: CreditConfirmationDialogProps) {
  
  // Safe calculation even if balance is null (loading/error)
  const balance = currentBalance ?? 0
  const remainingBalance = balance - requiredAmount
  const isInsufficient = remainingBalance < 0

  return (
    <Dialog open={open} onOpenChange={(val) => !val && !isLoading && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-yellow-500" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          <div className="flex flex-col gap-2 bg-slate-50 p-4 rounded-lg border">
            
            {/* Current Balance */}
            <div className="flex justify-between items-center text-sm text-gray-600">
              <span>현재 보유 크레딧</span>
              <span className="font-mono font-medium">
                {currentBalance === null ? (
                    <Loader2 className="w-3 h-3 animate-spin"/>
                ) : (
                    balance.toLocaleString()
                )}
              </span>
            </div>

            {/* Required Amount */}
            <div className="flex justify-between items-center text-sm text-red-600 font-medium">
              <span>차감 예정 크레딧</span>
              <span className="font-mono">- {requiredAmount.toLocaleString()}</span>
            </div>

            <div className="border-t border-dashed my-1" />

            {/* Remaining Balance */}
            <div className="flex justify-between items-center font-bold text-base">
              <span>예상 잔액</span>
              <span className={cn(
                "font-mono", 
                isInsufficient ? "text-red-500" : "text-primary"
              )}>
                 {isInsufficient 
                    ? `부족 (${Math.abs(remainingBalance).toLocaleString()})` 
                    : remainingBalance.toLocaleString()
                 }
              </span>
            </div>
          </div>

          {isInsufficient && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>크레딧이 부족하여 진행할 수 없습니다.</span>
            </div>
          )}
        </div>

        <DialogFooter className="justify-center gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            취소
          </Button>
          <Button 
            onClick={onConfirm} 
            disabled={isLoading || isInsufficient || currentBalance === null}
            className={cn(isInsufficient && "opacity-50 cursor-not-allowed")}
          >
            {isLoading ? (
              <>
                 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                 처리 중...
              </>
            ) : (
               "네, 진행합니다"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
