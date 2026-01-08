'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Edit,
  Trash2,
  Eye,
  Upload,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'

interface Question {
  id: string
  question_text: string
  question_text_forward: string | null
  question_text_backward: string | null
  choices: Array<{ label: string; text: string }>
  answer: string
  explanation: string | null
  passage_text: string | null
  grade_level: string | null
  difficulty: string | null
  source: string | null
  created_at: string
  updated_at: string
  problem_type_id: string | null
  problem_types: { type_name: string } | null
  profiles: { id: string; name: string | null; email: string | null } | null
}

interface ProblemType {
  id: string
  type_name: string
}

interface QuestionsClientProps {
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
}

export function QuestionsClient({
  problemTypes,
  gradeLevels,
  difficulties,
}: QuestionsClientProps) {
  const router = useRouter()
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  const [gradeLevel, setGradeLevel] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [problemTypeId, setProblemTypeId] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortOrder, setSortOrder] = useState('desc')

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; question: Question | null }>({
    open: false,
    question: null,
  })
  const [deleting, setDeleting] = useState(false)

  // Preview dialog
  const [previewDialog, setPreviewDialog] = useState<{ open: boolean; question: Question | null }>({
    open: false,
    question: null,
  })

  const fetchQuestions = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sort_by: sortBy,
        sort_order: sortOrder,
      })

      if (search) params.set('search', search)
      if (gradeLevel) params.set('grade_level', gradeLevel)
      if (difficulty) params.set('difficulty', difficulty)
      if (problemTypeId) params.set('problem_type_id', problemTypeId)

      const response = await fetch(`/api/admin/questions?${params}`)
      if (!response.ok) throw new Error('Failed to fetch')
      
      const data = await response.json()
      setQuestions(data.questions)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching questions:', error)
    } finally {
      setLoading(false)
    }
  }, [pagination.page, pagination.limit, search, gradeLevel, difficulty, problemTypeId, sortBy, sortOrder])

  useEffect(() => {
    fetchQuestions()
  }, [fetchQuestions])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPagination(prev => ({ ...prev, page: 1 }))
    fetchQuestions()
  }

  const handleDelete = async () => {
    if (!deleteDialog.question) return

    try {
      setDeleting(true)
      const response = await fetch(`/api/admin/questions/${deleteDialog.question.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete')

      setDeleteDialog({ open: false, question: null })
      fetchQuestions()
    } catch (error) {
      console.error('Error deleting question:', error)
      alert('문제 삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setGradeLevel('')
    setDifficulty('')
    setProblemTypeId('')
    setSortBy('created_at')
    setSortOrder('desc')
    setPagination(prev => ({ ...prev, page: 1 }))
  }

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="문제 텍스트로 검색..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit">검색</Button>
        </form>

        <div className="flex gap-2">
          <Button variant="outline" onClick={resetFilters}>
            <RefreshCw className="h-4 w-4 mr-2" />
            필터 초기화
          </Button>
          <Link href="/admin/questions/upload">
            <Button>
              <Upload className="h-4 w-4 mr-2" />
              문제 업로드
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">필터</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Select value={gradeLevel || "__all__"} onValueChange={(v) => setGradeLevel(v === "__all__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="학년" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체 학년</SelectItem>
                {gradeLevels.map((level) => (
                  <SelectItem key={level} value={level}>{level}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={difficulty || "__all__"} onValueChange={(v) => setDifficulty(v === "__all__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="난이도" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체 난이도</SelectItem>
                {difficulties.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={problemTypeId || "__all__"} onValueChange={(v) => setProblemTypeId(v === "__all__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="문제 유형" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">전체 유형</SelectItem>
                {problemTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.type_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger>
                <SelectValue placeholder="정렬 기준" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at">생성일</SelectItem>
                <SelectItem value="updated_at">수정일</SelectItem>
                <SelectItem value="grade_level">학년</SelectItem>
                <SelectItem value="difficulty">난이도</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger>
                <SelectValue placeholder="정렬 순서" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">최신순</SelectItem>
                <SelectItem value="asc">오래된순</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Questions List */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto text-gray-400" />
              <p className="text-gray-500 mt-2">로딩 중...</p>
            </div>
          ) : questions.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-500">조건에 맞는 문제가 없습니다.</p>
            </div>
          ) : (
            <div className="divide-y">
              {questions.map((question) => (
                <div key={question.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 line-clamp-2">
                        {question.question_text}
                      </p>
                      {question.passage_text && (
                        <p className="text-sm text-gray-500 mt-1 line-clamp-1">
                          지문: {question.passage_text}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        <span>
                          업로더: {question.profiles?.name || question.profiles?.email || '알 수 없음'}
                        </span>
                        <span>•</span>
                        <span>{new Date(question.created_at).toLocaleDateString('ko-KR')}</span>
                        {question.source && (
                          <>
                            <span>•</span>
                            <span>출처: {question.source}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {question.grade_level && (
                        <Badge variant="secondary">{question.grade_level}</Badge>
                      )}
                      {question.difficulty && (
                        <Badge
                          variant="outline"
                          className={
                            question.difficulty === '상'
                              ? 'border-red-300 text-red-600'
                              : question.difficulty === '중'
                              ? 'border-yellow-300 text-yellow-600'
                              : 'border-green-300 text-green-600'
                          }
                        >
                          {question.difficulty}
                        </Badge>
                      )}
                      {question.problem_types && (
                        <Badge variant="outline" className="border-blue-300 text-blue-600">
                          {question.problem_types.type_name}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPreviewDialog({ open: true, question })}
                        title="미리보기"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push(`/admin/questions/${question.id}`)}
                        title="수정"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteDialog({ open: true, question })}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            총 {pagination.total}개 중 {(pagination.page - 1) * pagination.limit + 1}-
            {Math.min(pagination.page * pagination.limit, pagination.total)}개 표시
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
            >
              <ChevronLeft className="h-4 w-4" />
              이전
            </Button>
            <span className="text-sm text-gray-600 px-2">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.totalPages}
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
            >
              다음
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, question: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제 삭제</DialogTitle>
            <DialogDescription>
              이 문제를 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          {deleteDialog.question && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700 line-clamp-3">
                {deleteDialog.question.question_text}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, question: null })}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={previewDialog.open} onOpenChange={(open) => setPreviewDialog({ open, question: null })}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문제 미리보기</DialogTitle>
          </DialogHeader>
          {previewDialog.question && (
            <div className="space-y-4">
              {previewDialog.question.passage_text && (
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-blue-800 mb-2">지문</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {previewDialog.question.passage_text}
                  </p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">문제</p>
                <p className="text-gray-700">{previewDialog.question.question_text}</p>
              </div>

              {previewDialog.question.question_text_forward && (
                <div>
                  <p className="text-sm font-medium text-gray-800 mb-2">문제 (앞부분)</p>
                  <p className="text-gray-700">{previewDialog.question.question_text_forward}</p>
                </div>
              )}

              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">선택지</p>
                <div className="space-y-2">
                  {previewDialog.question.choices.map((choice, idx) => (
                    <div
                      key={idx}
                      className={`p-2 rounded ${
                        choice.label === previewDialog.question?.answer
                          ? 'bg-green-100 border border-green-300'
                          : 'bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{choice.label}.</span> {choice.text}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-800 mb-2">정답</p>
                <Badge className="bg-green-500">{previewDialog.question.answer}</Badge>
              </div>

              {previewDialog.question.explanation && (
                <div>
                  <p className="text-sm font-medium text-gray-800 mb-2">해설</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {previewDialog.question.explanation}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-2 border-t">
                {previewDialog.question.grade_level && (
                  <Badge variant="secondary">{previewDialog.question.grade_level}</Badge>
                )}
                {previewDialog.question.difficulty && (
                  <Badge variant="outline">{previewDialog.question.difficulty}</Badge>
                )}
                {previewDialog.question.problem_types && (
                  <Badge variant="outline">{previewDialog.question.problem_types.type_name}</Badge>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewDialog({ open: false, question: null })}>
              닫기
            </Button>
            {previewDialog.question && (
              <Button onClick={() => {
                router.push(`/admin/questions/${previewDialog.question?.id}`)
                setPreviewDialog({ open: false, question: null })
              }}>
                수정하기
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

