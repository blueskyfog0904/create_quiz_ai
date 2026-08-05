'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { AdminWorkspaceSwitcher } from '@/components/layout/admin-workspace-switcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  MARKET_HOME_LIMITS,
  type MarketHomeConfig,
  type MarketHomeData,
  type MarketHomeMenuEntry,
  type MarketHomeSourceConfig,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketMainSettingsClientProps {
  workspaceSubject: WorkspaceSubject
  config: MarketHomeConfig
  categories: MarketHomeMenuEntry[]
  sourceTypes: MarketHomeSourceConfig[]
  preview: MarketHomeData
}

interface SaveResponse {
  success: boolean
  data?: { config: MarketHomeConfig }
  error?: { message?: string }
}

function withExplicitSelections(
  config: MarketHomeConfig,
  categories: MarketHomeMenuEntry[],
  sourceTypes: MarketHomeSourceConfig[]
): MarketHomeConfig {
  return {
    ...config,
    popular: { ...config.popular },
    sourceExplorer: {
      ...config.sourceExplorer,
      sourceTypes: config.sourceExplorer.sourceTypes.length > 0
        ? [...config.sourceExplorer.sourceTypes]
        : [...new Set(sourceTypes.map((source) => source.typeName))],
    },
    categories: {
      ...config.categories,
      menuEntryIds: config.categories.menuEntryIds.length > 0
        ? [...config.categories.menuEntryIds]
        : categories.slice(0, MARKET_HOME_LIMITS.categories.max).map((category) => category.id),
    },
    recent: { ...config.recent },
  }
}

export default function MarketMainSettingsClient({
  workspaceSubject,
  config,
  categories,
  sourceTypes,
  preview,
}: MarketMainSettingsClientProps) {
  const initialConfig = useMemo(
    () => withExplicitSelections(config, categories, sourceTypes),
    [categories, config, sourceTypes]
  )
  const [draft, setDraft] = useState(initialConfig)
  const [saved, setSaved] = useState(initialConfig)
  const [isSaving, setIsSaving] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const uniqueSourceTypes = [...new Map(sourceTypes.map((source) => [source.typeName, source])).values()]
  const configuredSourceTypes = new Set(preview.sourceConfigs.map((source) => source.typeName))
  const missingSourceTypes = draft.sourceExplorer.sourceTypes.filter(
    (typeName) => !configuredSourceTypes.has(typeName)
  )

  const updateSection = <K extends keyof MarketHomeConfig>(
    section: K,
    value: MarketHomeConfig[K]
  ) => setDraft((current) => ({ ...current, [section]: value }))

  const toggleCategory = (id: string, checked: boolean) => {
    const currentIds = draft.categories.menuEntryIds
    if (checked && currentIds.length >= MARKET_HOME_LIMITS.categories.max) {
      toast.error(`카테고리는 최대 ${MARKET_HOME_LIMITS.categories.max}개까지 선택할 수 있습니다.`)
      return
    }
    updateSection('categories', {
      ...draft.categories,
      menuEntryIds: checked
        ? [...currentIds, id]
        : currentIds.filter((currentId) => currentId !== id),
    })
  }

  const moveCategory = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= draft.categories.menuEntryIds.length) return
    const nextIds = [...draft.categories.menuEntryIds]
    ;[nextIds[index], nextIds[nextIndex]] = [nextIds[nextIndex], nextIds[index]]
    updateSection('categories', { ...draft.categories, menuEntryIds: nextIds })
  }

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
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p>공개 상품 <strong>{preview.publicItemCount}</strong>개</p>
          <p>인기 자료 <strong>{preview.popular.length}</strong>개</p>
          <p>출처 경로 <strong>{preview.sourcePaths.length}</strong>개</p>
          <p>최근 자료 <strong>{preview.recent.length}</strong>개</p>
          {(draft.sourceExplorer.isActive && preview.publicItemCount > 0 && preview.sourcePaths.length === 0)
          || missingSourceTypes.length > 0 ? (
            <p className="text-destructive sm:col-span-2 lg:col-span-4">
              현재 출처 설정 또는 상품 메타데이터에 결손이 있어 출처 탐색 결과가 비어 있을 수 있습니다.
            </p>
          ) : null}
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
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div>
              <CardTitle>교재·출처</CardTitle>
              <CardDescription>현재 과목에 등록된 출처 유형만 선택할 수 있습니다.</CardDescription>
            </div>
            <Switch
              aria-label="교재 출처 노출"
              checked={draft.sourceExplorer.isActive}
              onCheckedChange={(isActive) => updateSection('sourceExplorer', {
                ...draft.sourceExplorer,
                isActive,
              })}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {uniqueSourceTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">등록된 출처 설정이 없습니다.</p>
          ) : uniqueSourceTypes.map((source) => {
            const checked = draft.sourceExplorer.sourceTypes.includes(source.typeName)
            return (
              <Label key={source.typeName} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => updateSection('sourceExplorer', {
                    ...draft.sourceExplorer,
                    sourceTypes: value
                      ? [...draft.sourceExplorer.sourceTypes, source.typeName]
                      : draft.sourceExplorer.sourceTypes.filter((typeName) => typeName !== source.typeName),
                  })}
                />
                {source.typeName}
              </Label>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-h-11 items-center justify-between gap-4">
            <div>
              <CardTitle>문제마켓 카테고리</CardTitle>
              <CardDescription>선택한 카테고리의 위·아래 순서가 메인 노출 순서입니다.</CardDescription>
            </div>
            <Switch
              aria-label="카테고리 노출"
              checked={draft.categories.isActive}
              onCheckedChange={(isActive) => updateSection('categories', {
                ...draft.categories,
                isActive,
              })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((category) => (
              <Label key={category.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
                <Checkbox
                  checked={draft.categories.menuEntryIds.includes(category.id)}
                  onCheckedChange={(value) => toggleCategory(category.id, value === true)}
                />
                {category.title}
              </Label>
            ))}
          </div>
          <ol className="space-y-2">
            {draft.categories.menuEntryIds.map((id, index) => {
              const category = categories.find((option) => option.id === id)
              if (!category) return null
              return (
                <li key={id} className="flex min-h-11 items-center gap-2 rounded-md border px-3">
                  <span className="min-w-0 flex-1 truncate">{index + 1}. {category.title}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${category.title} 위로 이동`}
                    disabled={index === 0}
                    onClick={() => moveCategory(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${category.title} 아래로 이동`}
                    disabled={index === draft.categories.menuEntryIds.length - 1}
                    onClick={() => moveCategory(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>

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
