'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Save, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AdminWorkspaceSwitcher } from '@/components/layout/admin-workspace-switcher'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { formatKstFull } from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  MAIN_AD_DEFAULT_DURATION_SECONDS,
  MAIN_AD_MAX_DURATION_SECONDS,
  MAIN_AD_MIN_DURATION_SECONDS,
  MAIN_AD_SCHEDULE_STATUS_LABELS,
  getMainAdImageExtension,
  getMainAdScheduleStatus,
  isAllowedMainAdHref,
  kstLocalToUtcIso,
  utcIsoToKstLocal,
  validateMainAdCarouselDraftConfig,
  type MainAdCarouselSubjectConfig,
  type MainAdCarouselItem,
  type MainAdSaveResponse,
  type MainAdSubject,
} from '@/lib/main-ad-carousel'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

interface EditableMainAdItem extends MainAdCarouselItem {
  pcFile: File | null
  mobileFile: File | null
}

interface MainAdSettingsClientProps {
  config: MainAdCarouselSubjectConfig
  workspaceSubject: MainAdSubject
  imageUrls: Record<string, {
    pc: string
    mobile: string | null
  }>
}

interface MainAdApiResponse {
  success: boolean
  data?: MainAdSaveResponse
  error?: {
    message?: string
  }
}

type MainAdFieldName = 'title' | 'href' | 'alt' | 'durationSeconds' | 'pcImage' | 'mobileImage' | 'schedule'
type MainAdFieldErrors = Record<string, Partial<Record<MainAdFieldName, string>>>

function getFieldErrorId(itemId: string, field: MainAdFieldName) {
  return `main-ad-${field}-error-${itemId}`
}

function validateEditableItems(items: EditableMainAdItem[]) {
  const errors: MainAdFieldErrors = {}

  items.forEach((item) => {
    const itemErrors: Partial<Record<MainAdFieldName, string>> = {}

    if (!item.title.trim()) {
      itemErrors.title = '광고 제목을 입력해 주세요.'
    }
    if (!item.href.trim() || !isAllowedMainAdHref(item.href.trim())) {
      itemErrors.href = '/로 시작하는 내부 경로 또는 https:// 주소를 입력해 주세요.'
    }
    if (!item.alt.trim()) {
      itemErrors.alt = '이미지 대체 텍스트를 입력해 주세요.'
    }
    if (
      !Number.isInteger(item.durationSeconds)
      || item.durationSeconds < MAIN_AD_MIN_DURATION_SECONDS
      || item.durationSeconds > MAIN_AD_MAX_DURATION_SECONDS
    ) {
      itemErrors.durationSeconds = `${MAIN_AD_MIN_DURATION_SECONDS}~${MAIN_AD_MAX_DURATION_SECONDS} 사이의 정수를 입력해 주세요.`
    }
    if (!item.pcImagePath && !item.pcFile) {
      itemErrors.pcImage = 'PC 이미지를 선택해 주세요.'
    }
    if (item.startsAt && item.endsAt && Date.parse(item.endsAt) <= Date.parse(item.startsAt)) {
      itemErrors.schedule = '노출 끝 시각은 시작 시각보다 뒤여야 합니다.'
    }

    if (Object.keys(itemErrors).length > 0) {
      errors[item.id] = itemErrors
    }
  })

  return errors
}

function FieldError({
  id,
  message,
}: {
  id: string
  message?: string
}) {
  if (!message) {
    return null
  }

  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  )
}

function toEditableItems(config: MainAdCarouselSubjectConfig): EditableMainAdItem[] {
  return config.items.map((item) => ({
    ...item,
    pcFile: null,
    mobileFile: null,
  }))
}

function toConfig(items: EditableMainAdItem[]): MainAdCarouselSubjectConfig {
  return {
    version: 1,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      pcImagePath: item.pcImagePath,
      mobileImagePath: item.mobileImagePath,
      alt: item.alt,
      href: item.href,
      durationSeconds: item.durationSeconds,
      isActive: item.isActive,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })),
  }
}

// 노출 기간 글(한국 시간). 비어 있으면 '바로'·'계속'(22번 6절).
function formatSchedule(item: Pick<MainAdCarouselItem, 'startsAt' | 'endsAt'>) {
  return `${item.startsAt ? formatKstFull(item.startsAt) : '바로'} ~ ${item.endsAt ? formatKstFull(item.endsAt) : '계속'}`
}

