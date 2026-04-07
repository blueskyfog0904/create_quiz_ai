'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'
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
  getVisibleFooterRows,
  normalizeFooterContent,
  type FooterContentConfig,
  type FooterFixedFieldKey,
} from '@/lib/footer-content'
import { saveFooterContentAction, type FooterSettingsPageData } from './actions'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export default function FooterSettingsClient({ footerContent: initialFooterContent }: FooterSettingsPageData) {
  const [footerContent, setFooterContent] = useState<FooterContentConfig>(() => clone(initialFooterContent))
  const [savedFooterContent, setSavedFooterContent] = useState<FooterContentConfig>(() => clone(initialFooterContent))
  const [isSaving, setIsSaving] = useState(false)

  const fixedFieldEntries = useMemo(
    () => FOOTER_FIXED_FIELD_KEYS.map((key) => ({
      key,
      ...footerContent.fixedFields[key],
    })),
    [footerContent]
  )
  const previewRows = useMemo(() => getVisibleFooterRows(footerContent), [footerContent])
  const hasUnsavedChanges = JSON.stringify(footerContent) !== JSON.stringify(savedFooterContent)

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
    try {
      const response = await saveFooterContentAction(normalizeFooterContent(footerContent))
      setFooterContent(response.data)
      setSavedFooterContent(response.data)
      toast.success('Footer 설정을 저장했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Footer 설정 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Footer 설정</h1>
          <p className="mt-1 text-gray-500">사이트 하단에 노출되는 사업자 정보와 추가 안내 문구를 관리합니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleReset} disabled={isSaving || !hasUnsavedChanges}>
            되돌리기
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasUnsavedChanges}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            저장
          </Button>
        </div>
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
              <div className="flex items-center justify-end gap-2 md:min-w-[120px]">
                <Switch
                  checked={field.enabled}
                  onCheckedChange={(checked) => updateFixedField(field.key, { enabled: checked })}
                />
                <span className="text-sm text-gray-500">{field.enabled ? '활성' : '비활성'}</span>
              </div>
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
          <Button variant="outline" onClick={handleAddNotice}>
            <Plus className="mr-2 h-4 w-4" />
            안내 문구 추가
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {footerContent.extraNotices.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-gray-500">
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
                className="text-red-500 hover:bg-red-50 hover:text-red-600"
                onClick={() => handleRemoveNotice(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>미리보기</CardTitle>
          <CardDescription>저장 전 Footer 노출 형태를 확인할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 rounded-lg border bg-white p-4 text-sm text-gray-500">
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
          <p className="pt-2">© {new Date().getFullYear()} {getFooterBrandName(footerContent)}. All rights reserved.</p>
        </CardContent>
      </Card>
    </div>
  )
}
