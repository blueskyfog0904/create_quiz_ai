'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminWorkspaceSwitcher } from '@/components/layout/admin-workspace-switcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  MARKET_HOME_LIMITS,
  type MarketHomeConfig,
  type MarketHomeData,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketMainSettingsClientProps {
  workspaceSubject: WorkspaceSubject
  config: MarketHomeConfig
  preview: MarketHomeData
}

interface SaveResponse {
  success: boolean
  data?: { config: MarketHomeConfig }
  error?: { message?: string }
}

export default function MarketMainSettingsClient({
  workspaceSubject,
  config,
  preview,
}: MarketMainSettingsClientProps) {
  const [draft, setDraft] = useState(config)
  const [saved, setSaved] = useState(config)
  const [isSaving, setIsSaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const updateSection = <K extends keyof MarketHomeConfig>(
    section: K,
    value: MarketHomeConfig[K]
  ) => setDraft((current) => ({ ...current, [section]: value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(
        withAdminWorkspaceSubject('/api/admin/market-main-settings', workspaceSubject),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }
      )
      const result = await response.json() as SaveResponse
      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error?.message || '설정을 저장하지 못했습니다.')
      }
      setDraft(result.data.config)
      setSaved(result.data.config)
      toast.success('문제마켓 메인 설정을 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '설정을 저장하지 못했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const links = [
    ['/admin/market/products', '상품 관리'],
    ['/admin/menu-management', '카테고리 관리'],
    ['/admin/source-configs', '출처 관리'],
    ['/admin/main-ad-settings', '메인 광고 설정'],
  ] as const

  return (
    <main className="flex w-full flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">(임시) 문제마켓 메인 관리</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {workspaceSubject === 'english' ? '영어' : '국어'} 문제마켓 메인의 자동 편성 범위를 설정합니다.
          </p>
        </div>
        <AdminWorkspaceSwitcher />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>실제 데이터 미리보기</CardTitle>
          <CardDescription>현재 공개 데이터 기준이며 저장 후 프리뷰 화면에 반영됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <p>공개 상품 <strong>{preview.publicItemCount}</strong>개</p>
          <p>인기 자료 <strong>{preview.popular.length}</strong>개</p>
          <p>최근 자료 <strong>{preview.recent.length}</strong>개</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex min-h-11 items-center justify-between gap-4">
              <CardTitle>인기 다운로드</CardTitle>
              <Switch
                aria-label="인기 다운로드 노출"
                checked={draft.popular.isActive}
                onCheckedChange={(isActive) => updateSection('popular', { ...draft.popular, isActive })}
              />
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="popular-limit">노출 개수</Label>
              <Input
                className="min-h-11"
                id="popular-limit"
                type="number"
                min={MARKET_HOME_LIMITS.popular.min}
                max={MARKET_HOME_LIMITS.popular.max}
                value={draft.popular.limit}
                onChange={(event) => updateSection('popular', {
                  ...draft.popular,
                  limit: Number(event.target.value),
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ranking-window">집계 기간(일)</Label>
              <Input
                className="min-h-11"
                id="ranking-window"
                type="number"
                min={MARKET_HOME_LIMITS.rankingWindowDays.min}
                max={MARKET_HOME_LIMITS.rankingWindowDays.max}
                value={draft.popular.rankingWindowDays}
                onChange={(event) => updateSection('popular', {
                  ...draft.popular,
                  rankingWindowDays: Number(event.target.value),
                })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex min-h-11 items-center justify-between gap-4">
              <CardTitle>최근 자료</CardTitle>
              <Switch
                aria-label="최근 자료 노출"
                checked={draft.recent.isActive}
                onCheckedChange={(isActive) => updateSection('recent', { ...draft.recent, isActive })}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="recent-limit">노출 개수</Label>
            <Input
              className="min-h-11"
              id="recent-limit"
              type="number"
              min={MARKET_HOME_LIMITS.recent.min}
              max={MARKET_HOME_LIMITS.recent.max}
              value={draft.recent.limit}
              onChange={(event) => updateSection('recent', {
                ...draft.recent,
                limit: Number(event.target.value),
              })}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>관련 관리 화면</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {links.map(([href, label]) => (
            <Button key={href} asChild variant="outline">
              <Link href={withAdminWorkspaceSubject(href, workspaceSubject)}>{label}</Link>
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex flex-col gap-3 rounded-lg border bg-background p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {dirty ? '저장하지 않은 변경 사항이 있습니다.' : '모든 변경 사항이 저장되었습니다.'}
        </p>
        <Button className="min-h-11" disabled={!dirty || isSaving} onClick={handleSave}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {isSaving ? '저장 중' : '설정 저장'}
        </Button>
      </div>
    </main>
  )
}
