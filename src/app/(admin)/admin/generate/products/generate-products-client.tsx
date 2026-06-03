'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import * as XLSX from 'xlsx'
import { Download, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  archiveGenerateListboardPostAction,
  createGenerateListboardPostWithItemsAction,
  getGenerateListboardPostsAction,
} from '@/app/(admin)/admin/menu-management/actions'
import {
  LISTBOARD_GRADE_OPTIONS,
  type GenerateListboardPost,
  type GenerateMenuEntryAdminRow,
} from '@/lib/generate-menu'

interface GenerateProductsClientProps {
  generateMenuEntries: GenerateMenuEntryAdminRow[]
  initialGeneratePosts: GenerateListboardPost[]
  initialSelectedBoardId: string | null
  workspaceSubject: WorkspaceSubject
}

interface GeneratePostCsvItem {
  questionNumber: string
  passageText: string
  sortOrder: number
  isActive: boolean
}

interface GeneratePostFormState {
  menuEntryId: string
  title: string
  csvFileName: string
  csvItems: GeneratePostCsvItem[]
  examYear: string
  examMonth: string
  gradeLevel: string
  status: 'draft' | 'published' | 'archived'
  isActive: boolean
}

const MIN_EXAM_YEAR = 2000
const MAX_EXAM_YEAR = 2050
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1))
const CSV_ACCEPT_VALUE = '.csv,.xlsx'

async function parseGeneratePostCsvFile(file: File): Promise<{ fileName: string; items: GeneratePostCsvItem[] }> {
  const fileName = file.name.toLowerCase()
  if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
    throw new Error('.csv 또는 .xlsx 파일만 업로드할 수 있습니다.')
  }

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    throw new Error('업로드한 파일에 시트가 없습니다.')
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  })

  if (rows.length < 2) {
    throw new Error('헤더와 데이터가 포함된 파일을 업로드해주세요.')
  }

  const [header, ...bodyRows] = rows
  const normalizedHeader = header.map((cell) => String(cell ?? '').trim().toLowerCase())

  if (normalizedHeader[0] !== 'question_number' || normalizedHeader[1] !== 'passage_text') {
    throw new Error('첫 번째 열은 question_number, 두 번째 열은 passage_text 여야 합니다.')
  }

  const items = bodyRows
    .map((row, index) => ({
      questionNumber: String(row[0] ?? '').trim(),
      passageText: String(row[1] ?? '').trim(),
      sortOrder: (index + 1) * 10,
      isActive: true,
    }))
    .filter((row) => row.questionNumber || row.passageText)

  if (items.length === 0) {
    throw new Error('저장할 문항이 없습니다.')
  }

  const invalidRow = items.find((item) => !item.questionNumber || !item.passageText)
  if (invalidRow) {
    throw new Error('문항 번호와 지문 내용이 모두 채워진 행만 업로드할 수 있습니다.')
  }

  const duplicate = items.find((item, index) => items.findIndex((candidate) => candidate.questionNumber === item.questionNumber) !== index)
  if (duplicate) {
    throw new Error(`문항 번호 "${duplicate.questionNumber}"가 중복되었습니다.`)
  }

  return {
    fileName: file.name,
    items,
  }
}

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

function buildEmptyGeneratePostForm(menuEntryId: string): GeneratePostFormState {
  const { examYear, examMonth } = getDefaultExamDate()

  return {
    menuEntryId,
    title: '',
    csvFileName: '',
    csvItems: [],
    examYear,
    examMonth,
    gradeLevel: '',
    status: 'published',
    isActive: true,
  }
}

