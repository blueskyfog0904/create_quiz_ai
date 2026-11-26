import type { AdminTone } from '@/lib/admin-status-tone'

// tone → 글자·바탕·테두리 클래스. 값은 studio-tokens.css 의 --admin-tone-* 토큰만 쓴다.
export const ADMIN_TONE_CLASSES: Record<AdminTone, string> = {
  neutral: 'border-[var(--admin-tone-neutral-border)] bg-[var(--admin-tone-neutral-soft)] text-[var(--admin-tone-neutral-text)]',
  info: 'border-[var(--admin-tone-info-border)] bg-[var(--admin-tone-info-soft)] text-[var(--admin-tone-info-text)]',
  success: 'border-[var(--admin-tone-success-border)] bg-[var(--admin-tone-success-soft)] text-[var(--admin-tone-success-text)]',
  warning: 'border-[var(--admin-tone-warning-border)] bg-[var(--admin-tone-warning-soft)] text-[var(--admin-tone-warning-text)]',
  danger: 'border-[var(--admin-tone-danger-border)] bg-[var(--admin-tone-danger-soft)] text-[var(--admin-tone-danger-text)]',
}

// 흰 바탕 위 글자색만(증감 줄 등).
export const ADMIN_TONE_TEXT_CLASSES: Record<AdminTone, string> = {
  neutral: 'text-[var(--admin-tone-neutral-text)]',
  info: 'text-[var(--admin-tone-info-text)]',
  success: 'text-[var(--admin-tone-success-text)]',
  warning: 'text-[var(--admin-tone-warning-text)]',
  danger: 'text-[var(--admin-tone-danger-text)]',
}
