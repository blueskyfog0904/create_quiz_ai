'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MarketItem, MarketItemFile } from '@/lib/market-items-server'
import type { MarketMenuEntryAdminRow } from '@/lib/market-menu'

interface MarketProductsClientProps {
  menuEntries: MarketMenuEntryAdminRow[]
  initialItems: MarketItem[]
}

interface MarketItemFormState {
  id?: string
  menuEntryId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string
  examYear: string
  examMonth: string
  gradeLevel: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  pdfPrice: string
  hwpPrice: string
  sortOrder: string
  status: 'draft' | 'published' | 'hidden' | 'archived'
  isActive: boolean
}

function getNextSortOrder(items: MarketItem[], menuEntryId?: string) {
  const scopedItems = menuEntryId ? items.filter((item) => item.menu_entry_id === menuEntryId) : items
  if (scopedItems.length === 0) {
    return '10'
  }

  return String(Math.max(...scopedItems.map((item) => item.sort_order || 0)) + 10)
}

function buildEmptyForm(items: MarketItem[], menuEntryId = ''): MarketItemFormState {
  return {
    menuEntryId,
    title: '',
    summary: '',
    description: '',
    thumbnailUrl: '',
    examYear: '',
    examMonth: '',
    gradeLevel: '',
    sourceType: '',
    source1: '',
    source2: '',
    source3: '',
    source4: '',
    pdfPrice: '0',
    hwpPrice: '0',
    sortOrder: getNextSortOrder(items, menuEntryId),
    status: 'draft',
    isActive: true,
  }
}

function buildEditForm(item: MarketItem): MarketItemFormState {
  return {
    id: item.id,
    menuEntryId: item.menu_entry_id,
    title: item.title,
    summary: item.summary || '',
    description: item.description || '',
    thumbnailUrl: item.thumbnail_url || '',
    examYear: item.exam_year ? String(item.exam_year) : '',
    examMonth: item.exam_month ? String(item.exam_month) : '',
    gradeLevel: item.grade_level || '',
    sourceType: item.source_type || '',
    source1: item.source_1 || '',
    source2: item.source_2 || '',
    source3: item.source_3 || '',
    source4: item.source_4 || '',
    pdfPrice: String(item.pdf_price),
    hwpPrice: String(item.hwp_price),
    sortOrder: String(item.sort_order),
    status: item.status as MarketItemFormState['status'],
    isActive: item.is_active,
  }
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) {
    return '-'
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return '-'
  }

  return new Date(value).toLocaleString('ko-KR')
}

