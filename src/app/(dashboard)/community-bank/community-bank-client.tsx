'use client'

import { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Trash2, Edit, X, Plus } from 'lucide-react'
import { Database } from '@/types/supabase'
import { useRouter } from 'next/navigation'

type DBQuestion = Database['public']['Tables']['questions']['Row'] & {
  problem_types: { type_name: string } | null
}

type ProblemType = {
  id: string
  type_name: string
}

interface CommunityBankClientProps {
  initialQuestions?: DBQuestion[]
  problemTypes?: ProblemType[]
  gradeLevels?: string[]
  difficulties?: string[]
  isAdmin?: boolean
}

export default function CommunityBankClient({ 
  initialQuestions = [], 
  problemTypes = [], 
  gradeLevels = [], 
  difficulties = [],
  isAdmin = false 
}: CommunityBankClientProps) {
  const router = useRouter()
  const [questions, setQuestions] = useState<DBQuestion[]>(initialQuestions)
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all')
  const [selectedGrade, setSelectedGrade] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest')
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null)
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([])
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [isBulkConfirmDialogOpen, setIsBulkConfirmDialogOpen] = useState(false)
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null)
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<DBQuestion | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editFormData, setEditFormData] = useState({
    question_text: '',
    passage_text: '',
    answer: '',
    choices: ['', '', '', '', ''],
    explanation: '',
    difficulty: undefined as string | undefined,
    grade_level: undefined as string | undefined,
    problem_type_id: '',
  })
  
  // Sync local state with server data when props change
  useEffect(() => {
    setQuestions(initialQuestions)
  }, [initialQuestions])
  
  // Filter and sort questions
  const filteredQuestions = useMemo(() => {
    let result = questions.filter(question => {
      if (selectedTypeId !== 'all' && question.problem_type_id !== selectedTypeId) {
        return false
      }
      if (selectedGrade !== 'all' && question.grade_level !== selectedGrade) {
        return false
      }
      if (selectedDifficulty !== 'all' && question.difficulty !== selectedDifficulty) {
        return false
      }
      return true
    })
    
    result.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime()
      const dateB = new Date(b.created_at).getTime()
      return sortBy === 'latest' ? dateB - dateA : dateA - dateB
    })
    
    return result
  }, [questions, selectedTypeId, selectedGrade, selectedDifficulty, sortBy])
  
  const handleReset = () => {
    setSelectedTypeId('all')
    setSelectedGrade('all')
    setSelectedDifficulty('all')
    setSortBy('latest')
  }
  
  const handleSaveQuestionClick = (questionId: string) => {
    setPendingQuestionId(questionId)
    setIsConfirmDialogOpen(true)
  }
  
  const handleSaveQuestion = async () => {
    if (!pendingQuestionId) return
    
    setSavingQuestionId(pendingQuestionId)
    setIsConfirmDialogOpen(false)
    
    try {
      const response = await fetch('/api/questions/save-from-community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: pendingQuestionId }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '문제 가져오기에 실패했습니다.')
      }
      
      toast.success('문제를 내 문제 은행으로 가져왔습니다!')
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSavingQuestionId(null)
      setPendingQuestionId(null)
    }
  }
  
  const handleBulkSaveClick = () => {
    if (selectedQuestions.length === 0) {
      toast.error('가져올 문제를 선택해주세요.')
      return
    }
    setIsBulkConfirmDialogOpen(true)
  }
  
  const handleBulkSaveQuestions = async () => {
    if (selectedQuestions.length === 0) return
    
    setIsBulkSaving(true)
    setIsBulkConfirmDialogOpen(false)
    
    try {
      const response = await fetch('/api/questions/save-from-community', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_ids: selectedQuestions }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '문제 가져오기에 실패했습니다.')
      }
      
      const result = await response.json()
      const savedCount = result.saved_count || 0
      const skippedCount = result.skipped_count || 0
      
      if (skippedCount > 0) {
        toast.success(`${savedCount}개의 문제를 가져왔습니다. (${skippedCount}개는 이미 저장된 문제입니다.)`)
      } else {
        toast.success(`${savedCount}개의 문제를 가져왔습니다!`)
      }
      
      setSelectedQuestions([])
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsBulkSaving(false)
    }
  }
  
  const handleToggleQuestion = (questionId: string) => {
    setSelectedQuestions(prev => 
      prev.includes(questionId) 
        ? prev.filter(id => id !== questionId)
        : [...prev, questionId]
    )
  }
  
  const handleToggleAll = () => {
    if (selectedQuestions.length === filteredQuestions.length) {
      setSelectedQuestions([])
    } else {
      setSelectedQuestions(filteredQuestions.map(q => q.id))
    }
  }
  
  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm('이 문제를 삭제하시겠습니까?')) return
    
    setDeletingQuestionId(questionId)
    
    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        throw new Error('문제 삭제에 실패했습니다.')
      }
      
      // 로컬 상태에서 즉시 제거
      setQuestions(prev => prev.filter(q => q.id !== questionId))
      toast.success('문제가 삭제되었습니다.')
      
      // 백그라운드에서 서버 데이터 동기화
      router.refresh()
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setDeletingQuestionId(null)
    }
  }
  
  const handleDeleteSelected = async () => {
    if (selectedQuestions.length === 0) {
      toast.error('삭제할 문제를 선택해주세요.')
      return
    }
    
    if (!confirm(`선택한 ${selectedQuestions.length}개의 문제를 삭제하시겠습니까?`)) return
    
    try {
      const results = await Promise.all(
        selectedQuestions.map(id => 
          fetch(`/api/admin/questions/${id}`, { method: 'DELETE' })
        )
      )
      
      const successIds = selectedQuestions.filter((id, index) => results[index].ok)
      const failedCount = results.filter(r => !r.ok).length
      
      // 성공한 문제들만 로컬 상태에서 제거
      if (successIds.length > 0) {
        setQuestions(prev => prev.filter(q => !successIds.includes(q.id)))
      }
      
      if (failedCount > 0) {
        toast.error(`${failedCount}개의 문제 삭제에 실패했습니다.`)
      } else {
        toast.success(`${selectedQuestions.length}개의 문제가 삭제되었습니다.`)
      }
      
      setSelectedQuestions([])
      
      // 백그라운드에서 서버 데이터 동기화
      router.refresh()
      
    } catch (error: any) {
      toast.error('문제 삭제 중 오류가 발생했습니다.')
    }
  }
  
  const handleEditQuestion = (question: DBQuestion) => {
    setEditingQuestion(question)
    
    // Parse choices - handle both formats
    let parsedChoices = ['', '', '', '', '']
    if (Array.isArray(question.choices)) {
      parsedChoices = question.choices.map((choice: any) => {
        if (typeof choice === 'string') {
          return choice
        } else if (choice.text) {
          return choice.text
        }
        return ''
      })
      // Ensure we have at least 5 slots
      while (parsedChoices.length < 5) {
        parsedChoices.push('')
      }
    }
    
    setEditFormData({
      question_text: question.question_text || '',
      passage_text: question.passage_text || '',
      answer: question.answer || '',
      choices: parsedChoices,
      explanation: question.explanation || '',
      difficulty: question.difficulty || undefined,
      grade_level: question.grade_level || undefined,
      problem_type_id: question.problem_type_id || '',
    })
    
    setIsEditDialogOpen(true)
  }
  
  const handleEditSelected = () => {
    if (selectedQuestions.length === 0) {
      toast.error('수정할 문제를 선택해주세요.')
      return
    }
    
    if (selectedQuestions.length > 1) {
      toast.error('한 번에 하나의 문제만 수정할 수 있습니다.')
      return
    }
    
    const questionToEdit = questions.find(q => q.id === selectedQuestions[0])
    if (!questionToEdit) return
    
    handleEditQuestion(questionToEdit)
  }
  
  const handleChoiceChange = (index: number, value: string) => {
    const newChoices = [...editFormData.choices]
    newChoices[index] = value
    setEditFormData({ ...editFormData, choices: newChoices })
  }
  
  const addChoice = () => {
    setEditFormData({
      ...editFormData,
      choices: [...editFormData.choices, '']
    })
  }
  
  const removeChoice = (index: number) => {
    if (editFormData.choices.length <= 5) {
      toast.error('최소 5개의 선택지가 필요합니다.')
      return
    }
    const newChoices = editFormData.choices.filter((_, i) => i !== index)
    setEditFormData({ ...editFormData, choices: newChoices })
  }
  
  const handleUpdateQuestion = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingQuestion) return
    
    setIsSubmitting(true)
    
    try {
      // Validate
      if (!editFormData.question_text.trim()) {
        throw new Error('문제 내용을 입력해주세요.')
      }
      if (!editFormData.answer.trim()) {
        throw new Error('정답을 입력해주세요.')
      }
      if (!editFormData.problem_type_id) {
        throw new Error('문제 유형을 선택해주세요.')
      }
      
      const validChoices = editFormData.choices.filter(c => c.trim())
      if (validChoices.length < 5) {
        throw new Error('5개의 선택지를 모두 입력해주세요.')
      }
      
      // Convert number labels to circled numbers
      const circledNumbers = ['①', '②', '③', '④', '⑤']
      
      // Format choices with circled numbers (AI format)
      const formattedChoices = validChoices.map((choice, index) => ({
        label: circledNumbers[index],
        text: choice
      }))
      
      // Convert answer (if it's a number 1-5, convert to circled number)
      let formattedAnswer = editFormData.answer.trim()
      const answerNum = parseInt(formattedAnswer)
      if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
        formattedAnswer = circledNumbers[answerNum - 1]
      }
      
      const response = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: editFormData.question_text,
          passage_text: editFormData.passage_text || undefined,
          answer: formattedAnswer,
          choices: formattedChoices,
          explanation: editFormData.explanation || undefined,
          difficulty: editFormData.difficulty || undefined,
          grade_level: editFormData.grade_level || undefined,
          problem_type_id: editFormData.problem_type_id,
        }),
      })
      
      if (!response.ok) {
        throw new Error('문제 수정에 실패했습니다.')
      }
      
      const { question: updatedQuestion } = await response.json()
      
      // 로컬 상태에서 즉시 업데이트
      setQuestions(prev => prev.map(q => 
        q.id === editingQuestion.id 
          ? { ...q, ...updatedQuestion }
          : q
      ))
      
      toast.success('문제가 성공적으로 수정되었습니다.')
      setIsEditDialogOpen(false)
      setEditingQuestion(null)
      setSelectedQuestions([])
      
      // 백그라운드에서 서버 데이터 동기화
      router.refresh()
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  return (
    <div>
      {/* Filter Section */}
      <div className="bg-white border rounded-lg p-6 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">필터</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Problem Type Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              문제 유형
            </label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {problemTypes.map(type => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.type_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Grade Level Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              학년
            </label>
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {gradeLevels.map(grade => (
                  <SelectItem key={grade} value={grade}>
                    {grade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Difficulty Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              난이도
            </label>
            <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {difficulties.map(difficulty => (
                  <SelectItem key={difficulty} value={difficulty}>
                    {difficulty}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Sort Filter */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              정렬
            </label>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'latest' | 'oldest')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">최신순</SelectItem>
                <SelectItem value="oldest">오래된 순</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Reset Button */}
          <div className="flex items-end">
            <Button 
              variant="outline" 
              onClick={handleReset}
              className="w-full"
            >
              초기화
            </Button>
          </div>
        </div>
        
        {/* Results Count */}
        <div className="mt-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            총 <span className="font-semibold text-primary">{filteredQuestions.length}</span>개의 문제
            {filteredQuestions.length !== questions.length && (
              <span className="text-gray-500"> (전체 {questions.length}개 중)</span>
            )}
          </div>
          
          {/* Actions - Admin and User */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleAll}
            >
              {selectedQuestions.length === filteredQuestions.length ? '전체 해제' : '전체 선택'}
            </Button>
            {selectedQuestions.length > 0 && (
              <>
                {/* 일괄 가져오기 버튼 (모든 사용자) */}
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleBulkSaveClick}
                  disabled={isBulkSaving}
                >
                  {isBulkSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  일괄 가져오기 ({selectedQuestions.length})
                </Button>
                {/* 관리자 전용 버튼 */}
                {isAdmin && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleEditSelected}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      선택 수정 ({selectedQuestions.length})
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteSelected}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      선택 삭제 ({selectedQuestions.length})
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Question List */}
      <div className="space-y-4">
        {filteredQuestions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 mb-2">
                {questions.length === 0 
                  ? '아직 커뮤니티에 공유된 문제가 없습니다.' 
                  : '선택한 필터 조건에 맞는 문제가 없습니다.'}
              </p>
              {isAdmin && questions.length === 0 && (
                <p className="text-sm text-gray-400">
                  관리자 업로드 페이지에서 문제를 등록해주세요.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredQuestions.map((question) => (
            <Card key={question.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start gap-4">
                  {/* Checkbox (for both admin and regular users) */}
                  <div className="pt-1">
                    <Checkbox
                      checked={selectedQuestions.includes(question.id)}
                      onCheckedChange={() => handleToggleQuestion(question.id)}
                    />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex gap-2 mb-2">
                      <Badge variant="secondary">
                        {question.problem_types?.type_name || '미분류'}
                      </Badge>
                      {question.grade_level && (
                        <Badge variant="outline">{question.grade_level}</Badge>
                      )}
                      {question.difficulty && (
                        <Badge variant="outline">{question.difficulty}</Badge>
                      )}
                    </div>
                    <CardTitle className="text-lg">{question.question_text}</CardTitle>
                  </div>
                  
                  <div className="flex gap-2">
                    {/* 가져오기 버튼 (모든 사용자) */}
                    <Button
                      onClick={() => handleSaveQuestionClick(question.id)}
                      disabled={savingQuestionId === question.id}
                      size="sm"
                      className="bg-primary hover:bg-primary/90"
                    >
                      {savingQuestionId === question.id && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      가져오기
                    </Button>
                    
                    {/* Admin Edit and Delete Buttons */}
                    {isAdmin && (
                      <>
                        <Button
                          onClick={() => handleEditQuestion(question)}
                          variant="outline"
                          size="sm"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          onClick={() => handleDeleteQuestion(question.id)}
                          disabled={deletingQuestionId === question.id}
                          variant="destructive"
                          size="sm"
                        >
                          {deletingQuestionId === question.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* 지문 섹션: question_text_forward, passage_text, question_text_backward 통합 */}
                {(question.question_text_forward || question.passage_text || question.question_text_backward) && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-2">지문</p>
                    <div className="space-y-3">
                      {question.question_text_forward && (
                        <p className="text-sm whitespace-pre-wrap text-gray-700">{question.question_text_forward}</p>
                      )}
                      {question.passage_text && (
                        <>
                          {question.question_text_forward && (
                            <div className="flex justify-center my-2">
                              <span className="text-2xl text-gray-400">↓</span>
                            </div>
                          )}
                          <p className="text-sm whitespace-pre-wrap">{question.passage_text}</p>
                        </>
                      )}
                      {question.question_text_backward && (
                        <>
                          {(question.question_text_forward || question.passage_text) && (
                            <div className="flex justify-center my-2">
                              <span className="text-2xl text-gray-400">↓</span>
                            </div>
                          )}
                          <p className="text-sm whitespace-pre-wrap text-gray-700">{question.question_text_backward}</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">선택지</p>
                    <ul className="space-y-1">
                      {Array.isArray(question.choices) && question.choices.map((choice: any, index: number) => {
                        // Handle both formats: string[] or {label, text}[]
                        const choiceText = typeof choice === 'string' 
                          ? choice 
                          : `${choice.label || ''} ${choice.text || ''}`.trim()
                        return (
                          <li key={index} className="text-sm">{choiceText}</li>
                        )
                      })}
                    </ul>
                  </div>
                  
                  <div>
                    <p className="text-sm font-medium text-gray-700">정답</p>
                    <p className="text-sm text-green-600 font-semibold">{question.answer}</p>
                  </div>
                  
                  {question.explanation && (
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">해설</p>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap">{question.explanation}</p>
                    </div>
                  )}
                </div>
                
                <CardDescription className="mt-4 text-xs">
                  생성일: {new Date(question.created_at).toLocaleDateString('ko-KR')}
                </CardDescription>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      
      {/* Edit Question Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문제 수정</DialogTitle>
            <DialogDescription>
              관리자 권한으로 커뮤니티 문제를 수정합니다.
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleUpdateQuestion} className="space-y-6">
            {/* Problem Type */}
            <div className="space-y-2">
              <Label htmlFor="problem_type_id">문제 유형 *</Label>
              <Select 
                value={editFormData.problem_type_id} 
                onValueChange={(value) => setEditFormData({ ...editFormData, problem_type_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="문제 유형 선택" />
                </SelectTrigger>
                <SelectContent>
                  {problemTypes.map(type => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.type_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Grade Level */}
            <div className="space-y-2">
              <Label htmlFor="grade_level">학년</Label>
              <Select 
                value={editFormData.grade_level || undefined} 
                onValueChange={(value) => setEditFormData({ ...editFormData, grade_level: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="학년 선택" />
                </SelectTrigger>
                <SelectContent>
                  {['중1', '중2', '중3', '고1', '고2', '고3'].map(grade => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Difficulty */}
            <div className="space-y-2">
              <Label htmlFor="difficulty">난이도</Label>
              <Select 
                value={editFormData.difficulty || undefined} 
                onValueChange={(value) => setEditFormData({ ...editFormData, difficulty: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="난이도 선택" />
                </SelectTrigger>
                <SelectContent>
                  {['하', '중', '상'].map(diff => (
                    <SelectItem key={diff} value={diff}>
                      {diff}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Passage */}
            <div className="space-y-2">
              <Label htmlFor="passage_text">지문</Label>
              <Textarea
                id="passage_text"
                placeholder="영어 지문을 입력하세요..."
                className="min-h-[150px] font-mono text-sm"
                value={editFormData.passage_text}
                onChange={(e) => setEditFormData({ ...editFormData, passage_text: e.target.value })}
                maxLength={3000}
              />
            </div>
            
            {/* Question Text */}
            <div className="space-y-2">
              <Label htmlFor="question_text">문제 내용 *</Label>
              <Textarea
                id="question_text"
                placeholder="문제 내용을 입력하세요..."
                className="min-h-[100px]"
                value={editFormData.question_text}
                onChange={(e) => setEditFormData({ ...editFormData, question_text: e.target.value })}
                required
              />
            </div>
            
            {/* Choices */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>선택지 *</Label>
                <Button type="button" variant="outline" size="sm" onClick={addChoice}>
                  <Plus className="h-4 w-4 mr-1" />
                  선택지 추가
                </Button>
              </div>
              <div className="space-y-2">
                {editFormData.choices.map((choice, index) => {
                  const circledNumbers = ['①', '②', '③', '④', '⑤']
                  return (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder={`${circledNumbers[index]} 선택지 내용`}
                        value={choice}
                        onChange={(e) => handleChoiceChange(index, e.target.value)}
                      />
                      {editFormData.choices.length > 5 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeChoice(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            {/* Answer */}
            <div className="space-y-2">
              <Label htmlFor="answer">정답 * (1-5 숫자 또는 ①-⑤)</Label>
              <Input
                id="answer"
                placeholder="예: 3 또는 ③"
                value={editFormData.answer}
                onChange={(e) => setEditFormData({ ...editFormData, answer: e.target.value })}
                required
              />
            </div>
            
            {/* Explanation */}
            <div className="space-y-2">
              <Label htmlFor="explanation">해설</Label>
              <Textarea
                id="explanation"
                placeholder="해설을 입력하세요..."
                className="min-h-[100px]"
                value={editFormData.explanation}
                onChange={(e) => setEditFormData({ ...editFormData, explanation: e.target.value })}
              />
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={isSubmitting}
              >
                취소
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                수정 완료
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      
      {/* Confirm Save Dialog */}
      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문제 가져오기 확인</DialogTitle>
            <DialogDescription>
              문제를 가져올까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsConfirmDialogOpen(false)
                setPendingQuestionId(null)
              }}
            >
              취소
            </Button>
            <Button
              onClick={handleSaveQuestion}
              disabled={savingQuestionId !== null}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Bulk Save Confirm Dialog */}
      <Dialog open={isBulkConfirmDialogOpen} onOpenChange={setIsBulkConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>일괄 가져오기 확인</DialogTitle>
            <DialogDescription>
              선택한 {selectedQuestions.length}개의 문제를 가져올까요?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsBulkConfirmDialogOpen(false)}
            >
              취소
            </Button>
            <Button
              onClick={handleBulkSaveQuestions}
              disabled={isBulkSaving}
            >
              {isBulkSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

