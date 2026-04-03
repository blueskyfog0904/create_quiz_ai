'use client'

import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Monitor, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MainLandingView } from '@/components/features/landing/MainLandingView'
import { WorkspaceLandingView } from '@/components/features/landing/WorkspaceLandingView'
import {
  getDefaultMainLandingConfig,
  getDefaultWorkspaceLandingConfig,
  LANDING_ICON_TOKENS,
  LANDING_THEME_TOKENS,
  type LandingIconToken,
  type LandingThemeToken,
  type MainLandingConfig,
  type WorkspaceLandingConfig,
} from '@/lib/landing-page'
import { landingIconLabels, landingThemeLabels } from '@/components/features/landing/landing-view-shared'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  saveMainLandingConfigAction,
  saveWorkspaceLandingConfigAction,
  type LandingEditorTarget,
  type LandingPagesAdminData,
} from './actions'

interface LandingPagesClientProps extends LandingPagesAdminData {
  initialTarget: LandingEditorTarget
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function TokenSelect({
  label,
  value,
  options,
  optionLabels,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  optionLabels: Record<string, string>
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels[option] ?? option}
          </option>
        ))}
      </select>
    </div>
  )
}

function StringListEditor({
  label,
  values,
  maxItems,
  onChange,
}: {
  label: string
  values: string[]
  maxItems: number
  onChange: (nextValues: string[]) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={values.length >= maxItems}
          onClick={() => onChange([...values, ''])}
        >
          항목 추가
        </Button>
      </div>
      {values.map((value, index) => (
        <div key={`${label}-${index}`} className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(event) => onChange(values.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={values.length <= 1}
            onClick={() => onChange(values.filter((_, entryIndex) => entryIndex !== index))}
          >
            삭제
          </Button>
        </div>
      ))}
    </div>
  )
}

function CardItemEditor({
  title,
  description,
  icon,
  onChange,
  onRemove,
  removable,
}: {
  title: string
  description: string
  icon: LandingIconToken
  onChange: (next: { title: string; description: string; icon: LandingIconToken }) => void
  onRemove?: () => void
  removable?: boolean
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>제목</Label>
          <Input value={title} onChange={(event) => onChange({ title: event.target.value, description, icon })} />
        </div>
        <TokenSelect
          label="아이콘"
          value={icon}
          options={LANDING_ICON_TOKENS}
          optionLabels={landingIconLabels}
          onChange={(value) => onChange({ title, description, icon: value as LandingIconToken })}
        />
      </div>
      <div className="space-y-2">
        <Label>설명</Label>
        <Textarea value={description} onChange={(event) => onChange({ title, description: event.target.value, icon })} rows={3} />
      </div>
      {removable && onRemove ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>삭제</Button>
        </div>
      ) : null}
    </div>
  )
}

