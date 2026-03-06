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
import { CreditConfirmationDialog } from '@/components/features/credits/credit-confirmation-dialog'
import { normalizeQuestionTextBackward } from '@/lib/questions/normalize-question-field'

type DBQuestion = Database['public']['Tables']['questions']['Row'] & {
  problem_types: { type_name: string } | null
  source_type?: string | null
  source_1?: string | null
  source_2?: string | null
  source_3?: string | null
  source_4?: string | null
}

type ProblemType = {
  id: string
  type_name: string
}

interface SourceConfig {
  id: string
  type_name: string
  source_1_label?: string | null
  source_1_options?: string[] | null
  source_2_label?: string | null
  source_2_options?: string[] | null
  source_3_label?: string | null
  source_3_options?: string[] | null
  source_4_label?: string | null
  source_4_options?: string[] | null
}

interface BankClientProps {
  initialQuestions?: DBQuestion[]
  problemTypes?: ProblemType[]
  gradeLevels?: string[]
  difficulties?: string[]
  isAdmin?: boolean
}

export default function BankClient({
  initialQuestions = [],
  problemTypes = [],
  gradeLevels = [],
  difficulties = [],
  isAdmin = false
}: BankClientProps) {
  const router = useRouter()
  const [questions, setQuestions] = useState<DBQuestion[]>(initialQuestions)
  const [selectedTypeId, setSelectedTypeId] = useState<string>('all')
  const [selectedGrade, setSelectedGrade] = useState<string>('all')
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all')
  const [selectedSourceType, setSelectedSourceType] = useState<string>('')
  const [selectedSource1, setSelectedSource1] = useState<string>('all')
  const [selectedSource2, setSelectedSource2] = useState<string>('all')
  const [selectedSource3, setSelectedSource3] = useState<string>('all')
  const [selectedSource4, setSelectedSource4] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'latest' | 'oldest'>('latest')
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null)
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([])
  const [deletingQuestionId, setDeletingQuestionId] = useState<string | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

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

  // Source Configs
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>([])

  // Fetch source configs
  useEffect(() => {
    const fetchSourceConfigs = async () => {
      try {
        const response = await fetch('/api/admin/source-configs')
        if (response.ok) {
          const data = await response.json()
          setSourceConfigs(data.configs || [])
        }
      } catch (error) {
        console.error('Failed to fetch source configs:', error)
      }
    }
    fetchSourceConfigs()
  }, [])

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
      if (selectedSourceType && (!question.source_type || !question.source_type.includes(selectedSourceType))) {
        return false
      }
      if (selectedSource1 !== 'all' && (!question.source_1 || !question.source_1.includes(selectedSource1))) {
        return false
      }
      if (selectedSource2 !== 'all' && (!question.source_2 || !question.source_2.includes(selectedSource2))) {
        return false
      }
      if (selectedSource3 !== 'all' && (!question.source_3 || !question.source_3.includes(selectedSource3))) {
        return false
      }
      if (selectedSource4 !== 'all' && (!question.source_4 || !question.source_4.includes(selectedSource4))) {
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
  }, [questions, selectedTypeId, selectedGrade, selectedDifficulty, selectedSourceType, selectedSource1, selectedSource2, selectedSource3, selectedSource4, sortBy])

  const handleReset = () => {
    setSelectedTypeId('all')
    setSelectedGrade('all')
    setSelectedDifficulty('all')
    setSelectedSourceType('')
    setSelectedSource1('all')
    setSelectedSource2('all')
    setSelectedSource3('all')
    setSelectedSource4('all')
    setSortBy('latest')
  }

  // Get active source config
  const activeSourceConfig = useMemo(() => {
    return sourceConfigs.find(config => config.type_name === selectedSourceType)
  }, [sourceConfigs, selectedSourceType])

  // Credit Confirmation States
  const [showCreditConfirmation, setShowCreditConfirmation] = useState(false)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [isCheckingBalance, setIsCheckingBalance] = useState(false)
  const [confirmationType, setConfirmationType] = useState<'single' | 'bulk'>('single')
  const [importCost, setImportCost] = useState(0)

  const CREDIT_BALANCE_HEADER = 'x-credit-balance'

  const notifyHeaderCreditBalance = (balance: number) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('credit-balance-updated', {
        detail: { balance }
      })
    )
  }

  const syncCreditBalanceFromResponse = async (response: Response) => {
    const raw = response.headers.get(CREDIT_BALANCE_HEADER)
    const parsed = raw === null ? null : Number(raw)

    if (raw !== null && parsed !== null && Number.isFinite(parsed)) {
      notifyHeaderCreditBalance(parsed)
      return
    }

    try {
      const res = await fetch('/api/credits/balance')
      if (!res.ok) return
      const data = await res.json()
      if (typeof data.balance === 'number') {
        notifyHeaderCreditBalance(data.balance)
      }
    } catch {
      // ignore
    }
  }


  const handleSaveQuestionClick = async (questionId: string) => {
    setPendingQuestionId(questionId)
    setConfirmationType('single')
    setImportCost(100) // 100 credits per import

    // Fetch Balance
    setIsCheckingBalance(true)
    try {
      const res = await fetch('/api/credits/balance')
      if (res.ok) {
        const data = await res.json()
        setCurrentBalance(data.balance)
        setShowCreditConfirmation(true)
      } else {
         toast.error('잔액 조회 실패')
      }
    } catch(e) {
      toast.error('잔액 조회 중 오류 발생')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleConfirmSave = async () => {
    setShowCreditConfirmation(false)

    if (confirmationType === 'single') {
      if (!pendingQuestionId) return

      setSavingQuestionId(pendingQuestionId)

      try {
        const response = await fetch('/api/questions/save-from-community', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_id: pendingQuestionId }),
        })

        await syncCreditBalanceFromResponse(response)

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || '문제 가져오기에 실패했습니다.')
        }

        toast.success('문제를 내 라이브러리로 가져왔습니다!')
        router.refresh()

      } catch (error: any) {
        toast.error(error.message)
      } finally {
        setSavingQuestionId(null)
        setPendingQuestionId(null)
      }
    } else {
      // Bulk Save Logic
      handleBulkSaveQuestions()
    }
  }

  const handleBulkSaveClick = async () => {
    if (selectedQuestions.length === 0) {
      toast.error('가져올 문제를 선택해주세요.')
      return
    }

    setConfirmationType('bulk')
    setImportCost(selectedQuestions.length * 100)

     // Fetch Balance
    setIsCheckingBalance(true)
    try {
      const res = await fetch('/api/credits/balance')
      if (res.ok) {
        const data = await res.json()
        setCurrentBalance(data.balance)
        setShowCreditConfirmation(true)
      } else {
         toast.error('잔액 조회 실패')
      }
    } catch(e) {
      toast.error('잔액 조회 중 오류 발생')
    } finally {
      setIsCheckingBalance(false)
    }
  }

  const handleBulkSaveQuestions = async () => {
    if (selectedQuestions.length === 0) return

    setIsBulkSaving(true)
    // setIsBulkConfirmDialogOpen(false) // Removed old dialog logic

    try {
      const response = await fetch('/api/questions/save-from-community', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_ids: selectedQuestions }),
      })

      await syncCreditBalanceFromResponse(response)

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

      router.refresh()
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
      <CreditConfirmationDialog
        open={showCreditConfirmation}
        onClose={() => setShowCreditConfirmation(false)}
        onConfirm={handleConfirmSave}
        requiredAmount={importCost}
        currentBalance={currentBalance}
        isLoading={isCheckingBalance} // Or confirmation loading status if needed
        title="문제 가져오기"
        description={`선택한 문제를 내 라이브러리로 가져옵니다. (건당 100 크레딧)`}
      />
      {/* Filter Section */}
      <div className="bg-white border rounded-lg p-6 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">필터</h2>
        </div>

        <div className="grid gap-3 items-end grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {/* Problem Type Filter */}
          <div className="min-w-0">
            <label className="text-[11px] font-medium text-gray-700 mb-1 block">
              문제 유형
            </label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger className="h-8 text-xs w-full min-w-0">
                <SelectValue placeholder="전체" className="truncate" />
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
          <div className="min-w-0">
            <label className="text-[11px] font-medium text-gray-700 mb-1 block">
              학년
            </label>
            <Select value={selectedGrade} onValueChange={setSelectedGrade}>
              <SelectTrigger className="h-8 text-xs w-full min-w-0">
                <SelectValue placeholder="전체" className="truncate" />
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
          <div className="min-w-0">
            <label className="text-[11px] font-medium text-gray-700 mb-1 block">
              난이도
            </label>
            <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
              <SelectTrigger className="h-8 text-xs w-full min-w-0">
                <SelectValue placeholder="전체" className="truncate" />
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
          <div className="min-w-0">
            <label className="text-[11px] font-medium text-gray-700 mb-1 block">
              정렬
            </label>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'latest' | 'oldest')}>
              <SelectTrigger className="h-8 text-xs w-full min-w-0">
                <SelectValue className="truncate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">최신순</SelectItem>
                <SelectItem value="oldest">오래된 순</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-px h-8 bg-gray-200 mx-2 self-center hidden lg:block xl:col-span-1"></div>

          {/* Source Filters Group */}
          <div className="min-w-0 lg:col-span-4 xl:col-span-6 2xl:col-span-6 flex flex-wrap items-end gap-2 p-2 bg-indigo-50/80 rounded-lg border border-indigo-100">
            {/* Source Type Filter */}
            <div className="min-w-0 flex-1">
              <label className="text-[11px] font-medium text-indigo-900 mb-1 block flex items-center gap-1">
                출처 종류
              </label>
              <div className="relative">
                {sourceConfigs.length > 0 ? (
                  <Select
                    value={selectedSourceType}
                    onValueChange={(value) => {
                      setSelectedSourceType(value === 'all' ? '' : value)
                      setSelectedSource1('all')
                      setSelectedSource2('all')
                      setSelectedSource3('all')
                      setSelectedSource4('all')
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200 focus:ring-indigo-500">
                      <SelectValue placeholder="전체" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {sourceConfigs.map((config) => (
                        <SelectItem key={config.id} value={config.type_name}>
                          {config.type_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="예: 모의고사"
                    value={selectedSourceType}
                    onChange={(e) => setSelectedSourceType(e.target.value)}
                    className="w-full h-8 text-xs bg-white border-indigo-200"
                  />
                )}
              </div>
            </div>

            {/* Source 1 Filter */}
            {activeSourceConfig?.source_1_label && (
              <div className="min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300">
                <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                  {activeSourceConfig.source_1_label}
                </label>
                {activeSourceConfig.source_1_options && activeSourceConfig.source_1_options.length > 0 ? (
                  <Select value={selectedSource1} onValueChange={setSelectedSource1}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200 focus:ring-indigo-500">
                      <SelectValue placeholder="전체" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {activeSourceConfig.source_1_options.map((option, idx) => (
                        <SelectItem key={idx} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="직접 입력"
                    value={selectedSource1 === 'all' ? '' : selectedSource1}
                    onChange={(e) => setSelectedSource1(e.target.value || 'all')}
                    className="w-full h-8 text-xs bg-white border-indigo-200"
                  />
                )}
              </div>
            )}

            {/* Source 2 Filter */}
            {activeSourceConfig?.source_2_label && (
              <div className="min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300 delay-75">
                <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                  {activeSourceConfig.source_2_label}
                </label>
                {activeSourceConfig.source_2_options && activeSourceConfig.source_2_options.length > 0 ? (
                  <Select value={selectedSource2} onValueChange={setSelectedSource2}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200 focus:ring-indigo-500">
                      <SelectValue placeholder="전체" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {activeSourceConfig.source_2_options.map((option, idx) => (
                        <SelectItem key={idx} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="직접 입력"
                    value={selectedSource2 === 'all' ? '' : selectedSource2}
                    onChange={(e) => setSelectedSource2(e.target.value || 'all')}
                    className="w-full h-8 text-xs bg-white border-indigo-200"
                  />
                )}
              </div>
            )}

            {/* Source 3 Filter */}
            {activeSourceConfig?.source_3_label && (
              <div className="min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300 delay-100">
                <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                  {activeSourceConfig.source_3_label}
                </label>
                {activeSourceConfig.source_3_options && activeSourceConfig.source_3_options.length > 0 ? (
                  <Select value={selectedSource3} onValueChange={setSelectedSource3}>
                    <SelectTrigger className="h-8 text-xs w-full min-w-0 bg-white border-indigo-200 focus:ring-indigo-500">
                      <SelectValue placeholder="전체" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {activeSourceConfig.source_3_options.map((option, idx) => (
                        <SelectItem key={idx} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="직접 입력"
                    value={selectedSource3 === 'all' ? '' : selectedSource3}
                    onChange={(e) => setSelectedSource3(e.target.value || 'all')}
                    className="w-full h-8 text-xs bg-white border-indigo-200"
                  />
                )}
              </div>
            )}

            {/* Source 4 Filter */}
            {activeSourceConfig?.source_4_label && (
              <div className="min-w-0 flex-1 animate-in fade-in slide-in-from-left-2 duration-300 delay-150">
                <label className="text-[11px] font-medium text-indigo-900 mb-1 block">
                  {activeSourceConfig.source_4_label}
                </label>
                {activeSourceConfig.source_4_options && activeSourceConfig.source_4_options.length > 0 ? (
                  <Select value={selectedSource4} onValueChange={setSelectedSource4}>
                    <SelectTrigger className="h-8 text-xs w-full bg-white border-indigo-200 focus:ring-indigo-500">
                      <SelectValue placeholder="전체" className="truncate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      {activeSourceConfig.source_4_options.map((option, idx) => (
                        <SelectItem key={idx} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="직접 입력"
                    value={selectedSource4 === 'all' ? '' : selectedSource4}
                    onChange={(e) => setSelectedSource4(e.target.value || 'all')}
                    className="w-full h-8 text-xs bg-white border-indigo-200"
                  />
                )}
              </div>
            )}
          </div>

          {/* Reset Button */}
          <div className="flex items-end sm:justify-end lg:col-span-4 xl:col-span-6">
            <Button
              variant="outline"
              onClick={handleReset}
              className="h-8 text-xs px-3 text-gray-500 hover:text-gray-900"
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

      {/* Question List - 2 Column Grid */}
      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
        {filteredQuestions.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <p className="text-gray-500 mb-2">
                {questions.length === 0
                  ? '아직 문제은행에 등록된 문제가 없습니다.'
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
            <div key={question.id} className={`relative border-2 rounded-lg p-4 transition-all hover:border-gray-300 ${selectedQuestions.includes(question.id) ? 'border-primary bg-primary/5 hover:border-primary' : 'border-transparent bg-white shadow-sm'}`}>
              {/* Checkbox */}
              <div className="absolute top-2 left-2 z-10">
                <Checkbox
                  checked={selectedQuestions.includes(question.id)}
                  onCheckedChange={() => handleToggleQuestion(question.id)}
                />
              </div>

              {/* Header Badges */}
              <div className="absolute top-2 right-2 z-10 flex gap-1.5 flex-wrap justify-end max-w-[400px] items-start">
                <div className="flex items-center gap-1.5 bg-white/80 p-1 rounded backdrop-blur-sm">
                  {question.source_type && (
                    <Badge variant="default" className="text-xs font-normal">
                      {question.source_type}
                    </Badge>
                  )}
                  {question.source_1 && (
                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                      {question.source_1}
                    </Badge>
                  )}
                  {question.source_2 && (
                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                      {question.source_2}
                    </Badge>
                  )}
                  {question.source_3 && (
                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                      {question.source_3}
                    </Badge>
                  )}
                  {question.source_4 && (
                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                      {question.source_4}
                    </Badge>
                  )}
                </div>

                {question.grade_level && (
                  <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200">
                    {question.grade_level}
                  </Badge>
                )}
                {question.difficulty && (
                  <Badge variant="outline" className="text-xs bg-orange-50 border-orange-200">
                    {question.difficulty}
                  </Badge>
                )}
              </div>

              <div className="ml-8 pt-8">
                {/* Action Buttons */}
                <div className="flex items-center justify-between mb-4">
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

                  {isAdmin && (
                    <div className="flex gap-1">
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
                    </div>
                  )}
                </div>

                {/* Question Preview Card */}
                <Card className="w-full border-2 border-primary/20 shadow-lg">
                  <CardHeader className="bg-gray-50">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-lg">{question.problem_types?.type_name || '미분류'}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6 p-6">
                    {/* 1. 문제 (Question Text) */}
                    <div className="space-y-2">
                      <Label className="text-muted-foreground font-semibold">문제</Label>
                      <div className="p-4 bg-white rounded-md border text-lg font-medium whitespace-pre-wrap">
                        {question.question_text}
                      </div>
                    </div>

                    {/* 2. 문제 앞 텍스트 (Question Text Forward) */}
                    {question.question_text_forward && (
                      <div className="bg-gray-100 p-3 rounded-lg border-l-4 border-gray-400">
                        <p className="whitespace-pre-wrap text-gray-700">{question.question_text_forward}</p>
                      </div>
                    )}

                    {/* 3. 본문 (Passage) */}
                    {question.passage_text && (
                      <div className="space-y-2">
                        <Label className="text-muted-foreground font-semibold">본문</Label>
                        <div className="p-4 bg-white rounded-md border text-lg whitespace-pre-wrap">
                          {question.passage_text}
                        </div>
                      </div>
                    )}

                    {/* 4. 문제 뒤 텍스트 (Question Text Backward) */}
                    {question.question_text_backward && (
                    <div className="space-y-2">
                        <Label className="text-muted-foreground font-semibold">추가 지문</Label>
                        <div className="bg-gray-100 p-3 rounded-lg border-l-4 border-gray-400">
                          <p className="whitespace-pre-wrap text-gray-700">
                            {normalizeQuestionTextBackward(question.question_text_backward)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* 5. 선택지 (Choices) - Always show 5 slots with unicode circled numbers */}
                    <div className="space-y-2">
                      <Label className="text-muted-foreground font-semibold">선택지</Label>
                      <div className="grid gap-2">
                        {[0, 1, 2, 3, 4].map((index) => {
                          const choices = Array.isArray(question.choices) ? question.choices : []
                          const choice = choices[index] as { label?: string; text?: string } | string | undefined
                          const text = choice
                            ? (typeof choice === 'string' ? choice : ((choice as { text?: string }).text || ''))
                            : ''
                          const label = ['①', '②', '③', '④', '⑤'][index]
                          const isAnswer = question.answer === String(index + 1) || question.answer === label

                          return (
                            <div key={index} className={`flex items-start p-3 rounded-md border bg-white hover:bg-gray-50 ${isAnswer ? 'border-green-200 bg-green-50' : ''}`}>
                              <span className="font-bold mr-3 min-w-[24px] text-lg leading-none">{label}</span>
                              <span className="pt-0.5">{text}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* 6. 정답 & 해설 (Answer & Explanation - side by side) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Answer */}
                      <div className="space-y-2">
                        <Label className="text-muted-foreground font-semibold">정답</Label>
                        <div className="p-3 bg-green-50 border border-green-200 rounded-md text-green-800 font-bold">
                          {question.answer}
                        </div>
                      </div>

                      {/* Explanation */}
                      <div className="space-y-2">
                        <Label className="text-muted-foreground font-semibold">해설</Label>
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-800 text-sm whitespace-pre-wrap">
                          {question.explanation || '-'}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit Question Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>문제 수정</DialogTitle>
            <DialogDescription>
              관리자 권한으로 문제은행 문제를 수정합니다.
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
            <div className="flex justify-center gap-2">
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

    </div>
  )
}
