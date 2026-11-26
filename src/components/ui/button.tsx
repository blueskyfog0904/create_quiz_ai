import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
        // 관리자 화면의 보조 동작 버튼(추가·보기·수정·이동 등): 관리자 강조색(주황)으로 눈에 띄게. 취소·되돌리기·삭제는 outline 그대로.
        adminAction:
          "border border-orange-200 bg-orange-50 text-orange-700 shadow-xs hover:border-orange-300 hover:bg-orange-100 hover:text-orange-800 focus-visible:ring-orange-300/50",
        brand:
          "min-h-11 min-w-11 bg-[var(--studio-primary)] text-white hover:bg-[var(--studio-primary-hover)] focus-visible:ring-[var(--studio-focus-ring)]",
        brandOutline:
          "min-h-11 min-w-11 border border-[var(--studio-control-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] hover:border-[var(--studio-primary)] hover:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]",
        brandGhost:
          "min-h-11 min-w-11 text-[var(--studio-text)] hover:bg-[var(--studio-primary-soft)] hover:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]",
        // 관리자 표 안 버튼(20번): 보라 테두리. md 이상은 행 밀도에 맞춰 32px, 그 아래는 누르기 크기 44px.
        adminTable:
          "min-h-11 min-w-11 md:h-8 md:min-h-0 md:min-w-0 border border-[var(--studio-primary-border)] bg-[var(--studio-surface)] text-[var(--studio-primary)] hover:bg-[var(--studio-primary-soft)] focus-visible:ring-[var(--studio-focus-ring)]",
        // 관리자 위험 확정 버튼(삭제·회수·판매 중지, 20번): 흰 글자 대비 4.5:1 이상인 전용 바탕.
        adminDanger:
          "min-h-11 min-w-11 bg-[var(--admin-tone-danger-solid)] text-white hover:bg-[var(--admin-tone-danger-solid-hover)] focus-visible:ring-[var(--admin-tone-danger-border)]",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
