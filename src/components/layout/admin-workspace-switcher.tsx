'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ADMIN_SUBJECT_QUERY_KEY, resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const SUBJECTS: Array<{ value: WorkspaceSubject; label: string }> = [
  { value: 'english', label: '영어' },
  { value: 'korean', label: '국어' },
]

export function AdminWorkspaceSwitcher({ className }: { className?: string }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/admin'
  const searchParams = useSearchParams()
  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get(ADMIN_SUBJECT_QUERY_KEY))

  const handleSelect = (nextSubject: WorkspaceSubject) => {
    if (nextSubject === workspaceSubject) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams.toString())
    nextSearchParams.set(ADMIN_SUBJECT_QUERY_KEY, nextSubject)
    router.push(`${pathname}?${nextSearchParams.toString()}`)
  }

  return (
    <div className={cn('inline-flex items-center rounded-full border border-slate-700 bg-slate-800 p-1', className)}>
      {SUBJECTS.map((subject) => {
        const active = subject.value === workspaceSubject
        return (
          <Button
            key={subject.value}
            type="button"
            variant={active ? 'default' : 'ghost'}
            size="sm"
            className={cn('rounded-full px-4', !active && 'text-slate-300 hover:text-white')}
            onClick={() => handleSelect(subject.value)}
          >
            {subject.label}
          </Button>
        )
      })}
    </div>
  )
}
