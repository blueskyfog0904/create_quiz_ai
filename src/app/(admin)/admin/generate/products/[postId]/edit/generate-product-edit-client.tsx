'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  archiveGenerateListboardPostItemAction,
  createGenerateListboardPostItemAction,
  updateGenerateListboardPostAction,
  updateGenerateListboardPostItemAction,
} from '@/app/(admin)/admin/menu-management/actions'
import {
  LISTBOARD_GRADE_OPTIONS,
  normalizeListboardGradeLevel,
  type GenerateListboardPost,
  type GenerateListboardPostItem,
} from '@/lib/generate-menu'

interface GenerateProductEditClientProps {
  post: GenerateListboardPost
  initialPostItems: GenerateListboardPostItem[]
  workspaceSubject: WorkspaceSubject
}

interface GeneratePostFormState {
  title: string
  passageText: string
  examYear: string
  examMonth: string
  gradeLevel: string
  status: 'draft' | 'published' | 'archived'
  isActive: boolean
}

interface GeneratePostItemFormState {
  clientId: string
  id?: string
  questionNumber: string
  passageText: string
  sortOrder: number
  isActive: boolean
}

const MIN_EXAM_YEAR = 2000
const MAX_EXAM_YEAR = 2050
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))

function getDefaultExamDate() {
  const today = new Date()
  return {
    examYear: String(today.getFullYear()),
    examMonth: String(today.getMonth() + 1),
  }
}

function buildExamYearOptions(baseYear = MAX_EXAM_YEAR) {
  return Array.from({ length: Math.max(baseYear - MIN_EXAM_YEAR + 1, 1) }, (_, index) => String(baseYear - index))
}

function buildGeneratePostForm(post: GenerateListboardPost): GeneratePostFormState {
  const { examYear, examMonth } = getDefaultExamDate()

  return {
    title: post.title,
    passageText: post.passage_text,
    examYear: post.exam_year ? String(post.exam_year) : examYear,
    examMonth: post.exam_month ? String(post.exam_month) : examMonth,
    gradeLevel: normalizeListboardGradeLevel(post.grade_level) || '',
    status: post.status as GeneratePostFormState['status'],
    isActive: post.is_active,
  }
}

function buildGeneratePostItemForm(item?: GenerateListboardPostItem, index = 0): GeneratePostItemFormState {
  return {
    clientId: item?.id ?? crypto.randomUUID(),
    id: item?.id,
    questionNumber: item?.question_number ?? '',
    passageText: item?.passage_text ?? '',
    sortOrder: item?.sort_order ?? (index + 1) * 10,
    isActive: item?.is_active ?? true,
  }
}

function getRepresentativePassageText(items: GeneratePostItemFormState[]) {
  const representativeItem = items.find((item) => item.isActive) ?? items[0]
  return representativeItem?.passageText ?? ''
}