export default function LandingPagesClient({
  initialTarget,
  mainConfig: initialMainConfig,
  workspaceConfigs: initialWorkspaceConfigs,
  quickEntryTargets,
}: LandingPagesClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [target, setTarget] = useState<LandingEditorTarget>(initialTarget)
  const [mainConfig, setMainConfig] = useState<MainLandingConfig>(() => clone(initialMainConfig))
  const [workspaceConfigs, setWorkspaceConfigs] = useState<Record<WorkspaceSubject, WorkspaceLandingConfig>>(() => clone(initialWorkspaceConfigs))
  const [isSaving, setIsSaving] = useState(false)

  const activeWorkspaceSubject: WorkspaceSubject | null = target === 'english' || target === 'korean' ? target : null

  const updateTarget = (nextTarget: LandingEditorTarget) => {
    setTarget(nextTarget)
    const nextSearchParams = new URLSearchParams(searchParams.toString())
    nextSearchParams.set('target', nextTarget)
    router.replace(`${pathname}?${nextSearchParams.toString()}`)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      if (target === 'main') {
        await saveMainLandingConfigAction(mainConfig)
      } else {
        await saveWorkspaceLandingConfigAction(target, workspaceConfigs[target])
      }

      toast.success('랜딩페이지 설정을 저장했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '랜딩페이지 설정 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (target === 'main') {
      setMainConfig(getDefaultMainLandingConfig())
    } else {
      setWorkspaceConfigs((current) => ({
        ...current,
        [target]: getDefaultWorkspaceLandingConfig(target),
      }))
    }
  }

  const activeWorkspaceConfig = activeWorkspaceSubject ? workspaceConfigs[activeWorkspaceSubject] : null

  const previewContent = useMemo(() => {
    if (target === 'main') {
      return <MainLandingView config={mainConfig} />
    }

    if (!activeWorkspaceSubject || !activeWorkspaceConfig) {
      return null
    }

    return (
      <WorkspaceLandingView
        subject={activeWorkspaceSubject}
        isLoggedIn
        config={activeWorkspaceConfig}
        quickEntry={quickEntryTargets[activeWorkspaceSubject]}
      />
    )
  }, [target, mainConfig, activeWorkspaceSubject, activeWorkspaceConfig, quickEntryTargets])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">랜딩페이지 관리</h1>
        <p className="mt-2 text-sm text-gray-600">메인/영어/국어 랜딩페이지의 카피와 제한된 디자인 슬롯을 관리합니다.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>편집 대상 선택</CardTitle>
            <CardDescription>메인 랜딩과 영어/국어 랜딩을 분리해서 관리합니다.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['main', 'english', 'korean'] as LandingEditorTarget[]).map((candidate) => (
              <Button
                key={candidate}
                type="button"
                variant={target === candidate ? 'default' : 'outline'}
                onClick={() => updateTarget(candidate)}
              >
                {candidate === 'main' ? '메인' : candidate === 'english' ? '영어' : '국어'}
              </Button>
            ))}
          </div>
        </CardHeader>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={handleReset}>기본값 복원</Button>
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? '저장 중...' : '저장'}
        </Button>
      </div>

      {target === 'main' ? (
        <div className="space-y-6">
          <SectionCard title="Hero">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>배지</Label>
                <Input value={mainConfig.hero.badge} onChange={(event) => setMainConfig((current) => ({ ...current, hero: { ...current.hero, badge: event.target.value } }))} />
              </div>
              <div className="space-y-2">
                <Label>제목</Label>
                <Input value={mainConfig.hero.title} onChange={(event) => setMainConfig((current) => ({ ...current, hero: { ...current.hero, title: event.target.value } }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea rows={4} value={mainConfig.hero.description} onChange={(event) => setMainConfig((current) => ({ ...current, hero: { ...current.hero, description: event.target.value } }))} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {mainConfig.hero.chips.map((chip, index) => (
                <div key={`hero-chip-${index}`} className="space-y-2">
                  <Label>Hero 칩 {index + 1}</Label>
                  <Input
                    value={chip}
                    onChange={(event) => setMainConfig((current) => ({
                      ...current,
                      hero: {
                        ...current.hero,
                        chips: current.hero.chips.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry) as MainLandingConfig['hero']['chips'],
                      },
                    }))}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="워크스페이스 카드">
            <div className="grid gap-4 xl:grid-cols-2">
              {mainConfig.workspaceCards.map((card, index) => (
                <div key={card.subject} className="rounded-lg border p-4 space-y-4">
                  <Badge variant="outline">{card.subject === 'english' ? '영어 카드' : '국어 카드'}</Badge>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>라벨</Label>
                      <Input value={card.label} onChange={(event) => setMainConfig((current) => ({
                        ...current,
                        workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: event.target.value } : entry) as MainLandingConfig['workspaceCards'],
                      }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>제목</Label>
                      <Input value={card.title} onChange={(event) => setMainConfig((current) => ({
                        ...current,
                        workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, title: event.target.value } : entry) as MainLandingConfig['workspaceCards'],
                      }))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>설명</Label>
                    <Textarea rows={3} value={card.description} onChange={(event) => setMainConfig((current) => ({
                      ...current,
                      workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, description: event.target.value } : entry) as MainLandingConfig['workspaceCards'],
                    }))} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-2 md:col-span-2">
                      <Label>버튼 라벨</Label>
                      <Input value={card.buttonLabel} onChange={(event) => setMainConfig((current) => ({
                        ...current,
                        workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, buttonLabel: event.target.value } : entry) as MainLandingConfig['workspaceCards'],
                      }))} />
                    </div>
                    <TokenSelect
                      label="테마"
                      value={card.accentTheme}
                      options={LANDING_THEME_TOKENS}
                      optionLabels={landingThemeLabels}
                      onChange={(value) => setMainConfig((current) => ({
                        ...current,
                        workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, accentTheme: value as LandingThemeToken } : entry) as MainLandingConfig['workspaceCards'],
                      }))}
                    />
                  </div>
                  <TokenSelect
                    label="아이콘"
                    value={card.icon}
                    options={LANDING_ICON_TOKENS}
                    optionLabels={landingIconLabels}
                    onChange={(value) => setMainConfig((current) => ({
                      ...current,
                      workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, icon: value as LandingIconToken } : entry) as MainLandingConfig['workspaceCards'],
                    }))}
                  />
                  <StringListEditor
                    label="카드 하이라이트 칩"
                    values={card.highlightChips}
                    maxItems={5}
                    onChange={(nextValues) => setMainConfig((current) => ({
                      ...current,
                      workspaceCards: current.workspaceCards.map((entry, entryIndex) => entryIndex === index ? { ...entry, highlightChips: nextValues } : entry) as MainLandingConfig['workspaceCards'],
                    }))}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="가치 포인트 섹션">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>섹션 제목</Label>
                <Input value={mainConfig.valueSection.heading} onChange={(event) => setMainConfig((current) => ({ ...current, valueSection: { ...current.valueSection, heading: event.target.value } }))} />
              </div>
              <div className="space-y-2">
                <Label>섹션 소개</Label>
                <Textarea rows={3} value={mainConfig.valueSection.intro} onChange={(event) => setMainConfig((current) => ({ ...current, valueSection: { ...current.valueSection, intro: event.target.value } }))} />
              </div>
            </div>
            <div className="grid gap-4 xl:grid-cols-3">
              {mainConfig.valuePoints.map((point, index) => (
                <CardItemEditor
                  key={`value-point-${index}`}
                  title={point.title}
                  description={point.description}
                  icon={point.icon}
                  onChange={(next) => setMainConfig((current) => ({
                    ...current,
                    valuePoints: current.valuePoints.map((entry, entryIndex) => entryIndex === index ? next : entry) as MainLandingConfig['valuePoints'],
                  }))}
                />
              ))}
            </div>
          </SectionCard>
        </div>
      ) : activeWorkspaceSubject && activeWorkspaceConfig ? (
        <div className="space-y-6">
          <SectionCard title={`${activeWorkspaceSubject === 'english' ? '영어' : '국어'} 랜딩 Hero`}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Eyebrow</Label>
                <Input value={activeWorkspaceConfig.eyebrow} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], eyebrow: event.target.value },
                }))} />
              </div>
              <TokenSelect
                label="테마"
                value={activeWorkspaceConfig.theme}
                options={LANDING_THEME_TOKENS}
                optionLabels={landingThemeLabels}
                onChange={(value) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], theme: value as LandingThemeToken },
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label>제목</Label>
              <Input value={activeWorkspaceConfig.title} onChange={(event) => setWorkspaceConfigs((current) => ({
                ...current,
                [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], title: event.target.value },
              }))} />
            </div>
            <div className="space-y-2">
              <Label>설명</Label>
              <Textarea rows={3} value={activeWorkspaceConfig.description} onChange={(event) => setWorkspaceConfigs((current) => ({
                ...current,
                [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], description: event.target.value },
              }))} />
            </div>
            <div className="space-y-2">
              <Label>Hero Summary</Label>
              <Textarea rows={3} value={activeWorkspaceConfig.heroSummary} onChange={(event) => setWorkspaceConfigs((current) => ({
                ...current,
                [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], heroSummary: event.target.value },
              }))} />
            </div>
            <StringListEditor
              label="Quick Pills"
              values={activeWorkspaceConfig.quickPills}
              maxItems={4}
              onChange={(nextValues) => setWorkspaceConfigs((current) => ({
                ...current,
                [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], quickPills: nextValues },
              }))}
            />
          </SectionCard>

          <SectionCard title="Feature 섹션">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Feature Heading</Label>
                <Input value={activeWorkspaceConfig.featureHeading} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], featureHeading: event.target.value },
                }))} />
              </div>
              <div className="space-y-2">
                <Label>Feature Intro</Label>
                <Textarea rows={3} value={activeWorkspaceConfig.featureIntro} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], featureIntro: event.target.value },
                }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={activeWorkspaceConfig.features.length >= 4}
                onClick={() => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: {
                    ...current[activeWorkspaceSubject],
                    features: [
                      ...current[activeWorkspaceSubject].features,
                      { title: '새 기능', description: '설명을 입력하세요.', icon: 'sparkles' },
                    ],
                  },
                }))}
              >
                Feature 추가
              </Button>
            </div>
            <div className="space-y-4">
              {activeWorkspaceConfig.features.map((feature, index) => (
                <CardItemEditor
                  key={`feature-${index}`}
                  title={feature.title}
                  description={feature.description}
                  icon={feature.icon}
                  removable={activeWorkspaceConfig.features.length > 1}
                  onRemove={() => setWorkspaceConfigs((current) => ({
                    ...current,
                    [activeWorkspaceSubject]: {
                      ...current[activeWorkspaceSubject],
                      features: current[activeWorkspaceSubject].features.filter((_, featureIndex) => featureIndex !== index),
                    },
                  }))}
                  onChange={(next) => setWorkspaceConfigs((current) => ({
                    ...current,
                    [activeWorkspaceSubject]: {
                      ...current[activeWorkspaceSubject],
                      features: current[activeWorkspaceSubject].features.map((entry, featureIndex) => featureIndex === index ? next : entry),
                    },
                  }))}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Workflow 섹션">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Badge</Label>
                <Input value={activeWorkspaceConfig.workflowBadge} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], workflowBadge: event.target.value },
                }))} />
              </div>
              <div className="space-y-2">
                <Label>Heading</Label>
                <Input value={activeWorkspaceConfig.workflowHeading} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], workflowHeading: event.target.value },
                }))} />
              </div>
              <div className="space-y-2">
                <Label>Intro</Label>
                <Textarea rows={3} value={activeWorkspaceConfig.workflowIntro} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], workflowIntro: event.target.value },
                }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={activeWorkspaceConfig.steps.length >= 4}
                onClick={() => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: {
                    ...current[activeWorkspaceSubject],
                    steps: [
                      ...current[activeWorkspaceSubject].steps,
                      { title: '새 단계', description: '설명을 입력하세요.', icon: 'sparkles' },
                    ],
                  },
                }))}
              >
                Step 추가
              </Button>
            </div>
            <div className="space-y-4">
              {activeWorkspaceConfig.steps.map((step, index) => (
                <CardItemEditor
                  key={`step-${index}`}
                  title={step.title}
                  description={step.description}
                  icon={step.icon}
                  removable={activeWorkspaceConfig.steps.length > 1}
                  onRemove={() => setWorkspaceConfigs((current) => ({
                    ...current,
                    [activeWorkspaceSubject]: {
                      ...current[activeWorkspaceSubject],
                      steps: current[activeWorkspaceSubject].steps.filter((_, stepIndex) => stepIndex !== index),
                    },
                  }))}
                  onChange={(next) => setWorkspaceConfigs((current) => ({
                    ...current,
                    [activeWorkspaceSubject]: {
                      ...current[activeWorkspaceSubject],
                      steps: current[activeWorkspaceSubject].steps.map((entry, stepIndex) => stepIndex === index ? next : entry),
                    },
                  }))}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="CTA">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>CTA Headline</Label>
                <Input value={activeWorkspaceConfig.ctaHeadline} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], ctaHeadline: event.target.value },
                }))} />
              </div>
              <div className="space-y-2">
                <Label>CTA Body</Label>
                <Textarea rows={3} value={activeWorkspaceConfig.ctaBody} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], ctaBody: event.target.value },
                }))} />
              </div>
              <div className="space-y-2">
                <Label>CTA Hint</Label>
                <Textarea rows={3} value={activeWorkspaceConfig.ctaHint} onChange={(event) => setWorkspaceConfigs((current) => ({
                  ...current,
                  [activeWorkspaceSubject]: { ...current[activeWorkspaceSubject], ctaHint: event.target.value },
                }))} />
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Monitor className="h-5 w-5" />Desktop Preview</CardTitle>
            <CardDescription>실제 landing view 컴포넌트를 재사용한 desktop preview입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border bg-white">
              {previewContent}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" />Mobile Preview</CardTitle>
            <CardDescription>모바일 폭 기준 preview입니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mx-auto max-w-[390px] overflow-hidden rounded-xl border bg-white">
              {previewContent}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