export default function MarketProductsClient({ menuEntries, initialItems }: MarketProductsClientProps) {
  const router = useRouter()
  const [selectedMenuEntryId, setSelectedMenuEntryId] = useState(menuEntries[0]?.id || '')
  const [items, setItems] = useState(initialItems)
  const [form, setForm] = useState<MarketItemFormState>(buildEmptyForm(initialItems, menuEntries[0]?.id || ''))
  const [editingFiles, setEditingFiles] = useState<MarketItemFile[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [uploadingKinds, setUploadingKinds] = useState<string[]>([])

  const filteredItems = useMemo(() => (
    selectedMenuEntryId
      ? items.filter((item) => item.menu_entry_id === selectedMenuEntryId)
      : items
  ), [items, selectedMenuEntryId])

  const menuTitleMap = useMemo(() => new Map(menuEntries.map((entry) => [entry.id, entry.title])), [menuEntries])

  const resetForm = (menuEntryId = selectedMenuEntryId) => {
    setForm(buildEmptyForm(items, menuEntryId))
    setEditingFiles([])
  }

  const refreshItems = async (menuEntryId?: string) => {
    const targetMenuEntryId = menuEntryId ?? selectedMenuEntryId
    const url = targetMenuEntryId ? `/api/admin/market/items?menuEntryId=${targetMenuEntryId}` : '/api/admin/market/items'
    const response = await fetch(url, { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 목록을 불러오지 못했습니다.')
    }

    if (!targetMenuEntryId) {
      setItems(payload.data)
      return
    }

    setItems((current) => {
      const otherItems = current.filter((item) => item.menu_entry_id !== targetMenuEntryId)
      return [...otherItems, ...payload.data]
    })
  }

  const loadItemDetail = async (id: string) => {
    const response = await fetch(`/api/admin/market/items/${id}`, { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 상세를 불러오지 못했습니다.')
    }

    setSelectedMenuEntryId(payload.data.item.menu_entry_id)
    setForm(buildEditForm(payload.data.item))
    setEditingFiles(payload.data.files || [])
  }

  const buildRequestBody = (statusOverride?: MarketItemFormState['status']) => ({
    menuEntryId: form.menuEntryId,
    title: form.title,
    summary: form.summary,
    description: form.description,
    thumbnailUrl: form.thumbnailUrl,
    examYear: form.examYear ? Number(form.examYear) : null,
    examMonth: form.examMonth ? Number(form.examMonth) : null,
    gradeLevel: form.gradeLevel,
    sourceType: form.sourceType,
    source1: form.source1,
    source2: form.source2,
    source3: form.source3,
    source4: form.source4,
    pdfPrice: Number(form.pdfPrice || 0),
    hwpPrice: Number(form.hwpPrice || 0),
    sortOrder: Number(form.sortOrder || 0),
    status: statusOverride ?? form.status,
    isActive: form.isActive,
  })

  const persistForm = async (statusOverride?: MarketItemFormState['status']) => {
    if (!form.menuEntryId) {
      toast.error('카테고리를 선택해주세요.')
      return false
    }

    if (!form.title.trim()) {
      toast.error('상품 제목을 입력해주세요.')
      return false
    }

    setIsSaving(true)
    try {
      const previousMenuEntryId = form.id
        ? items.find((item) => item.id === form.id)?.menu_entry_id
        : null
      const nextStatus = statusOverride ?? form.status

      const response = await fetch(form.id ? `/api/admin/market/items/${form.id}` : '/api/admin/market/items', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(statusOverride)),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 저장에 실패했습니다.')
      }

      setSelectedMenuEntryId(form.menuEntryId)
      await refreshItems(form.menuEntryId)
      if (previousMenuEntryId && previousMenuEntryId !== form.menuEntryId) {
        await refreshItems(previousMenuEntryId)
      }
      await loadItemDetail(payload.data.id)
      setForm((current) => ({ ...current, status: nextStatus }))
      toast.success(form.id
        ? `문제마켓 상품을 ${nextStatus === 'published' ? '공개' : nextStatus === 'hidden' ? '숨김' : '저장'}했습니다.`
        : '문제마켓 상품을 생성했습니다. 이어서 파일을 업로드할 수 있습니다.')
      router.refresh()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 저장 중 오류가 발생했습니다.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmit = async () => {
    await persistForm()
  }

  const handleStatusAction = async (status: MarketItemFormState['status']) => {
    if (!form.id) {
      setForm((current) => ({ ...current, status }))
      toast.message(`상태를 ${status}(으)로 설정했습니다. 저장하면 반영됩니다.`)
      return
    }

    await persistForm(status)
  }

  const handleArchive = async () => {
    if (!form.id) {
      return
    }

    if (!window.confirm('이 상품을 보관 처리하시겠습니까? 목록에서 숨겨지고 다시 확인하려면 DB에서 복구해야 합니다.')) {
      return
    }

    setIsArchiving(true)
    try {
      const response = await fetch(`/api/admin/market/items/${form.id}`, {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 보관 처리에 실패했습니다.')
      }

      await refreshItems(form.menuEntryId)
      resetForm(form.menuEntryId)
      toast.success('문제마켓 상품을 보관 처리했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 보관 처리 중 오류가 발생했습니다.')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleUpload = async (assetKind: 'sample' | 'pdf' | 'hwp', file?: File | null) => {
    if (!form.id) {
      toast.error('파일 업로드 전에 상품을 먼저 저장해주세요.')
      return
    }

    if (!file) {
      toast.error('업로드할 파일을 선택해주세요.')
      return
    }

    setUploadingKinds((current) => [...current, assetKind])
    try {
      const formData = new FormData()
      formData.append('assetKind', assetKind)
      formData.append('file', file)

      const response = await fetch(`/api/admin/market/items/${form.id}/files`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 파일 업로드에 실패했습니다.')
      }

      await refreshItems(form.menuEntryId)
      await loadItemDetail(form.id)
      toast.success(`${assetKind.toUpperCase()} 파일을 업로드했습니다.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setUploadingKinds((current) => current.filter((kind) => kind !== assetKind))
    }
  }

  const activeFileMap = useMemo(() => {
    return new Map(editingFiles.filter((file) => file.is_active).map((file) => [file.asset_kind, file]))
  }, [editingFiles])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">문제마켓 상품 관리</h1>
          <p className="mt-1 text-gray-500">카테고리별 문제마켓 상품과 판매 파일을 등록/수정합니다.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => resetForm(selectedMenuEntryId)}
        >
          <Plus className="mr-2 h-4 w-4" />
          새 상품 작성
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>카테고리 선택</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedMenuEntryId}
            onChange={(event) => {
              const nextMenuEntryId = event.target.value
              setSelectedMenuEntryId(nextMenuEntryId)
              setForm((current) => current.id
                ? { ...current, menuEntryId: nextMenuEntryId }
                : buildEmptyForm(items, nextMenuEntryId))
            }}
            className="flex h-10 w-full max-w-sm rounded-md border bg-white px-3 text-sm"
          >
            {menuEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.title}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,460px),minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{form.id ? '상품 수정' : '상품 추가'}</CardTitle>
              {form.id ? <Badge variant="outline">편집 중</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>카테고리</Label>
              <select
                value={form.menuEntryId}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  menuEntryId: event.target.value,
                  sortOrder: current.id ? current.sortOrder : getNextSortOrder(items, event.target.value),
                }))}
                className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
              >
                {menuEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.title}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>제목</Label>
              <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>요약</Label>
              <Input value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>썸네일 URL</Label>
              <Input value={form.thumbnailUrl} onChange={(event) => setForm((current) => ({ ...current, thumbnailUrl: event.target.value }))} placeholder="https://..." />
            </div>

            <div className="space-y-2">
              <Label>상세 설명</Label>
              <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[140px]" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>PDF 가격</Label>
                <Input type="number" min={0} value={form.pdfPrice} onChange={(event) => setForm((current) => ({ ...current, pdfPrice: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>HWP 가격</Label>
                <Input type="number" min={0} value={form.hwpPrice} onChange={(event) => setForm((current) => ({ ...current, hwpPrice: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>학년</Label>
                <Input value={form.gradeLevel} onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))} placeholder="예: 고3" />
              </div>
              <div className="space-y-2">
                <Label>정렬 순서</Label>
                <Input type="number" min={0} value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>연도</Label>
                <Input type="number" min={0} value={form.examYear} onChange={(event) => setForm((current) => ({ ...current, examYear: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>월</Label>
                <Input type="number" min={1} max={12} value={form.examMonth} onChange={(event) => setForm((current) => ({ ...current, examMonth: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>상태</Label>
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as MarketItemFormState['status'] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="hidden">hidden</option>
                  <option value="archived">archived</option>
                </select>
              </div>
              <div className="flex items-end">
                <div className="flex h-10 w-full items-center justify-between rounded-md border px-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">활성화</p>
                    <p className="text-xs text-gray-500">비활성화하면 노출되지 않습니다.</p>
                  </div>
                  <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium text-gray-900">출처 정보</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>출처 타입</Label>
                  <Input value={form.sourceType} onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))} placeholder="예: 모의고사" />
                </div>
                <div className="space-y-2">
                  <Label>출처 1</Label>
                  <Input value={form.source1} onChange={(event) => setForm((current) => ({ ...current, source1: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 2</Label>
                  <Input value={form.source2} onChange={(event) => setForm((current) => ({ ...current, source2: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 3</Label>
                  <Input value={form.source3} onChange={(event) => setForm((current) => ({ ...current, source3: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>출처 4</Label>
                  <Input value={form.source4} onChange={(event) => setForm((current) => ({ ...current, source4: event.target.value }))} />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={handleSubmit} disabled={isSaving} className="flex-1">
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {form.id ? '상품 저장' : '상품 생성 후 업로드 계속'}
              </Button>
              <Button type="button" variant="secondary" disabled={isSaving} onClick={() => void handleStatusAction('draft')}>
                임시저장
              </Button>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleStatusAction('hidden')}>
                숨김
              </Button>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => void handleStatusAction('published')}>
                공개
              </Button>
              {form.id ? (
                <Button type="button" variant="destructive" disabled={isArchiving} onClick={handleArchive}>
                  {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  보관 처리
                </Button>
              ) : null}
            </div>

            {form.id ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium text-gray-900">파일 업로드</p>
                  <p className="text-sm text-gray-500">샘플 PDF, 판매용 PDF, HWP를 각각 최신 버전으로 교체할 수 있습니다.</p>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>자산</TableHead>
                        <TableHead>현재 파일</TableHead>
                        <TableHead className="text-center">버전</TableHead>
                        <TableHead className="text-center">상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(['sample', 'pdf', 'hwp'] as const).map((assetKind) => {
                        const currentFile = activeFileMap.get(assetKind)

                        return (
                          <TableRow key={`file-row-${assetKind}`}>
                            <TableCell className="uppercase">{assetKind}</TableCell>
                            <TableCell>{currentFile?.original_file_name || '미업로드'}</TableCell>
                            <TableCell className="text-center">{currentFile ? `v${currentFile.version}` : '-'}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant={currentFile ? 'outline' : 'secondary'}>
                                {currentFile ? '활성 파일' : '없음'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {(['sample', 'pdf', 'hwp'] as const).map((assetKind) => {
                  const currentFile = activeFileMap.get(assetKind)
                  const isUploading = uploadingKinds.includes(assetKind)

                  return (
                    <div key={assetKind} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium uppercase">{assetKind}</p>
                          <p className="text-xs text-gray-500">현재 파일: {currentFile?.original_file_name || '없음'}</p>
                        </div>
                        {currentFile ? <Badge variant="outline">v{currentFile.version}</Badge> : <Badge variant="secondary">미업로드</Badge>}
                      </div>
                      <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                        <p>용량: {formatFileSize(currentFile?.file_size_bytes)}</p>
                        <p>등록일: {formatDateTime(currentFile?.created_at)}</p>
                        <p className="truncate">경로: {currentFile?.storage_path || '-'}</p>
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row">
                        <Input id={`upload-${assetKind}`} type="file" accept={assetKind === 'hwp' ? '.hwp' : '.pdf'} />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isUploading}
                          onClick={() => {
                            const input = document.getElementById(`upload-${assetKind}`) as HTMLInputElement | null
                            void handleUpload(assetKind, input?.files?.[0])
                          }}
                        >
                          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          업로드
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>상품 목록</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>카테고리</TableHead>
                    <TableHead className="text-center">가격</TableHead>
                    <TableHead className="text-center">상태</TableHead>
                    <TableHead className="text-center">정렬</TableHead>
                    <TableHead className="text-right">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-gray-500">
                        등록된 상품이 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-gray-900">{item.title}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                              {item.summary ? <span>{item.summary}</span> : null}
                              {item.grade_level ? <Badge variant="secondary">{item.grade_level}</Badge> : null}
                              {!item.is_active ? <Badge variant="destructive">비활성</Badge> : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{menuTitleMap.get(item.menu_entry_id) || '-'}</TableCell>
                        <TableCell className="text-center text-sm">
                          <div>PDF {item.pdf_price}C</div>
                          <div>HWP {item.hwp_price}C</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{item.status}</Badge>
                        </TableCell>
                        <TableCell className="text-center">{item.sort_order}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button type="button" variant="ghost" size="icon" onClick={() => void loadItemDetail(item.id)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
