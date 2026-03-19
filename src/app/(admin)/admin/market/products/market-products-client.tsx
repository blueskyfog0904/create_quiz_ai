'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

function buildEmptyForm(menuEntryId = ''): MarketItemFormState {
  return {
    menuEntryId,
    title: '',
    summary: '',
    description: '',
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
    sortOrder: '0',
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

export default function MarketProductsClient({ menuEntries, initialItems }: MarketProductsClientProps) {
  const router = useRouter()
  const [selectedMenuEntryId, setSelectedMenuEntryId] = useState(menuEntries[0]?.id || '')
  const [items, setItems] = useState(initialItems)
  const [form, setForm] = useState<MarketItemFormState>(buildEmptyForm(menuEntries[0]?.id || ''))
  const [editingFiles, setEditingFiles] = useState<MarketItemFile[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingKinds, setUploadingKinds] = useState<string[]>([])

  const filteredItems = useMemo(() => (
    selectedMenuEntryId
      ? items.filter((item) => item.menu_entry_id === selectedMenuEntryId)
      : items
  ), [items, selectedMenuEntryId])

  const menuTitleMap = useMemo(() => new Map(menuEntries.map((entry) => [entry.id, entry.title])), [menuEntries])

  const refreshItems = async (menuEntryId = selectedMenuEntryId) => {
    const url = menuEntryId ? `/api/admin/market/items?menuEntryId=${menuEntryId}` : '/api/admin/market/items'
    const response = await fetch(url, { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 목록을 불러오지 못했습니다.')
    }

    setItems((current) => {
      const otherItems = current.filter((item) => item.menu_entry_id !== menuEntryId)
      return [...otherItems, ...payload.data]
    })
  }

  const loadItemDetail = async (id: string) => {
    const response = await fetch(`/api/admin/market/items/${id}`, { cache: 'no-store' })
    const payload = await response.json()

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || '문제마켓 상품 상세를 불러오지 못했습니다.')
    }

    setForm(buildEditForm(payload.data.item))
    setEditingFiles(payload.data.files || [])
  }

  const handleSubmit = async () => {
    if (!form.menuEntryId) {
      toast.error('카테고리를 선택해주세요.')
      return
    }

    setIsSaving(true)
    try {
      const body = {
        menuEntryId: form.menuEntryId,
        title: form.title,
        summary: form.summary,
        description: form.description,
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
        status: form.status,
        isActive: form.isActive,
      }

      const response = await fetch(form.id ? `/api/admin/market/items/${form.id}` : '/api/admin/market/items', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || '문제마켓 상품 저장에 실패했습니다.')
      }

      await refreshItems(form.menuEntryId)
      if (form.id) {
        await loadItemDetail(form.id)
      } else {
        setForm(buildEmptyForm(form.menuEntryId))
        setEditingFiles([])
      }
      toast.success(form.id ? '문제마켓 상품을 수정했습니다.' : '문제마켓 상품을 생성했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 상품 저장 중 오류가 발생했습니다.')
    } finally {
      setIsSaving(false)
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

      await loadItemDetail(form.id)
      toast.success(`${assetKind.toUpperCase()} 파일을 업로드했습니다.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문제마켓 파일 업로드 중 오류가 발생했습니다.')
    } finally {
      setUploadingKinds((current) => current.filter((kind) => kind !== assetKind))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">문제마켓 상품 관리</h1>
        <p className="mt-1 text-gray-500">카테고리별 문제마켓 상품과 파일을 등록/수정합니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>카테고리 선택</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            value={selectedMenuEntryId}
            onChange={(event) => {
              setSelectedMenuEntryId(event.target.value)
              setForm((current) => ({ ...current, menuEntryId: event.target.value }))
            }}
            className="flex h-10 w-full max-w-sm rounded-md border bg-white px-3 text-sm"
          >
            {menuEntries.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.title}</option>
            ))}
          </select>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px),minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{form.id ? '상품 수정' : '상품 추가'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>카테고리</Label>
              <select
                value={form.menuEntryId}
                onChange={(event) => setForm((current) => ({ ...current, menuEntryId: event.target.value }))}
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
              <Label>상세 설명</Label>
              <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[140px]" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>PDF 가격</Label>
                <Input type="number" value={form.pdfPrice} onChange={(event) => setForm((current) => ({ ...current, pdfPrice: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>HWP 가격</Label>
                <Input type="number" value={form.hwpPrice} onChange={(event) => setForm((current) => ({ ...current, hwpPrice: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>학년</Label>
                <Input value={form.gradeLevel} onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>상태</Label>
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as MarketItemFormState['status'] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="hidden">hidden</option>
                  <option value="archived">archived</option>
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>연도</Label>
                <Input type="number" value={form.examYear} onChange={(event) => setForm((current) => ({ ...current, examYear: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>월</Label>
                <Input type="number" value={form.examMonth} onChange={(event) => setForm((current) => ({ ...current, examMonth: event.target.value }))} />
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={isSaving} className="w-full">
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {form.id ? '상품 저장' : '상품 생성'}
            </Button>

            {form.id ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium text-gray-900">파일 업로드</p>
                  <p className="text-sm text-gray-500">sample/pdf/hwp 파일을 각각 업로드합니다.</p>
                </div>

                {(['sample', 'pdf', 'hwp'] as const).map((assetKind) => {
                  const currentFile = editingFiles.find((file) => file.asset_kind === assetKind && file.is_active)
                  const isUploading = uploadingKinds.includes(assetKind)

                  return (
                    <div key={assetKind} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium uppercase">{assetKind}</p>
                          <p className="text-xs text-gray-500">현재 파일: {currentFile?.original_file_name || '없음'}</p>
                        </div>
                        {currentFile ? <Badge variant="outline">v{currentFile.version}</Badge> : null}
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row">
                        <Input id={`upload-${assetKind}`} type="file" accept={assetKind === 'sample' || assetKind === 'pdf' ? '.pdf' : '.hwp'} />
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
                    <TableHead className="text-center">PDF</TableHead>
                    <TableHead className="text-center">HWP</TableHead>
                    <TableHead className="text-center">상태</TableHead>
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
                            {item.summary ? <p className="text-xs text-gray-500">{item.summary}</p> : null}
                          </div>
                        </TableCell>
                        <TableCell>{menuTitleMap.get(item.menu_entry_id) || '-'}</TableCell>
                        <TableCell className="text-center">{item.pdf_price}</TableCell>
                        <TableCell className="text-center">{item.hwp_price}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{item.status}</Badge>
                        </TableCell>
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