function ImagePreview({
  file,
  src,
  alt,
  mobile = false,
}: {
  file: File | null
  src: string | null
  alt: string
  mobile?: boolean
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      return
    }

    const nextUrl = URL.createObjectURL(file)
    const frameId = window.requestAnimationFrame(() => {
      setObjectUrl(nextUrl)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      URL.revokeObjectURL(nextUrl)
    }
  }, [file])

  const previewUrl = file ? objectUrl : src

  if (!previewUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground ${
          mobile ? 'aspect-[8/5]' : 'aspect-[8/3]'
        }`}
      >
        <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
        이미지 미리보기
      </div>
    )
  }

  return (
    <div className={`overflow-hidden rounded-lg border bg-muted/30 ${mobile ? 'aspect-[8/5]' : 'aspect-[8/3]'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt={alt || '메인 광고 이미지 미리보기'}
        className="h-full w-full object-cover"
      />
    </div>
  )
}

export default function MainAdSettingsClient({
  config: initialConfig,
  imageUrls: initialImageUrls,
  workspaceSubject,
}: MainAdSettingsClientProps) {
  const [items, setItems] = useState<EditableMainAdItem[]>(() => toEditableItems(initialConfig))
  const [savedConfig, setSavedConfig] = useState<MainAdCarouselSubjectConfig>(initialConfig)
  const [imageUrls, setImageUrls] = useState(initialImageUrls)
  const [savedImageUrls, setSavedImageUrls] = useState(initialImageUrls)
  const [fieldErrors, setFieldErrors] = useState<MainAdFieldErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  // 상태(노출 중·예약·종료·꺼짐) 계산 기준 시각: 화면을 연 때와 저장한 때
  const [now, setNow] = useState(() => new Date())
  const { ask, dialog } = useAdminConfirm()

  const currentConfig = useMemo(() => toConfig(items), [items])
  const hasPendingFiles = items.some((item) => item.pcFile || item.mobileFile)
  const hasUnsavedChanges = hasPendingFiles
    || JSON.stringify(currentConfig) !== JSON.stringify(savedConfig)

  const updateItem = (id: string, next: Partial<EditableMainAdItem>) => {
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...next } : item
    )))
  }

  const clearFieldError = (id: string, field: MainAdFieldName) => {
    setFieldErrors((current) => {
      if (!current[id]?.[field]) {
        return current
      }

      const nextItemErrors = { ...current[id] }
      delete nextItemErrors[field]

      if (Object.keys(nextItemErrors).length === 0) {
        const nextErrors = { ...current }
        delete nextErrors[id]
        return nextErrors
      }

      return {
        ...current,
        [id]: nextItemErrors,
      }
    })
  }

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: '',
        pcImagePath: '',
        mobileImagePath: null,
        alt: '',
        href: '',
        durationSeconds: MAIN_AD_DEFAULT_DURATION_SECONDS,
        isActive: true,
        startsAt: null,
        endsAt: null,
        pcFile: null,
        mobileFile: null,
      },
    ])
  }

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= items.length) {
      return
    }

    setItems((current) => {
      const next = [...current]
      const selected = next[index]
      next[index] = next[nextIndex]
      next[nextIndex] = selected
      return next
    })
  }

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const selectImage = (
    item: EditableMainAdItem,
    role: 'pc' | 'mobile',
    file: File | undefined
  ) => {
    if (!file) {
      return
    }

    try {
      getMainAdImageExtension(file)
    } catch (error) {
      const message = error instanceof Error ? error.message : '이미지 파일을 확인해 주세요.'
      setFieldErrors((current) => ({
        ...current,
        [item.id]: {
          ...current[item.id],
          [role === 'pc' ? 'pcImage' : 'mobileImage']: message,
        },
      }))
      toast.error(message)
      return
    }

    clearFieldError(item.id, role === 'pc' ? 'pcImage' : 'mobileImage')
    updateItem(item.id, role === 'pc' ? { pcFile: file } : { mobileFile: file })
  }

  const handleReset = () => {
    setItems(toEditableItems(savedConfig))
    setImageUrls(savedImageUrls)
    setFieldErrors({})
  }

  const handleSave = async () => {
    const nextFieldErrors = validateEditableItems(items)
    setFieldErrors(nextFieldErrors)

    if (Object.keys(nextFieldErrors).length > 0) {
      toast.error('입력값을 확인해 주세요.')
      return
    }

    // 22번 6절: 보일 배너가 0개가 되는 저장이면 확인한다(회원 홈의 배너 영역이 사라짐).
    const checkAt = new Date()
    const visibleAfter = items.filter((item) => getMainAdScheduleStatus(item, checkAt) === 'live').length
    const visibleBefore = savedConfig.items.filter((item) => getMainAdScheduleStatus(item, checkAt) === 'live').length
    if (visibleAfter === 0 && visibleBefore > 0) {
      const ok = await ask({
        title: '배너 영역이 사라집니다',
        description: '저장하면 지금 보일 배너가 0개가 되어 회원 홈에 배너 영역이 사라집니다. 저장할까요?',
        confirmLabel: '저장',
      })
      if (!ok) return
    }

    setIsSaving(true)

    try {
      const draftConfig = validateMainAdCarouselDraftConfig(currentConfig)
      const formData = new FormData()
      formData.append('config', JSON.stringify(draftConfig))

      items.forEach((item) => {
        if (item.pcFile) {
          formData.append(`file:${item.id}:pc`, item.pcFile)
        }
        if (item.mobileFile) {
          formData.append(`file:${item.id}:mobile`, item.mobileFile)
        }
      })

      const response = await fetch(withAdminWorkspaceSubject('/api/admin/main-ad-settings', workspaceSubject), {
        method: 'POST',
        body: formData,
      })
      const body = await response.json() as MainAdApiResponse

      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error?.message || '메인 광고 설정 저장에 실패했습니다.')
      }

      setItems(toEditableItems(body.data.config))
      setSavedConfig(body.data.config)
      setImageUrls(body.data.imageUrls)
      setSavedImageUrls(body.data.imageUrls)
      setFieldErrors({})
      setNow(new Date())

      if (body.data.cleanupWarnings.length > 0) {
        toast.warning('설정은 저장했지만 이전 이미지 일부를 정리하지 못했습니다.')
      } else {
        toast.success('메인 광고 설정을 저장했습니다.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '메인 광고 설정 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  // 요약 표(C-10): 작은 미리보기·제목·링크·노출 기간·상태(20번 tone). 저장 전 값 기준.
  const summaryColumns: AdminDataTableColumn<EditableMainAdItem>[] = [
    {
      key: 'preview',
      header: '미리보기',
      cell: (item) => (imageUrls[item.id]?.pc && !item.pcFile ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrls[item.id].pc} alt="" className="h-9 w-24 rounded border object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">{item.pcFile ? '새 이미지' : '없음'}</span>
      )),
    },
    { key: 'title', header: '제목', cell: (item) => <span className="break-keep">{item.title || '제목 없음'}</span> },
    { key: 'href', header: '링크', cell: (item) => <span className="break-all text-xs">{item.href || '없음'}</span> },
    { key: 'schedule', header: '노출 기간', cell: (item) => <span className="whitespace-nowrap text-xs">{formatSchedule(item)}</span> },
    {
      key: 'status',
      header: '상태',
      cell: (item) => {
        const status = getMainAdScheduleStatus(item, now)
        return <AdminStatusBadge label={MAIN_AD_SCHEDULE_STATUS_LABELS[status]} tone={adminStatusTone('banner', status)} />
      },
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900"><AdminMenuName href="/admin/main-ad-settings" fallback="(임시)메인광고설정" /></h1>
          <p className="mt-1 text-gray-500">
            {workspaceSubject === 'english' ? '영어' : '국어'} 문제마켓 메인 광고의 순서, 이미지, 연결 주소와 노출 시간을 관리합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminWorkspaceSwitcher />
          <Button
            type="button"
            variant="outline"
            onClick={handleReset}
            disabled={isSaving || !hasUnsavedChanges}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            되돌리기
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
          >
            {isSaving
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Save className="h-4 w-4" aria-hidden="true" />}
            저장
          </Button>
        </div>
      </div>

      {items.length > 0 ? (
        <AdminDataTable
          caption={`${workspaceSubject === 'english' ? '영어' : '국어'} 홈 배너 요약`}
          columns={summaryColumns}
          rows={items}
          getRowKey={(item) => item.id}
          minWidth={760}
        />
      ) : null}

      <div className="flex justify-end">
        <Button type="button" variant="brandOutline" onClick={addItem}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          광고 추가
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            등록된 광고가 없습니다. 보일 배너가 없으면 회원 홈에는 배너 영역이 보이지 않습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {items.map((item, index) => (
            <Card key={item.id}>
              <CardHeader className="gap-4 md:grid-cols-[1fr_auto]">
                <div>
                  <CardTitle>광고 {index + 1}</CardTitle>
                  <CardDescription className="mt-2">
                    목록에 표시될 제목과 광고 배너를 설정합니다.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={`광고 ${index + 1} 위로 이동`}
                    disabled={index === 0}
                    onClick={() => moveItem(index, 'up')}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11"
                    aria-label={`광고 ${index + 1} 아래로 이동`}
                    disabled={index === items.length - 1}
                    onClick={() => moveItem(index, 'down')}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11"
                        aria-label={`광고 ${index + 1} 삭제`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>이 광고를 삭제할까요?</AlertDialogTitle>
                        <AlertDialogDescription>
                          저장하면 이 광고와 더 이상 사용하지 않는 이미지가 삭제됩니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          className={buttonVariants({ variant: 'destructive' })}
                          onClick={() => removeItem(item.id)}
                        >
                          삭제
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`main-ad-title-${item.id}`}>광고 제목</Label>
                    <Input
                      id={`main-ad-title-${item.id}`}
                      value={item.title}
                      aria-invalid={Boolean(fieldErrors[item.id]?.title)}
                      aria-describedby={fieldErrors[item.id]?.title
                        ? getFieldErrorId(item.id, 'title')
                        : undefined}
                      onChange={(event) => {
                        clearFieldError(item.id, 'title')
                        updateItem(item.id, { title: event.target.value })
                      }}
                      placeholder="좌측 목록에 표시할 제목"
                    />
                    <p className="text-xs text-muted-foreground">
                      공개 왼쪽 목록에 표시되는 유일한 문구입니다.
                    </p>
                    <FieldError
                      id={getFieldErrorId(item.id, 'title')}
                      message={fieldErrors[item.id]?.title}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`main-ad-href-${item.id}`}>바로가기 주소</Label>
                    <Input
                      id={`main-ad-href-${item.id}`}
                      value={item.href}
                      aria-invalid={Boolean(fieldErrors[item.id]?.href)}
                      aria-describedby={fieldErrors[item.id]?.href
                        ? getFieldErrorId(item.id, 'href')
                        : undefined}
                      onChange={(event) => {
                        clearFieldError(item.id, 'href')
                        updateItem(item.id, { href: event.target.value })
                      }}
                      placeholder="/pricing 또는 https://..."
                    />
                    <FieldError
                      id={getFieldErrorId(item.id, 'href')}
                      message={fieldErrors[item.id]?.href}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`main-ad-alt-${item.id}`}>이미지 대체 텍스트</Label>
                    <Input
                      id={`main-ad-alt-${item.id}`}
                      value={item.alt}
                      aria-invalid={Boolean(fieldErrors[item.id]?.alt)}
                      aria-describedby={fieldErrors[item.id]?.alt
                        ? getFieldErrorId(item.id, 'alt')
                        : undefined}
                      onChange={(event) => {
                        clearFieldError(item.id, 'alt')
                        updateItem(item.id, { alt: event.target.value })
                      }}
                      placeholder="이미지 내용을 설명하는 문구"
                    />
                    <FieldError
                      id={getFieldErrorId(item.id, 'alt')}
                      message={fieldErrors[item.id]?.alt}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`main-ad-duration-${item.id}`}>노출 시간(초)</Label>
                    <Input
                      id={`main-ad-duration-${item.id}`}
                      type="number"
                      min={MAIN_AD_MIN_DURATION_SECONDS}
                      max={MAIN_AD_MAX_DURATION_SECONDS}
                      step={1}
                      value={item.durationSeconds}
                      aria-invalid={Boolean(fieldErrors[item.id]?.durationSeconds)}
                      aria-describedby={fieldErrors[item.id]?.durationSeconds
                        ? getFieldErrorId(item.id, 'durationSeconds')
                        : undefined}
                      onChange={(event) => {
                        clearFieldError(item.id, 'durationSeconds')
                        updateItem(item.id, {
                          durationSeconds: Number(event.target.value),
                        })
                      }}
                    />
                    <FieldError
                      id={getFieldErrorId(item.id, 'durationSeconds')}
                      message={fieldErrors[item.id]?.durationSeconds}
                    />
                  </div>
                </div>

                <div className="flex min-h-11 items-center justify-between rounded-lg border px-4 py-2">
                  <div>
                    <Label htmlFor={`main-ad-active-${item.id}`}>광고 노출</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      비활성 광고는 프리뷰 캐러셀에서 제외됩니다.
                    </p>
                  </div>
                  <Switch
                    id={`main-ad-active-${item.id}`}
                    checked={item.isActive}
                    onCheckedChange={(checked) => updateItem(item.id, { isActive: checked })}
                    aria-label={`${item.title || `광고 ${index + 1}`} 노출 여부`}
                  />
                </div>

                <div className="space-y-2 rounded-lg border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>노출 기간(한국 시간)</Label>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      지금 기준
                      <AdminStatusBadge
                        label={MAIN_AD_SCHEDULE_STATUS_LABELS[getMainAdScheduleStatus(item, now)]}
                        tone={adminStatusTone('banner', getMainAdScheduleStatus(item, now))}
                      />
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor={`main-ad-starts-${item.id}`} className="text-xs font-normal">시작(비우면 바로)</Label>
                      <Input
                        id={`main-ad-starts-${item.id}`}
                        type="datetime-local"
                        value={utcIsoToKstLocal(item.startsAt)}
                        aria-invalid={Boolean(fieldErrors[item.id]?.schedule)}
                        onChange={(event) => {
                          clearFieldError(item.id, 'schedule')
                          updateItem(item.id, { startsAt: event.target.value ? kstLocalToUtcIso(event.target.value) : null })
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`main-ad-ends-${item.id}`} className="text-xs font-normal">끝(비우면 계속)</Label>
                      <Input
                        id={`main-ad-ends-${item.id}`}
                        type="datetime-local"
                        value={utcIsoToKstLocal(item.endsAt)}
                        aria-invalid={Boolean(fieldErrors[item.id]?.schedule)}
                        aria-describedby={fieldErrors[item.id]?.schedule ? getFieldErrorId(item.id, 'schedule') : undefined}
                        onChange={(event) => {
                          clearFieldError(item.id, 'schedule')
                          updateItem(item.id, { endsAt: event.target.value ? kstLocalToUtcIso(event.target.value) : null })
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    시작 시각부터 보이고 끝 시각부터 빠집니다. 끝난 배너는 지우지 않고 &apos;종료&apos;로 남습니다.
                  </p>
                  <FieldError
                    id={getFieldErrorId(item.id, 'schedule')}
                    message={fieldErrors[item.id]?.schedule}
                  />
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor={`main-ad-pc-${item.id}`}>PC 이미지</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        권장 1920×720px (8:3) · JPG, PNG, WEBP · 최대 10MB
                        <br />
                        공개 화면 영역을 채워 표시하므로 이미지 가장자리가 잘릴 수 있습니다.
                      </p>
                    </div>
                    <ImagePreview
                      file={item.pcFile}
                      src={imageUrls[item.id]?.pc || null}
                      alt={item.alt}
                    />
                    <Input
                      id={`main-ad-pc-${item.id}`}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      aria-invalid={Boolean(fieldErrors[item.id]?.pcImage)}
                      aria-describedby={fieldErrors[item.id]?.pcImage
                        ? getFieldErrorId(item.id, 'pcImage')
                        : undefined}
                      onChange={(event) => selectImage(item, 'pc', event.target.files?.[0])}
                    />
                    <FieldError
                      id={getFieldErrorId(item.id, 'pcImage')}
                      message={fieldErrors[item.id]?.pcImage}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex min-h-11 items-start justify-between gap-3">
                      <div>
                        <Label htmlFor={`main-ad-mobile-${item.id}`}>모바일 이미지</Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          권장 1200×750px (8:5) · JPG, PNG, WEBP · 최대 10MB
                          <br />
                          미등록 시 PC 이미지를 사용하며 화면 비율에 따라 가장자리가 잘릴 수 있습니다.
                        </p>
                      </div>
                      {(item.mobileFile || item.mobileImagePath) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => updateItem(item.id, {
                            mobileFile: null,
                            mobileImagePath: null,
                          })}
                        >
                          이미지 제거
                        </Button>
                      ) : null}
                    </div>
                    <ImagePreview
                      file={item.mobileFile}
                      src={item.mobileImagePath ? imageUrls[item.id]?.mobile || null : null}
                      alt={item.alt}
                      mobile
                    />
                    <Input
                      id={`main-ad-mobile-${item.id}`}
                      type="file"
                      accept={IMAGE_ACCEPT}
                      aria-invalid={Boolean(fieldErrors[item.id]?.mobileImage)}
                      aria-describedby={fieldErrors[item.id]?.mobileImage
                        ? getFieldErrorId(item.id, 'mobileImage')
                        : undefined}
                      onChange={(event) => selectImage(item, 'mobile', event.target.files?.[0])}
                    />
                    <FieldError
                      id={getFieldErrorId(item.id, 'mobileImage')}
                      message={fieldErrors[item.id]?.mobileImage}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {dialog}
    </div>
  )
}