export default function GenerateProductEditClient({
  post,
  initialPostItems,
  workspaceSubject,
}: GenerateProductEditClientProps) {
  const router = useRouter()
  const listHref = withAdminWorkspaceSubject('/admin/generate/products', workspaceSubject)
  const [postForm, setPostForm] = useState<GeneratePostFormState>(buildGeneratePostForm(post))
  const [postItems, setPostItems] = useState<GeneratePostItemFormState[]>(initialPostItems.map((item, index) => buildGeneratePostItemForm(item, index)))
  const [isSavingPost, setIsSavingPost] = useState(false)
  const [savingPostItemClientIds, setSavingPostItemClientIds] = useState<string[]>([])
  const [archivePostItemTarget, setArchivePostItemTarget] = useState<GeneratePostItemFormState | null>(null)

  const examYearOptions = useMemo(() => {
    const candidateYears = [
      post.exam_year ? String(post.exam_year) : '',
      postForm.examYear,
    ]
    const baseYear = Math.max(
      ...candidateYears.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      MAX_EXAM_YEAR
    )

    return buildExamYearOptions(baseYear)
  }, [post.exam_year, postForm.examYear])

  const handleAddPostItemRow = () => {
    setPostItems((current) => [...current, buildGeneratePostItemForm(undefined, current.length)])
  }

  const handleRemoveUnsavedPostItemRow = (clientId: string) => {
    setPostItems((current) => current.filter((item) => item.clientId !== clientId))
  }

  const handleChangePostItem = (
    clientId: string,
    field: 'questionNumber' | 'passageText' | 'sortOrder' | 'isActive',
    value: string | number | boolean
  ) => {
    setPostItems((current) => current.map((item) => item.clientId === clientId ? {
      ...item,
      [field]: value,
    } : item))
  }

  const handleSubmitPost = async () => {
    setIsSavingPost(true)
    try {
      const response = await updateGenerateListboardPostAction(post.id, {
        title: postForm.title,
        passage_text: postForm.passageText,
        exam_year: postForm.examYear ? Number(postForm.examYear) : null,
        exam_month: postForm.examMonth ? Number(postForm.examMonth) : null,
        grade_level: postForm.gradeLevel || null,
        status: postForm.status,
        is_active: postForm.isActive,
      }, workspaceSubject)

      setPostForm(buildGeneratePostForm(response.data))
      toast.success('게시글을 수정했습니다.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 저장에 실패했습니다.')
    } finally {
      setIsSavingPost(false)
    }
  }

  const handleSavePostItem = async (item: GeneratePostItemFormState) => {
    setSavingPostItemClientIds((current) => [...current, item.clientId])
    try {
      if (item.id) {
        const response = await updateGenerateListboardPostItemAction(item.id, {
          question_number: item.questionNumber,
          passage_text: item.passageText,
          sort_order: item.sortOrder,
          is_active: item.isActive,
        }, workspaceSubject)

        setPostItems((current) => {
          const nextItems = current.map((candidate, index) => candidate.clientId === item.clientId
            ? buildGeneratePostItemForm(response.data, index)
            : candidate)
          const nextPassageText = getRepresentativePassageText(nextItems)
          setPostForm((prev) => ({ ...prev, passageText: nextPassageText }))
          return nextItems
        })
        toast.success(`문항 ${response.data.question_number}번을 수정했습니다.`)
      } else {
        const response = await createGenerateListboardPostItemAction({
          post_id: post.id,
          question_number: item.questionNumber,
          passage_text: item.passageText,
          sort_order: item.sortOrder,
          is_active: item.isActive,
        }, workspaceSubject)

        setPostItems((current) => {
          const nextItems = current.map((candidate, index) => candidate.clientId === item.clientId
            ? buildGeneratePostItemForm(response.data, index)
            : candidate)
          const nextPassageText = getRepresentativePassageText(nextItems)
          setPostForm((prev) => ({ ...prev, passageText: nextPassageText }))
          return nextItems
        })
        toast.success(`문항 ${response.data.question_number}번을 추가했습니다.`)
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문항 저장에 실패했습니다.')
    } finally {
      setSavingPostItemClientIds((current) => current.filter((clientId) => clientId !== item.clientId))
    }
  }

  const handleArchivePostItem = async () => {
    if (!archivePostItemTarget?.id) return

    setSavingPostItemClientIds((current) => [...current, archivePostItemTarget.clientId])
    try {
      await archiveGenerateListboardPostItemAction(archivePostItemTarget.id, workspaceSubject)
      setPostItems((current) => {
        const nextItems = current.filter((item) => item.clientId !== archivePostItemTarget.clientId)
        const nextPassageText = getRepresentativePassageText(nextItems)
        setPostForm((prev) => ({ ...prev, passageText: nextPassageText || prev.passageText }))
        return nextItems
      })
      toast.success(`문항 ${archivePostItemTarget.questionNumber || ''}번을 보관했습니다.`)
      setArchivePostItemTarget(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '문항 보관에 실패했습니다.')
    } finally {
      setSavingPostItemClientIds((current) => current.filter((clientId) => clientId !== archivePostItemTarget.clientId))
    }
  }

  return (
    <div className="container mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">문제생성 상품 수정</h1>
          <p className="mt-1 text-gray-500">등록된 리스트보드 게시글과 문항 행을 수정합니다.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={listHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />목록으로
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>게시글 기본 정보</CardTitle>
          <CardDescription>제목, 시험 정보, 대표 지문과 공개 상태를 관리합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="post-title">제목</Label>
            <Input id="post-title" value={postForm.title} onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="exam-year">년도</Label>
              <Select value={postForm.examYear} onValueChange={(value) => setPostForm((current) => ({ ...current, examYear: value }))}>
                <SelectTrigger id="exam-year" className="w-full">
                  <SelectValue placeholder="년도 선택" />
                </SelectTrigger>
                <SelectContent>
                  {examYearOptions.map((year) => (
                    <SelectItem key={year} value={year}>{year}년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="exam-month">월</Label>
              <Select value={postForm.examMonth} onValueChange={(value) => setPostForm((current) => ({ ...current, examMonth: value }))}>
                <SelectTrigger id="exam-month" className="w-full">
                  <SelectValue placeholder="월 선택" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((month) => (
                    <SelectItem key={month} value={month}>{month}월</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grade-level">학년</Label>
              <select
                id="grade-level"
                value={postForm.gradeLevel}
                onChange={(event) => setPostForm((current) => ({ ...current, gradeLevel: event.target.value }))}
                className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
              >
                <option value="">선택 안 함</option>
                {LISTBOARD_GRADE_OPTIONS.map((grade) => (
                  <option key={grade} value={grade}>{grade}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>상태</Label>
              <select value={postForm.status} onChange={(event) => setPostForm((current) => ({ ...current, status: event.target.value as GeneratePostFormState['status'] }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
              </select>
            </div>
            <div className="flex items-end md:col-span-2">
              <div className="flex h-10 w-full items-center gap-3 rounded-md border px-3">
                <Switch checked={postForm.isActive} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, isActive: checked }))} />
                <span className="text-sm text-gray-700">활성 상태 유지</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="passage-text">대표 지문 내용</Label>
            <Textarea id="passage-text" value={postForm.passageText} onChange={(event) => setPostForm((current) => ({ ...current, passageText: event.target.value }))} className="min-h-[180px]" />
            <p className="text-sm text-gray-500">기존 게시글 호환용 대표 지문입니다. 아래에서 문항 행 단위 수정도 가능합니다.</p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href={listHref}>취소</Link>
            </Button>
            <Button onClick={handleSubmitPost} disabled={isSavingPost}>
              {isSavingPost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              게시글 저장
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>문항 행 관리</CardTitle>
            <CardDescription>question_number / passage_text 기준으로 문항을 수정하거나 추가할 수 있습니다.</CardDescription>
          </div>
          <Button type="button" variant="outline" onClick={handleAddPostItemRow}>
            <Plus className="mr-2 h-4 w-4" />문항 추가
          </Button>
        </CardHeader>
        <CardContent>
          {postItems.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-gray-500">
              등록된 문항이 없습니다. 새 문항을 추가해주세요.
            </div>
          ) : (
            <div className="space-y-3">
              {postItems.map((item) => {
                const isSavingItem = savingPostItemClientIds.includes(item.clientId)

                return (
                  <div key={item.clientId} className="space-y-3 rounded-md border p-3">
                    <div className="grid gap-3 md:grid-cols-[140px,1fr,120px]">
                      <div className="space-y-2">
                        <Label>문항 번호</Label>
                        <Input
                          value={item.questionNumber}
                          onChange={(event) => handleChangePostItem(item.clientId, 'questionNumber', event.target.value)}
                          placeholder="예: 18"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>지문 내용</Label>
                        <Textarea
                          value={item.passageText}
                          onChange={(event) => handleChangePostItem(item.clientId, 'passageText', event.target.value)}
                          className="min-h-[140px]"
                        />
                      </div>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>정렬 순서</Label>
                          <Input
                            type="number"
                            value={item.sortOrder}
                            onChange={(event) => handleChangePostItem(item.clientId, 'sortOrder', Number(event.target.value) || 0)}
                          />
                        </div>
                        <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                          <Switch
                            checked={item.isActive}
                            onCheckedChange={(checked) => handleChangePostItem(item.clientId, 'isActive', checked)}
                          />
                          <span className="text-sm text-gray-700">{item.isActive ? '활성' : '비활성'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      {item.id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setArchivePostItemTarget(item)}
                          disabled={isSavingItem}
                        >
                          보관
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-gray-600 hover:bg-gray-100"
                          onClick={() => handleRemoveUnsavedPostItemRow(item.clientId)}
                          disabled={isSavingItem}
                        >
                          행 제거
                        </Button>
                      )}
                      <Button type="button" onClick={() => void handleSavePostItem(item)} disabled={isSavingItem}>
                        {isSavingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {item.id ? '문항 저장' : '문항 추가'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!archivePostItemTarget} onOpenChange={(open) => !open && setArchivePostItemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문항을 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archivePostItemTarget?.questionNumber || '-'}번]</span> 문항은 게시글 상세와 생성 대상에서 숨겨집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchivePostItem}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
