'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, KeyRound, LogOut, Menu, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { renameAdminSidebarMenuAction } from '@/app/(admin)/admin/menu-management/actions'
import { Button } from '@/components/ui/button'
import { AdminAlertCenter } from '@/components/admin/admin-alert-center'
import { AdminMenuBadge } from '@/components/admin/admin-menu-badge'
import { cn } from '@/lib/utils'
import { resolveAdminWorkspaceSubject, withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  ADMIN_SIDEBAR_LABEL_MAX_LENGTH,
  adminSidebarIconComponents,
  resolveAdminSidebarNavigationNodes,
  type AdminSidebarMenuItem,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
import { useAdminMenuLabels } from './admin-menu-labels'
import { AdminWorkspaceSwitcher } from './admin-workspace-switcher'

interface AdminSidebarClientProps {
  navigationConfigs: Record<'english' | 'korean', AdminSidebarNavigationConfig>
  hiddenHrefs: readonly string[]
}

export function AdminSidebarClient({ navigationConfigs, hiddenHrefs }: AdminSidebarClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  // collapsed: 데스크톱에서 사이드바를 좁게 접었는지. mobileOpen: 모바일에서 서랍을 열었는지(처음엔 닫혀 있다).
  // 예전에는 collapsed 하나로 둘을 같이 표현해서, 데스크톱 기본값(펼침)이 모바일에서는 "서랍이 열린 채 시작"이 됐다.
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [editingMenuKey, setEditingMenuKey] = useState<string | null>(null)
  const [menuLabelDraft, setMenuLabelDraft] = useState('')
  const [isSavingMenuLabel, setIsSavingMenuLabel] = useState(false)
  const menuLabels = useAdminMenuLabels()

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error('로그아웃에 실패했습니다.')
      }
      window.location.href = '/admin/login'
    } catch {
      alert('로그아웃에 실패했습니다.')
      setIsLoggingOut(false)
    }
  }
  // 모바일 서랍이 열려 있는 동안: 뒤 화면 스크롤 잠금, Escape로 닫기, 화면이 넓어지면(데스크톱 폭) 닫기
  useEffect(() => {
    if (!mobileOpen) return
    const close = () => setMobileOpen(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const desktop = window.matchMedia('(min-width: 768px)')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    desktop.addEventListener('change', close)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      desktop.removeEventListener('change', close)
    }
  }, [mobileOpen])

  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
  const resolvedNavigationNodes = useMemo(() => {
    const config = navigationConfigs[workspaceSubject]
    return resolveAdminSidebarNavigationNodes(workspaceSubject, {
      ...config,
      labels: menuLabels?.labelsBySubject[workspaceSubject] ?? config.labels,
    }, hiddenHrefs)
  }, [hiddenHrefs, menuLabels, navigationConfigs, workspaceSubject])

  const startEditingMenuLabel = (key: string, currentName: string) => {
    setEditingMenuKey(key)
    setMenuLabelDraft(currentName)
  }

  const cancelEditingMenuLabel = () => {
    setEditingMenuKey(null)
    setMenuLabelDraft('')
  }

  const saveMenuLabel = async (key: string, defaultName: string) => {
    const nextLabel = menuLabelDraft.trim()
    // 기본 이름과 같거나 비우면 기본 이름으로 되돌린다
    const labelToSave = nextLabel === defaultName ? '' : nextLabel
    setIsSavingMenuLabel(true)
    try {
      const result = await renameAdminSidebarMenuAction(key, labelToSave, workspaceSubject)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      menuLabels?.rememberSavedLabel(workspaceSubject, key, labelToSave)
      cancelEditingMenuLabel()
      router.refresh()
    } catch {
      toast.error('메뉴 이름을 저장하지 못했습니다.')
    } finally {
      setIsSavingMenuLabel(false)
    }
  }

  const renderMenuLabelEditor = (key: string, defaultName: string) => (
    <form
      key={key}
      className="space-y-1 rounded-lg bg-slate-800 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        void saveMenuLabel(key, defaultName)
      }}
    >
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={menuLabelDraft}
          onChange={(event) => setMenuLabelDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelEditingMenuLabel()
            }
          }}
          maxLength={ADMIN_SIDEBAR_LABEL_MAX_LENGTH}
          placeholder={defaultName}
          aria-label="메뉴 이름"
          disabled={isSavingMenuLabel}
          className="min-w-0 flex-1 rounded-md bg-slate-900 px-2 py-1.5 text-sm text-white outline-none ring-1 ring-slate-600 focus:ring-orange-500"
        />
        <button
          type="submit"
          aria-label="이름 저장"
          disabled={isSavingMenuLabel}
          className="rounded-md p-1.5 text-emerald-300 hover:bg-slate-700 hover:text-emerald-200 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="이름 변경 취소"
          onClick={cancelEditingMenuLabel}
          disabled={isSavingMenuLabel}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="px-1 text-[11px] text-slate-500">비우고 저장하면 기본 이름으로 돌아갑니다.</p>
    </form>
  )

  // 글자 자리를 따로 비우지 않고(긴 메뉴 이름 줄바꿈 방지) 마우스를 올렸을 때 오른쪽 끝에 겹쳐 보인다
  const renderMenuLabelEditButton = (key: string, currentName: string, active = false, surface: 'link' | 'heading' = 'link') => (
    <button
      type="button"
      aria-label={`${currentName} 이름 바꾸기`}
      title="이름 바꾸기"
      onClick={() => startEditingMenuLabel(key, currentName)}
      className={cn(
        'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/menu:opacity-100 [@media(hover:none)]:opacity-100',
        active
          ? 'bg-orange-600 text-orange-100 hover:bg-orange-700 hover:text-white'
          : cn(surface === 'link' ? 'bg-slate-800' : 'bg-slate-900', 'text-slate-400 hover:bg-slate-700 hover:text-white')
      )}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  )

  const isActive = (item: AdminSidebarMenuItem) => {
    if (item.exact) {
      return pathname === item.href
    }
    return pathname.startsWith(item.href)
  }

  const renderMenuLink = (item: AdminSidebarMenuItem, variant: 'root' | 'child' = 'root') => {
    const Icon = adminSidebarIconComponents[item.icon]
    const active = isActive(item)

    if (!collapsed && editingMenuKey === item.href) {
      return renderMenuLabelEditor(item.href, item.defaultName ?? item.name)
    }

    return (
      <div key={item.href} className="group/menu relative">
        <Link
          href={withAdminWorkspaceSubject(item.href, workspaceSubject)}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
            variant === 'child' && !collapsed && 'py-2 pl-3',
            active ? 'bg-orange-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
            collapsed && 'md:justify-center md:px-2'
          )}
          title={collapsed ? item.name : undefined}
          onClick={() => setMobileOpen(false)}
        >
          <Icon className={cn('h-5 w-5 flex-shrink-0', variant === 'child' && !collapsed && 'h-4 w-4')} />
          <span className={cn('text-sm font-medium', collapsed && 'md:hidden')}>
            {item.name}
          </span>
          <AdminMenuBadge href={item.href} className={cn(collapsed && 'md:absolute md:right-0 md:top-0')} />
        </Link>
        {!collapsed ? renderMenuLabelEditButton(item.href, item.name, active) : null}
      </div>
    )
  }

  return (
    <>
      {/* 모바일 상단 바: 메뉴 · 제목 · 종. 본문은 이 바 아래에서 시작한다(레이아웃의 위 여백). 데스크톱에는 없다. */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b bg-white px-2 text-gray-900 md:hidden">
        <button
          type="button"
          aria-label="메뉴 열기"
          aria-expanded={mobileOpen}
          aria-controls="admin-sidebar"
          className="flex h-10 w-10 items-center justify-center rounded-md outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-orange-500"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-base font-bold">관리자 패널</p>
        <AdminAlertCenter compact className="flex h-10 w-10 items-center justify-center p-0 hover:bg-gray-100" />
      </header>

      {/* 모바일에서는 서랍(처음엔 닫힘, 닫혀 있으면 초점·읽기 대상에서 빠진다), 데스크톱에서는 예전과 같은 사이드바 */}
      <aside
        id="admin-sidebar"
        className={cn(
          'fixed left-0 top-0 z-40 h-screen w-64 bg-slate-900 text-white transition-all duration-300',
          'max-md:max-w-[85vw] max-md:overflow-y-auto',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full',
          collapsed && 'md:w-16',
          'md:relative md:top-0 md:h-auto'
        )}
      >
        <div className={cn('hidden items-center justify-between gap-1 p-2 md:flex', collapsed && 'md:flex-col')}>
          <AdminAlertCenter compact={collapsed} className="text-slate-300 hover:bg-slate-800 hover:text-white" />
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>

        <div className={cn('border-b border-slate-700 px-4 py-4', collapsed && 'md:px-2 md:py-3')}>
          <h2 className={cn('text-lg font-bold text-orange-400', collapsed && 'md:text-center md:text-sm')}>
            {collapsed ? '관리' : '관리자 패널'}
          </h2>
          {!collapsed ? (
            <div className="mt-3 space-y-3">
              <AdminWorkspaceSwitcher className="w-full" />
              <p className="text-xs text-slate-400">현재 관리 대상: {workspaceSubject === 'english' ? '영어' : '국어'}</p>
            </div>
          ) : null}
        </div>

        <nav className="space-y-1 p-2">
          {resolvedNavigationNodes.map((node) => {
            if (node.type === 'item') {
              return renderMenuLink(node.item)
            }

            return (
              <div key={node.id} className="space-y-1" role="group" aria-label={`${node.name} 메뉴`}>
                {!collapsed && editingMenuKey === node.id ? renderMenuLabelEditor(node.id, node.defaultName) : null}
                {!collapsed && editingMenuKey !== node.id ? (
                  <div
                    className={cn(
                      'group/menu relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold',
                      node.items.some((item) => isActive(item)) ? 'text-orange-300' : 'text-slate-400'
                    )}
                  >
                    {(() => {
                      const Icon = adminSidebarIconComponents[node.icon]
                      return <Icon className="h-5 w-5 flex-shrink-0" />
                    })()}
                    <span>{node.name}</span>
                    {renderMenuLabelEditButton(node.id, node.name, false, 'heading')}
                  </div>
                ) : null}
                <div className={cn('space-y-1', !collapsed && 'ml-4 border-l border-slate-700 pl-2')}>
                  {node.items.map((item) => renderMenuLink(item, 'child'))}
                </div>
              </div>
            )
          })}

          <div className="mt-2 border-t border-slate-700 pt-2">
            <Link
              href="/admin/my-password"
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white',
                pathname === '/admin/my-password' && 'bg-slate-800 text-white',
                collapsed && 'md:justify-center md:px-2'
              )}
            >
              <KeyRound className="h-5 w-5 flex-shrink-0" />
              <span className={cn(collapsed && 'md:hidden')}>내 비밀번호 변경</span>
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50',
                collapsed && 'md:justify-center md:px-2'
              )}
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              <span className={cn(collapsed && 'md:hidden')}>
                {isLoggingOut ? '로그아웃 중…' : '로그아웃'}
              </span>
            </button>
          </div>
        </nav>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  )
}
