'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { ADMIN_SUBJECT_QUERY_KEY, resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { AdminSidebarNavigationConfig } from '@/lib/admin-sidebar'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface AdminMenuLabelsContextValue {
  labelsBySubject: Record<WorkspaceSubject, Record<string, string>>
  rememberSavedLabel: (workspaceSubject: WorkspaceSubject, key: string, label: string) => void
}

const AdminMenuLabelsContext = createContext<AdminMenuLabelsContextValue | null>(null)

// 사이드바에서 바꾼 메뉴 이름을 페이지 제목·관련 링크에서도 함께 쓴다
export function AdminMenuLabelsProvider({
  navigationConfigs,
  children,
}: {
  navigationConfigs: Record<WorkspaceSubject, AdminSidebarNavigationConfig>
  children: ReactNode
}) {
  // 저장한 이름을 새로고침 전에도 바로 보여 준다 (빈 값은 기본 이름으로 되돌림)
  const [savedLabels, setSavedLabels] = useState<Partial<Record<WorkspaceSubject, Record<string, string>>>>({})
  const value = useMemo<AdminMenuLabelsContextValue>(() => ({
    labelsBySubject: {
      english: { ...navigationConfigs.english.labels, ...savedLabels.english },
      korean: { ...navigationConfigs.korean.labels, ...savedLabels.korean },
    },
    rememberSavedLabel: (workspaceSubject, key, label) => {
      setSavedLabels((current) => ({
        ...current,
        [workspaceSubject]: { ...current[workspaceSubject], [key]: label },
      }))
    },
  }), [navigationConfigs, savedLabels])

  return <AdminMenuLabelsContext.Provider value={value}>{children}</AdminMenuLabelsContext.Provider>
}

export function useAdminMenuLabels() {
  return useContext(AdminMenuLabelsContext)
}

export function AdminMenuName({ href, fallback }: { href: string; fallback: string }) {
  const searchParams = useSearchParams()
  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get(ADMIN_SUBJECT_QUERY_KEY))
  const labels = useAdminMenuLabels()?.labelsBySubject[workspaceSubject]

  return <>{labels?.[href] || fallback}</>
}