export default function GenerateProductsClient({
  generateMenuEntries: initialGenerateMenuEntries,
  initialGeneratePosts,
  initialSelectedBoardId,
  workspaceSubject,
}: GenerateProductsClientProps) {
  const router = useRouter()
  const [generateMenuEntries, setGenerateMenuEntries] = useState(initialGenerateMenuEntries)
  const [selectedBoardId, setSelectedBoardId] = useState(initialSelectedBoardId || '')
  const [generatePosts, setGeneratePosts] = useState(initialGeneratePosts)
  const [isLoadingPosts, setIsLoadingPosts] = useState(false)
  const [isPostDialogOpen, setIsPostDialogOpen] = useState(false)
  const [postForm, setPostForm] = useState<GeneratePostFormState>(buildEmptyGeneratePostForm(initialSelectedBoardId || ''))
  const [isSavingPost, setIsSavingPost] = useState(false)
  const [archivePostTarget, setArchivePostTarget] = useState<GenerateListboardPost | null>(null)
  const [selectedCsvFile, setSelectedCsvFile] = useState<File | null>(null)
  const [isCsvDragActive, setIsCsvDragActive] = useState(false)
  const [isApplyingCsv, setIsApplyingCsv] = useState(false)
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const listboardEntries = useMemo(
    () => generateMenuEntries.filter((entry) => entry.entry_type === 'listboard' && entry.deleted_at === null),
    [generateMenuEntries]
  )

  const examYearOptions = useMemo(() => {
    const candidateYears = [
      ...generatePosts.map((post) => post.exam_year).filter((value): value is number => value !== null).map(String),
      postForm.examYear,
    ]
    const baseYear = Math.max(
      ...candidateYears.map((value) => Number(value)).filter((value) => Number.isFinite(value)),
      MAX_EXAM_YEAR
    )

    return buildExamYearOptions(baseYear)
  }, [generatePosts, postForm.examYear])

  const selectedBoard = listboardEntries.find((entry) => entry.id === selectedBoardId) || listboardEntries[0] || null

  const persistGenerateEntryState = (nextEntries: GenerateMenuEntryAdminRow[]) => {
    setGenerateMenuEntries(nextEntries)
  }

  const loadBoardPosts = async (boardId: string) => {
    setSelectedBoardId(boardId)
    setIsLoadingPosts(true)
    try {
      const response = await getGenerateListboardPostsAction(boardId, workspaceSubject)
      setGeneratePosts(response.data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 목록을 불러오지 못했습니다.')
    } finally {
      setIsLoadingPosts(false)
    }
  }

  const closePostDialog = () => {
    setPostForm(buildEmptyGeneratePostForm(selectedBoard?.id || ''))
    setSelectedCsvFile(null)
    setIsCsvDragActive(false)
    setIsPostDialogOpen(false)
  }

  const openCreatePostDialog = () => {
    if (!selectedBoard) {
      toast.error('게시글을 등록할 리스트보드를 먼저 선택해주세요.')
      return
    }

    setPostForm(buildEmptyGeneratePostForm(selectedBoard.id))
    setSelectedCsvFile(null)
    setIsCsvDragActive(false)
    setIsPostDialogOpen(true)
  }

  const clearSelectedCsvFile = () => {
    setSelectedCsvFile(null)
    if (csvInputRef.current) {
      csvInputRef.current.value = ''
    }
  }

  const handleSelectedCsvFile = (file?: File | null) => {
    if (!file) {
      return
    }

    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
      toast.error('.csv 또는 .xlsx 파일만 업로드할 수 있습니다.')
      return
    }

    setSelectedCsvFile(file)
  }

  const handlePostCsvFileApply = async () => {
    if (!selectedCsvFile) {
      toast.error('업로드할 CSV/엑셀 파일을 먼저 선택해주세요.')
      return
    }

    setIsApplyingCsv(true)
    try {
      const parsed = await parseGeneratePostCsvFile(selectedCsvFile)
      setPostForm((current) => ({
        ...current,
        csvFileName: parsed.fileName,
        csvItems: parsed.items,
      }))
      toast.success(`CSV에서 ${parsed.items.length}개 문항을 불러왔습니다.`)
      clearSelectedCsvFile()
    } catch (error) {
      setPostForm((current) => ({ ...current, csvFileName: '', csvItems: [] }))
      toast.error(error instanceof Error ? error.message : 'CSV 파일을 읽지 못했습니다.')
    } finally {
      setIsApplyingCsv(false)
    }
  }

  const handleSubmitPost = async () => {
    if (!postForm.menuEntryId) {
      toast.error('리스트보드를 선택해주세요.')
      return
    }

    setIsSavingPost(true)
    try {
      if (postForm.csvItems.length === 0) {
        throw new Error('게시글 생성 시 CSV 파일 업로드가 필요합니다.')
      }

      const response = await createGenerateListboardPostWithItemsAction({
        menu_entry_id: postForm.menuEntryId,
        title: postForm.title,
        exam_year: postForm.examYear ? Number(postForm.examYear) : null,
        exam_month: postForm.examMonth ? Number(postForm.examMonth) : null,
        grade_level: postForm.gradeLevel || null,
        status: postForm.status,
        is_active: postForm.isActive,
      }, postForm.csvItems.map((item) => ({
        question_number: item.questionNumber,
        passage_text: item.passageText,
        sort_order: item.sortOrder,
        is_active: item.isActive,
      })), workspaceSubject)

      setGeneratePosts((current) => [response.data.post, ...current])
      persistGenerateEntryState(generateMenuEntries.map((entry) => entry.id === postForm.menuEntryId ? { ...entry, postCount: entry.postCount + 1 } : entry))
      toast.success(`게시글과 ${response.data.items.length}개 문항을 등록했습니다.`)
      closePostDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 저장에 실패했습니다.')
    } finally {
      setIsSavingPost(false)
    }
  }

  const handleArchivePost = async () => {
    if (!archivePostTarget) return

    setIsSavingPost(true)
    try {
      await archiveGenerateListboardPostAction(archivePostTarget.id, workspaceSubject)
      setGeneratePosts((current) => current.filter((post) => post.id !== archivePostTarget.id))
      persistGenerateEntryState(generateMenuEntries.map((entry) => entry.id === archivePostTarget.menu_entry_id ? { ...entry, postCount: Math.max(0, entry.postCount - 1) } : entry))
      setArchivePostTarget(null)
      toast.success('게시글을 보관 처리했습니다.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '게시글 보관에 실패했습니다.')
    } finally {
      setIsSavingPost(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">문제생성 상품 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
          <p className="mt-1 text-gray-500">문제생성 2단계 리스트보드 메뉴별 게시글과 문항 행을 운영합니다.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>리스트보드 게시글 관리</CardTitle>
            <CardDescription>선택한 문제생성 리스트보드에 등록된 지문/글을 관리합니다.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedBoard?.id || ''}
              onChange={(event) => void loadBoardPosts(event.target.value)}
              className="flex h-10 min-w-[200px] rounded-md border bg-white px-3 text-sm"
            >
              {listboardEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title}</option>
              ))}
            </select>
            <Button onClick={openCreatePostDialog} disabled={!selectedBoard}>
              <Plus className="mr-2 h-4 w-4" />게시글 추가
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedBoard ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-gray-500">리스트보드 메뉴를 먼저 생성해주세요.</div>
          ) : isLoadingPosts ? (
            <div className="flex items-center justify-center py-10 text-gray-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />게시글 로딩 중...</div>
          ) : generatePosts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-gray-500">등록된 게시글이 없습니다.</div>
          ) : (
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>년도</TableHead>
                    <TableHead>월</TableHead>
                    <TableHead>학년</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">관리</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generatePosts.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{post.title}</div>
                          <p className="line-clamp-1 text-xs text-gray-500">{post.passage_text}</p>
                        </div>
                      </TableCell>
                      <TableCell>{post.exam_year ?? '-'}</TableCell>
                      <TableCell>{post.exam_month ?? '-'}</TableCell>
                      <TableCell>{post.grade_level ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={post.status === 'published' ? 'secondary' : 'outline'}>{post.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => router.push(withAdminWorkspaceSubject(`/admin/generate/products/${post.id}/edit`, workspaceSubject))}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={() => setArchivePostTarget(post)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isPostDialogOpen} onOpenChange={(open) => !open && closePostDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>리스트보드 게시글 추가</DialogTitle>
            <DialogDescription>교재형 문제생성에 사용할 지문/메타데이터를 관리합니다.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>대상 리스트보드</Label>
                <select value={postForm.menuEntryId} onChange={(event) => setPostForm((current) => ({ ...current, menuEntryId: event.target.value }))} className="flex h-10 w-full rounded-md border bg-white px-3 text-sm">
                  {listboardEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="post-title">제목</Label>
                <Input id="post-title" value={postForm.title} onChange={(event) => setPostForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
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
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="post-csv-file">CSV / 엑셀 업로드</Label>
                <input
                  ref={csvInputRef}
                  id="post-csv-file"
                  type="file"
                  accept={CSV_ACCEPT_VALUE}
                  className="hidden"
                  disabled={isApplyingCsv}
                  onChange={(event) => handleSelectedCsvFile(event.target.files?.[0])}
                />
                <div
                  role="button"
                  tabIndex={isApplyingCsv ? -1 : 0}
                  onClick={() => {
                    if (isApplyingCsv) return
                    if (!csvInputRef.current) return
                    csvInputRef.current.value = ''
                    csvInputRef.current.click()
                  }}
                  onKeyDown={(event) => {
                    if (isApplyingCsv) return
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    if (!csvInputRef.current) return
                    csvInputRef.current.value = ''
                    csvInputRef.current.click()
                  }}
                  onDragEnter={(event) => {
                    if (isApplyingCsv) return
                    event.preventDefault()
                    setIsCsvDragActive(true)
                  }}
                  onDragOver={(event) => {
                    if (isApplyingCsv) return
                    event.preventDefault()
                    setIsCsvDragActive(true)
                  }}
                  onDragLeave={(event) => {
                    if (isApplyingCsv) return
                    event.preventDefault()
                    setIsCsvDragActive(false)
                  }}
                  onDrop={(event) => {
                    if (isApplyingCsv) return
                    event.preventDefault()
                    setIsCsvDragActive(false)
                    const droppedFiles = Array.from(event.dataTransfer.files || [])
                    if (droppedFiles.length === 0) return
                    if (droppedFiles.length > 1) {
                      toast.message('여러 파일이 드롭되었지만 첫 번째 파일만 선택합니다.')
                    }
                    handleSelectedCsvFile(droppedFiles[0])
                  }}
                  className={`rounded-md border border-dashed px-4 py-4 text-left transition ${
                    isApplyingCsv
                      ? 'cursor-not-allowed bg-gray-50 text-gray-400'
                      : isCsvDragActive
                        ? 'border-primary bg-primary/5'
                        : selectedCsvFile
                          ? 'border-emerald-300 bg-emerald-50/60'
                          : 'cursor-pointer hover:border-primary/50 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-medium text-gray-900">
                    {isCsvDragActive
                      ? '여기에 파일을 놓으세요.'
                      : '파일을 드래그하여 놓거나, 파일선택 버튼으로 업로드할 파일을 고르세요.'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {selectedCsvFile
                      ? `선택 파일: ${selectedCsvFile.name}`
                      : '첫 번째 열은 question_number, 두 번째 열은 passage_text 형식이어야 합니다.'}
                  </p>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:justify-end">
                  <Button type="button" variant="outline" asChild>
                    <a href="/samples/generate-listboard-posts-sample.csv" download>
                      <Download className="mr-2 h-4 w-4" />
                      CSV/엑셀 샘플파일
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isApplyingCsv}
                    onClick={() => {
                      if (!csvInputRef.current) return
                      csvInputRef.current.value = ''
                      csvInputRef.current.click()
                    }}
                  >
                    파일선택
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    disabled={!selectedCsvFile || isApplyingCsv}
                    onClick={() => void handlePostCsvFileApply()}
                  >
                    {isApplyingCsv ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                    업로드
                  </Button>
                </div>
              </div>

              <div className="rounded-md border bg-gray-50 px-3 py-3 text-sm text-gray-700">
                {postForm.csvItems.length > 0 ? (
                  <div className="space-y-1">
                    <p><span className="font-medium">업로드 파일:</span> {postForm.csvFileName}</p>
                    <p><span className="font-medium">문항 수:</span> {postForm.csvItems.length}개</p>
                    <p className="text-xs text-gray-500">미리보기: {postForm.csvItems.slice(0, 5).map((item) => item.questionNumber).join(', ')}{postForm.csvItems.length > 5 ? ' ...' : ''}</p>
                  </div>
                ) : (
                  <p>아직 업로드된 파일이 없습니다.</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-md border px-3 py-2">
              <Switch checked={postForm.isActive} onCheckedChange={(checked) => setPostForm((current) => ({ ...current, isActive: checked }))} />
              <span className="text-sm text-gray-700">활성 상태 유지</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closePostDialog}>취소</Button>
            <Button onClick={handleSubmitPost} disabled={isSavingPost}>
              {isSavingPost ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archivePostTarget} onOpenChange={(open) => !open && setArchivePostTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>게시글을 보관할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium">[{archivePostTarget?.title}]</span> 게시글은 사용자 화면에서 숨겨집니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleArchivePost}>보관</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
