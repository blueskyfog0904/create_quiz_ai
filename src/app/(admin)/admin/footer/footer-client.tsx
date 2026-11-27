'use client'

import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { History, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  FOOTER_FIXED_FIELD_KEYS,
  getFooterBrandName,
  isFooterLegalFieldKey,
  getVisibleFooterRows,
  type FooterContentConfig,
  type FooterFixedFieldKey,
  type FooterPolicyDocumentKey,
} from '@/lib/footer-content'
import { saveFooterContentAction } from './actions'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminSaveBar, countChangedFields } from '@/components/admin/kit/admin-save-bar'
import { ADMIN_TONE_CLASSES, ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { cn } from '@/lib/utils'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

interface FooterSettingsClientProps {
  footerContent: FooterContentConfig
  // 하단 미리보기의 이름(상호명이 비었을 때 쓰는 사이트 이름)
  siteBrandName: string
  // 머리말 아래에 놓는 사이트 이름·로고 영역(각자 따로 저장)
  topSections?: ReactNode
  // 고지 기간(변경 예정 글 upcoming)이면 약관 칸 위에 미리 보이는 안내(15번 7-3)
  policyLockNotice?: string | null
}

export default function FooterSettingsClient({ footerContent: initialFooterContent, siteBrandName, topSections, policyLockNotice = null }: FooterSettingsClientProps) {
  const [footerContent, setFooterContent] = useState<FooterContentConfig>(() => clone(initialFooterContent))
  const [savedFooterContent, setSavedFooterContent] = useState<FooterContentConfig>(() => clone(initialFooterContent))
  const [isSaving, setIsSaving] = useState(false)
  // 저장 상태 줄(20번 3-2): 마지막 저장 시각·실패 문구. 알림(toast)은 그대로 띄운다.
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const fixedFieldEntries = useMemo(
    () => FOOTER_FIXED_FIELD_KEYS.map((key) => ({
      key,
      ...footerContent.fixedFields[key],
    })),
    [footerContent]
  )
  const policyDocumentEntries = useMemo(
    () => Object.entries(footerContent.policyDocuments).map(([key, value]) => ({
      key: key as FooterPolicyDocumentKey,
      ...value,
    })),
    [footerContent]
  )
  const previewRows = useMemo(() => getVisibleFooterRows(footerContent), [footerContent])
  const hasUnsavedChanges = JSON.stringify(footerContent) !== JSON.stringify(savedFooterContent)
  // 저장 안 된 변경 수: 바뀐 사업자 정보 칸·약관 문서 수 + 안내 문구 목록(바뀌었으면 1)
  const changedCount = countChangedFields(footerContent.fixedFields, savedFooterContent.fixedFields)
    + countChangedFields(footerContent.policyDocuments, savedFooterContent.policyDocuments)
    + (JSON.stringify(footerContent.extraNotices) !== JSON.stringify(savedFooterContent.extraNotices) ? 1 : 0)

  const updateFixedField = (
    key: FooterFixedFieldKey,
    next: Partial<FooterContentConfig['fixedFields'][FooterFixedFieldKey]>
  ) => {
    setFooterContent((current) => ({
      ...current,
      fixedFields: {
        ...current.fixedFields,
        [key]: {
          ...current.fixedFields[key],
          ...next,
        },
      },
    }))
  }

  const updatePolicyDocument = (
    key: FooterPolicyDocumentKey,
    next: Partial<FooterContentConfig['policyDocuments'][FooterPolicyDocumentKey]>
  ) => {
    setFooterContent((current) => ({
      ...current,
      policyDocuments: {
        ...current.policyDocuments,
        [key]: {
          ...current.policyDocuments[key],
          ...next,
        },
      },
    }))
  }

  const handleNoticeChange = (index: number, value: string) => {
    setFooterContent((current) => ({
      ...current,
      extraNotices: current.extraNotices.map((notice, noticeIndex) => noticeIndex === index ? value : notice),
    }))
  }

  const handleAddNotice = () => {
    setFooterContent((current) => ({
      ...current,
      extraNotices: [...current.extraNotices, ''],
    }))
  }

  const handleRemoveNotice = (index: number) => {
    setFooterContent((current) => ({
      ...current,
      extraNotices: current.extraNotices.filter((_, noticeIndex) => noticeIndex !== index),
    }))
  }

  const handleReset = () => {
    setFooterContent(clone(savedFooterContent))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      // 화면 상태 원본을 그대로 보낸다: 서버가 원본으로 '가입 동의에 쓰이는 약관 끄기·비우기'를 검사한 뒤 정규화한다.
      const response = await saveFooterContentAction(footerContent)
      if (!response.success) {
        toast.error(response.error)
        setSaveError(response.error)
        return
      }
      setFooterContent(response.data)
      setSavedFooterContent(response.data)
      setSavedAt(Date.now())
      toast.success('하단 정보를 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '하단 정보 저장에 실패했습니다.')
      setSaveError(error instanceof Error ? error.message : '하단 정보 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        className="mb-0"
        title={<AdminMenuName href="/admin/footer" fallback="사이트 기본 정보" />}
        description="사이트 이름·로고와 하단 사업자 정보·안내 문구·약관을 관리합니다."
      />

      {topSections}

      {/* 하단 정보 저장(저장 함수 하나 = 인라인 저장 줄 하나). 아래 사업자 정보·안내 문구·약관 카드를 함께 저장한다. */}
      <div className="flex flex-wrap items-center gap-2">
        <AdminSaveBar
          className="min-w-0 flex-1"
          variant="inline"
          dirtyCount={hasUnsavedChanges ? Math.max(1, changedCount) : 0}
          status={isSaving ? 'saving' : saveError ? 'error' : savedAt ? 'saved' : 'idle'}
          savedAt={savedAt}
          errorMessage={saveError}
          applyNote="하단 정보: 아래 기본 사업자 정보·추가 안내 문구·약관 및 정책을 함께 저장합니다."
          onSave={() => void handleSave()}
          saveLabel="하단 정보 저장"
          saveDisabled={!hasUnsavedChanges}
        />
        <Button variant="brandOutline" onClick={handleReset} disabled={isSaving || !hasUnsavedChanges}>
          되돌리기
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>기본 사업자 정보</CardTitle>
          <CardDescription>각 항목은 값과 노출 여부를 함께 관리합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {fixedFieldEntries.map((field) => (
            <div key={field.key} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor={`footer-field-${field.key}`}>{field.label}</Label>
                {field.key === 'businessAddress' ? (
                  <Textarea
                    id={`footer-field-${field.key}`}
                    rows={3}
                    value={field.value}
                    onChange={(event) => updateFixedField(field.key, { value: event.target.value })}
                  />
                ) : (
                  <Input
                    id={`footer-field-${field.key}`}
                    type={field.key === 'orderEmail' ? 'email' : 'text'}
                    value={field.value}
                    onChange={(event) => updateFixedField(field.key, { value: event.target.value })}
                  />
                )}
              </div>
              {isFooterLegalFieldKey(field.key) ? (
                // 법정 표시 항목은 끌 수 없다(저장할 때도 켜짐으로 고정된다)
                <div className="flex flex-col items-end justify-center gap-1 md:min-w-[120px]">
                  <span className="text-sm text-[var(--studio-muted)]">법정 표시 항목</span>
                  <span className="text-xs text-[var(--studio-muted)]">끌 수 없음</span>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2 md:min-w-[120px]">
                  <Switch
                    checked={field.enabled}
                    onCheckedChange={(checked) => updateFixedField(field.key, { enabled: checked })}
                  />
                  <span className="text-sm text-[var(--studio-muted)]">{field.enabled ? '활성' : '비활성'}</span>
                </div>
              )}
              {isFooterLegalFieldKey(field.key) && !field.value.trim() ? (
                <p className={cn('text-xs md:col-span-2', ADMIN_TONE_TEXT_CLASSES.warning)}>비어 있으면 하단에 보이지 않습니다. 출시 전에 채워 주세요.</p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>추가 안내 문구</CardTitle>
            <CardDescription>제목 없이 문장 리스트 형태로 footer 하단에 표시됩니다.</CardDescription>
          </div>
          <Button variant="brandOutline" onClick={handleAddNotice}>
            <Plus className="mr-2 h-4 w-4" />
            안내 문구 추가
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {footerContent.extraNotices.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--studio-border)] p-6 text-sm text-[var(--studio-muted)]">
              등록된 추가 안내 문구가 없습니다.
            </div>
          ) : footerContent.extraNotices.map((notice, index) => (
            <div key={`footer-notice-${index}`} className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={notice}
                onChange={(event) => handleNoticeChange(index, event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${index + 1}번째 안내 문구 삭제`}
                className={cn('hover:bg-[var(--admin-tone-danger-soft)]', ADMIN_TONE_TEXT_CLASSES.danger)}
                onClick={() => handleRemoveNotice(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <CardTitle>약관 및 정책</CardTitle>
            <CardDescription>
              Footer에 노출할 약관 링크와 각 페이지의 본문을 관리합니다. 저장할 때마다 바뀐 본문의 사본이 남습니다.
            </CardDescription>
          </div>
          <Button asChild variant="brandOutline">
            <Link href="/admin/footer/policy-history">
              <History className="mr-2 h-4 w-4" />
              약관 이력 보기
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {policyLockNotice ? <AdminNotice kind="warning">{policyLockNotice}</AdminNotice> : null}
          {policyDocumentEntries.map((document) => (
            <div key={document.key} className="rounded-lg border p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex flex-1 flex-col gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`footer-policy-label-${document.key}`}>Footer 링크명</Label>
                        <Input
                          id={`footer-policy-label-${document.key}`}
                          value={document.label}
                          onChange={(event) => updatePolicyDocument(document.key, { label: event.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`footer-policy-title-${document.key}`}>페이지 제목</Label>
                        <Input
                          id={`footer-policy-title-${document.key}`}
                          value={document.title}
                          onChange={(event) => updatePolicyDocument(document.key, { title: event.target.value })}
                        />
                      </div>
                    </div>
                    <p className="text-sm text-[var(--studio-muted)]">연결 경로: /terms/{document.slug}</p>
                  </div>
                  <div className="flex items-center justify-end gap-2 md:min-w-[120px]">
                    <Switch
                      checked={document.enabled}
                      onCheckedChange={(checked) => updatePolicyDocument(document.key, { enabled: checked })}
                    />
                    <span className="text-sm text-[var(--studio-muted)]">{document.enabled ? '활성' : '비활성'}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`footer-policy-content-${document.key}`}>본문</Label>
                  <Textarea
                    id={`footer-policy-content-${document.key}`}
                    rows={12}
                    value={document.content}
                    onChange={(event) => updatePolicyDocument(document.key, { content: event.target.value })}
                  />
                  <p className="text-xs text-[var(--studio-muted)]"># 제목, ## 소제목, - 목록 형식의 간단한 마크다운을 사용할 수 있습니다.</p>
                  {document.key === 'serviceTerms' ? (
                    <p className={cn('rounded-md border px-3 py-2 text-xs leading-5', ADMIN_TONE_CLASSES.warning)}>
                      이용약관은 가입 동의에 연결된 문서라 끄거나 비울 수 없습니다. 중요한 변경은 새 전문·시행일을 먼저 알린 뒤, 본문 수정은 시행일 당일에 하고 수정한 뒤 바로 가입 동의 항목에서 &lsquo;다시 동의 받기&rsquo;를 누르세요.
                    </p>
                  ) : null}
                  {document.key === 'privacyPolicy' ? (
                    <p className={cn('rounded-md border px-3 py-2 text-xs leading-5', ADMIN_TONE_CLASSES.warning)}>
                      개인정보처리방침은 공개 의무가 있어 끄거나 비울 수 없습니다. 수집 항목·보유 기간을 바꿨다면 가입 동의의 &lsquo;개인정보 수집·이용 동의&rsquo; 항목 내용도 같이 고치세요.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>미리보기</CardTitle>
          <CardDescription>저장 전 Footer 노출 형태를 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 rounded-lg border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4 text-sm text-[var(--studio-muted)]">
          {previewRows.map((row, index) => (
            <p key={`preview-row-${index}`}>
              {row.map((field) => `${field.label}: ${field.value.trim()}`).join(' | ')}
            </p>
          ))}
          {footerContent.extraNotices
            .map((notice) => notice.trim())
            .filter(Boolean)
            .map((notice, index) => (
              <p key={`preview-notice-${index}`}>{notice}</p>
            ))}
          <p className="pt-2">
            {policyDocumentEntries
              .filter((document) => document.enabled && document.label.trim() && document.content.trim())
              .map((document) => document.label.trim())
              .join(' | ')}
          </p>
          <p className="pt-2">© {new Date().getFullYear()} {getFooterBrandName(footerContent, siteBrandName)}. All rights reserved.</p>
        </CardContent>
      </Card>
    </div>
  )
}
