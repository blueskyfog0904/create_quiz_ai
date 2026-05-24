'use client'

import { useState, useRef, useEffect, useCallback, type ChangeEvent, type DragEvent, type FormEvent } from 'react'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
}
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Plus, X, Download, Upload, FileSpreadsheet, CheckCircle2, Trash2, AlertCircle, Edit, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Resizable } from 're-resizable'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface ProblemType {
  id: string
  type_name: string
  description?: string | null
  is_active?: boolean | null
  provider?: string
  created_at?: string
}

interface AdminUploadClientProps {
  problemTypes: ProblemType[]
  gradeLevels: string[]
  difficulties: string[]
  workspaceSubject: WorkspaceSubject
}

interface QuestionBankYear {
  id: string
  year: number
  label: string | null
  is_active?: boolean | null
}

interface QuestionBankBook {
  id: string
  slug: string
  name: string
  is_active?: boolean | null
}

// Parsed question from Excel file
interface ParsedQuestion {
  id: string
  clientRowId: string
  bankProblemTypeId?: string
  problem_type_id: string
  problem_type_name: string
  passage_text: string
  question_text: string
  question_text_forward: string
  question_text_backward: string
  choices: string[]
  answer: string
  explanation: string
  grade_level: string
  difficulty: string
  yearId: string
  bookId: string
  isValid: boolean
  errorMessage?: string
  source_type?: string
  source_1?: string
  source_2?: string
  source_3?: string
  source_4?: string
  conversionStatus?: 'valid' | 'needs_review' | 'invalid'
  confidence?: number
  warnings?: string[]
  sourceSnippet?: string
}

interface BulkParseResponse {
  success: boolean
  summary: {
    total: number
    valid: number
    invalid: number
  }
  questions: ParsedQuestion[]
  problemTypes: { id: string, type_name: string }[]
}

interface SourceConfig {
  id: string
  type_name: string
  source_1_label: string | null
  source_1_options: string[] | null
  source_2_label: string | null
  source_2_options: string[] | null
  source_3_label: string | null
  source_3_options: string[] | null
  source_4_label: string | null
  source_4_options: string[] | null
}

export default function AdminUploadClient({ problemTypes, gradeLevels, difficulties, workspaceSubject }: AdminUploadClientProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAddingProblemType, setIsAddingProblemType] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  
  // Bulk upload states
  const [isParsing, setIsParsing] = useState(false)
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false)
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isAnalyzingHwpx, setIsAnalyzingHwpx] = useState(false)
  const [isDownloadingFilledTemplate, setIsDownloadingFilledTemplate] = useState(false)
  const [hwpxYearId, setHwpxYearId] = useState('')
  const [hwpxBookId, setHwpxBookId] = useState('')
  const [hwpxDefaultGradeLevel, setHwpxDefaultGradeLevel] = useState('')
  const [hwpxDefaultDifficulty, setHwpxDefaultDifficulty] = useState('')
  const [hwpxSourceType, setHwpxSourceType] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hwpxFileInputRef = useRef<HTMLInputElement>(null)
  
  // Problem Type Management states
  const [allProblemTypes, setAllProblemTypes] = useState<ProblemType[]>([])
  const [editingType, setEditingType] = useState<ProblemType | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)

  // Source Configs
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>([])
  const [activeSourceConfig, setActiveSourceConfig] = useState<SourceConfig | null>(null)
  const [bankYears, setBankYears] = useState<QuestionBankYear[]>([])
  const [bankBooks, setBankBooks] = useState<QuestionBankBook[]>([])
  
  // Single upload form state
  const [formData, setFormData] = useState({
    question_text: '',
    question_text_forward: '',
    question_text_backward: '',
    passage_text: '',
    answer: '',
    choices: ['', '', '', '', ''],
    explanation: '',
    difficulty: undefined as string | undefined,
    grade_level: undefined as string | undefined,
    problem_type_id: '',
    yearId: '',
    bookId: '',
    source_type: '',
    source_1: '',
    source_2: '',
    source_3: '',
    source_4: '',
  })
  
  const [newProblemType, setNewProblemType] = useState({
    type_name: '',
    description: '',
    provider: 'admin' as 'gemini' | 'openai' | 'admin',
    prompt_template: '',
    model_name: '',
    output_format: '',
    is_active: true,
  })
  
  // Fetch all problem types for the modal
  const fetchAllProblemTypes = useCallback(async () => {
    setIsLoadingTypes(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/question-bank/problem-types', workspaceSubject))
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setAllProblemTypes(data.problemTypes || [])
    } catch (error) {
      console.error('Error fetching problem types:', error)
      toast.error('문제 유형 목록을 불러오는데 실패했습니다.')
    } finally {
      setIsLoadingTypes(false)
    }
  }, [workspaceSubject])
  
  // Fetch problem types when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      fetchAllProblemTypes()
    }
  }, [isDialogOpen, fetchAllProblemTypes])

  // Fetch active question bank year/book metadata
  useEffect(() => {
    const fetchQuestionBankMetadata = async () => {
      try {
        const [yearsResponse, booksResponse] = await Promise.all([
          fetch(withAdminWorkspaceSubject('/api/admin/question-bank/years', workspaceSubject)),
          fetch(withAdminWorkspaceSubject('/api/admin/question-bank/books', workspaceSubject)),
        ])

        if (yearsResponse.ok) {
          const yearsData = await yearsResponse.json()
          setBankYears((yearsData.years || []).filter((year: QuestionBankYear) => year.is_active !== false))
        }

        if (booksResponse.ok) {
          const booksData = await booksResponse.json()
          setBankBooks((booksData.books || []).filter((book: QuestionBankBook) => book.is_active !== false))
        }
      } catch (error) {
        console.error('Failed to fetch question bank metadata:', error)
        toast.error('문제은행 연도/교재 목록을 불러오는데 실패했습니다.')
      }
    }

    fetchQuestionBankMetadata()
  }, [workspaceSubject])

  // Fetch source configs
  useEffect(() => {
    const fetchSourceConfigs = async () => {
      try {
        const response = await fetch(withAdminWorkspaceSubject('/api/admin/source-configs', workspaceSubject))
        if (response.ok) {
          const data = await response.json()
          setSourceConfigs(data.configs || [])
        }
      } catch (error) {
        console.error('Failed to fetch source configs:', error)
      }
    }
    fetchSourceConfigs()
  }, [workspaceSubject])

  // Update active source config when source_type changes
  useEffect(() => {
    const config = sourceConfigs.find(c => c.type_name === formData.source_type)
    setActiveSourceConfig(config || null)
  }, [formData.source_type, sourceConfigs])
  
  // Reset form to add mode
  const resetProblemTypeForm = () => {
    setEditingType(null)
    setNewProblemType({
      type_name: '',
      description: '',
      provider: 'admin',
      prompt_template: '',
      model_name: '',
      output_format: '',
      is_active: true,
    })
  }
  
  // Handle edit mode
  const handleEditProblemType = (type: ProblemType) => {
    setEditingType(type)
    setNewProblemType({
      type_name: type.type_name,
      description: type.description || '',
      provider: (type.provider as 'gemini' | 'openai' | 'admin') || 'admin',
      prompt_template: '',
      model_name: '',
      output_format: '',
      is_active: type.is_active !== false,
    })
  }
  
  // Handle update problem type
  const handleUpdateProblemType = async () => {
    if (!editingType) return
    
    setIsAddingProblemType(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/question-bank/problem-types/${editingType.id}`, workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type_name: newProblemType.type_name,
          description: newProblemType.description || null,
          is_active: newProblemType.is_active,
        }),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '수정에 실패했습니다.')
      }
      
      toast.success('문제 유형이 수정되었습니다.')
      resetProblemTypeForm()
      fetchAllProblemTypes()
      router.refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAddingProblemType(false)
    }
  }
  
  // Handle delete problem type
  const handleDeleteProblemType = async (id: string) => {
    setIsDeleting(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject(`/api/admin/question-bank/problem-types/${id}`, workspaceSubject), {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '삭제에 실패했습니다.')
      }
      
      toast.success('문제 유형이 삭제되었습니다.')
      setDeleteConfirmId(null)
      if (editingType?.id === id) {
        resetProblemTypeForm()
      }
      fetchAllProblemTypes()
      router.refresh()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsDeleting(false)
    }
  }
  
  // Single upload handlers
  const handleChoiceChange = (index: number, value: string) => {
    const newChoices = [...formData.choices]
    newChoices[index] = value
    setFormData({ ...formData, choices: newChoices })
  }
  
  const addChoice = () => {
    setFormData({ ...formData, choices: [...formData.choices, ''] })
  }
  
  const removeChoice = (index: number) => {
    if (formData.choices.length <= 1) {
      toast.error('최소 1개의 선택지 입력란은 유지되어야 합니다.')
      return
    }
    const newChoices = formData.choices.filter((_, i) => i !== index)
    setFormData({ ...formData, choices: newChoices })
  }
  
  const handleAddProblemType = async () => {
    setIsAddingProblemType(true)
    
    try {
      if (!newProblemType.type_name.trim()) {
        throw new Error('문제 유형 이름을 입력해주세요.')
      }
      
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/question-bank/problem-types', workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProblemType),
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '문제 유형 추가에 실패했습니다.')
      }
      
      toast.success('문제 유형이 성공적으로 추가되었습니다.')
      
      setNewProblemType({
        type_name: '',
        description: '',
        provider: 'admin',
        prompt_template: '',
        model_name: '',
        output_format: '',
        is_active: true,
      })
      setIsDialogOpen(false)
      router.refresh()
      
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAddingProblemType(false)
    }
  }
  
  // Bulk upload handlers
  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/template', workspaceSubject))
      
      if (!response.ok) {
        throw new Error('템플릿 다운로드에 실패했습니다.')
      }
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'question_upload_template.xlsx'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      toast.success('템플릿이 다운로드되었습니다.')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsDownloadingTemplate(false)
    }
  }
  
  // Parse file and show preview (NO DB save)
  const handleFileParse = async (file: File) => {
    setIsParsing(true)
    setParsedQuestions([])
    
    try {
      const formData = new FormData()
      formData.append('file', file)
      
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/bulk-upload', workspaceSubject), {
        method: 'POST',
        body: formData,
      })
      
      const data: BulkParseResponse = await response.json()
      
      if (!response.ok) {
        throw new Error(data.summary ? '파일 파싱 중 오류가 발생했습니다.' : '대량 업로드에 실패했습니다.')
      }
      
      if (data.questions.length === 0) {
        toast.error('파일에서 문제를 찾을 수 없습니다.')
        return
      }
      
      setParsedQuestions(data.questions)
      toast.success(`${data.questions.length}개의 문제를 불러왔습니다. 내용을 확인 후 업로드해주세요.`)
      
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsParsing(false)
    }
  }
  
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileParse(file)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  const handleDrag = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }
  
  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      const fileName = file.name.toLowerCase()
      
      if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.csv')) {
        toast.error('.xlsx 또는 .csv 파일만 업로드할 수 있습니다.')
        return
      }
      
      handleFileParse(file)
    }
  }

  const hasRequiredParsedFields = (question: ParsedQuestion) => Boolean(
    (question.bankProblemTypeId || question.problem_type_id) &&
    question.question_text.trim() &&
    question.answer.trim() &&
    question.yearId &&
    question.bookId
  )

  const handleMarkHwpxQuestionReviewed = (questionId: string) => {
    setParsedQuestions(current => current.map((question) => {
      if (question.id !== questionId) return question
      if (!hasRequiredParsedFields(question)) {
        return { ...question, isValid: false, conversionStatus: 'invalid', errorMessage: '필수 항목을 먼저 입력해주세요.' }
      }
      return { ...question, isValid: true, conversionStatus: 'valid', errorMessage: undefined, warnings: [] }
    }))
  }

  const handleHwpxAnalyze = async (file: File) => {
    if (!hwpxYearId || !hwpxBookId) {
      toast.error('연도와 교재를 선택해주세요.')
      return
    }

    setIsAnalyzingHwpx(true)
    setParsedQuestions([])

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('yearId', hwpxYearId)
      formData.append('bookId', hwpxBookId)
      formData.append('defaultGradeLevel', hwpxDefaultGradeLevel)
      formData.append('defaultDifficulty', hwpxDefaultDifficulty)
      formData.append('sourceType', hwpxSourceType)

      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/hwpx-analyze', workspaceSubject), {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'HWPX 분석에 실패했습니다.')
      }

      setParsedQuestions(data.questions || [])
      toast.success(`HWPX 분석 결과 ${data.summary?.total || 0}개의 문제 초안을 만들었습니다. 저장 전 반드시 검수해주세요.`)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsAnalyzingHwpx(false)
      if (hwpxFileInputRef.current) hwpxFileInputRef.current.value = ''
    }
  }

  const handleHwpxFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) handleHwpxAnalyze(file)
  }

  const handleDownloadFilledTemplate = async () => {
    if (parsedQuestions.length === 0) {
      toast.error('다운로드할 분석 결과가 없습니다.')
      return
    }

    setIsDownloadingFilledTemplate(true)
    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/filled-template', workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: parsedQuestions }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '채워진 템플릿 다운로드에 실패했습니다.')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'question_upload_template_filled.xlsx'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success('채워진 템플릿이 다운로드되었습니다.')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsDownloadingFilledTemplate(false)
    }
  }
  
  // Update parsed question
  const handleUpdateParsedQuestion = (id: string, field: string, value: string | string[]) => {
    setParsedQuestions(prev => prev.map(q => {
      if (q.id === id) {
        const updated = { ...q, [field]: value }
        // Revalidate. HWPX needs_review rows remain blocked until explicit review approval.
        const structurallyValid = validateParsedQuestion(updated)
        updated.isValid = structurallyValid && updated.conversionStatus !== 'needs_review'
        if (updated.isValid) {
          updated.errorMessage = undefined
        } else if (structurallyValid && updated.conversionStatus === 'needs_review') {
          updated.errorMessage = 'AI 분석 결과 검수 완료가 필요합니다.'
        }
        return updated
      }
      return q
    }))
  }
  
  const handleUpdateParsedQuestionChoice = (id: string, choiceIndex: number, value: string) => {
    setParsedQuestions(prev => prev.map(q => {
      if (q.id === id) {
        const newChoices = [...q.choices]
        newChoices[choiceIndex] = value
        const updated = { ...q, choices: newChoices }
        const structurallyValid = validateParsedQuestion(updated)
        updated.isValid = structurallyValid && updated.conversionStatus !== 'needs_review'
        if (updated.isValid) {
          updated.errorMessage = undefined
        } else if (structurallyValid && updated.conversionStatus === 'needs_review') {
          updated.errorMessage = 'AI 분석 결과 검수 완료가 필요합니다.'
        }
        return updated
      }
      return q
    }))
  }
  
  const validateParsedQuestion = (q: ParsedQuestion): boolean => {
    if (!q.problem_type_id) return false
    if (!q.question_text.trim()) return false
    if (!q.answer.trim()) return false
    if (!q.yearId) return false
    if (!q.bookId) return false
    // 선택지는 선택사항이므로 검증 제거
    return true
  }
  
  // Delete parsed question
  const handleDeleteParsedQuestion = (id: string) => {
    setParsedQuestions(prev => prev.filter(q => q.id !== id))
    toast.success('문제가 목록에서 제거되었습니다.')
  }
  
  // Clear all parsed questions
  const handleClearAllParsed = () => {
    setParsedQuestions([])
    toast.success('모든 문제가 목록에서 제거되었습니다.')
  }
  
  const formatParsedQuestionForUpload = (question: ParsedQuestion) => {
    const circledNumbers = ['①', '②', '③', '④', '⑤']
    const validChoices = question.choices.filter(c => c.trim())
    const formattedChoices = validChoices.length > 0
      ? validChoices.map((choice, index) => ({
          label: circledNumbers[index],
          text: choice,
        }))
      : []

    let formattedAnswer = question.answer.trim()
    if (formattedAnswer.includes(',')) {
      formattedAnswer = formattedAnswer
        .split(',')
        .map(ans => {
          const num = parseInt(ans.trim())
          if (!isNaN(num) && num >= 1 && num <= 5) {
            return circledNumbers[num - 1]
          }
          return ans.trim()
        })
        .join(', ')
    } else {
      const answerNum = parseInt(formattedAnswer)
      if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
        formattedAnswer = circledNumbers[answerNum - 1]
      }
    }

    return {
      question_text: question.question_text,
      question_text_forward: question.question_text_forward || undefined,
      question_text_backward: question.question_text_backward || undefined,
      passage_text: question.passage_text || undefined,
      answer: formattedAnswer,
      choices: formattedChoices,
      explanation: question.explanation || undefined,
      difficulty: question.difficulty || undefined,
      grade_level: question.grade_level || undefined,
      bankProblemTypeId: question.bankProblemTypeId || question.problem_type_id,
      source_type: question.source_type,
      source_1: question.source_1,
      source_2: question.source_2,
      source_3: question.source_3,
      source_4: question.source_4,
    }
  }

  // Bulk save all parsed questions
  const handleBulkSave = async () => {
    const validQuestions = parsedQuestions.filter(q => q.isValid)

    if (validQuestions.length === 0) {
      toast.error('업로드할 유효한 문제가 없습니다.')
      return
    }

    setIsBulkSaving(true)

    try {
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/upload', workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: validQuestions.map((question) => ({
            question: formatParsedQuestionForUpload(question),
            yearId: question.yearId,
            bookId: question.bookId,
            bankProblemTypeId: question.bankProblemTypeId || question.problem_type_id,
            clientRowId: question.clientRowId,
          })),
        }),
      })

      const responseData = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(responseData.error || '문제 업로드에 실패했습니다.')
      }

      const insertedCount = responseData.result?.inserted_count ?? validQuestions.length
      const failedCount = responseData.result?.failed_count ?? 0

      if (insertedCount > 0) {
        toast.success(`${insertedCount}개의 문제가 성공적으로 업로드되었습니다.`)
        setParsedQuestions([])
        router.refresh()
      }

      if (failedCount > 0) {
        toast.error(`${failedCount}개의 문제 업로드에 실패했습니다.`)
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsBulkSaving(false)
    }
  }

  // Single upload submit
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    
    try {
      if (!formData.question_text.trim()) {
        throw new Error('문제 내용을 입력해주세요.')
      }
      if (!formData.answer.trim()) {
        throw new Error('정답을 입력해주세요.')
      }
      if (!formData.problem_type_id) {
        throw new Error('문제 유형을 선택해주세요.')
      }
      if (!formData.yearId) {
        throw new Error('연도를 선택해주세요.')
      }
      if (!formData.bookId) {
        throw new Error('교재를 선택해주세요.')
      }
      
      console.log('[Client Single Upload] ====== START SINGLE UPLOAD ======')
      console.log('[Client Single Upload] Form data:', {
        question_text: formData.question_text,
        originalChoices: formData.choices,
        originalChoicesLength: formData.choices.length,
        answer: formData.answer
      })
      
      // 선택지는 선택사항이므로 필터링만 수행 (빈 배열도 허용)
      const validChoices = formData.choices.filter(c => c.trim())
      console.log('[Client Single Upload] Valid choices after filter:', {
        validChoices,
        validChoicesLength: validChoices.length,
        originalChoicesLength: formData.choices.length
      })
      
      const circledNumbers = ['①', '②', '③', '④', '⑤']
      
      // 빈 배열도 DB에 저장
      const formattedChoices = validChoices.length > 0 
        ? validChoices.map((choice, index) => ({
            label: circledNumbers[index],
            text: choice
          }))
        : [] // 빈 배열로 저장
      
      console.log('[Client Single Upload] Formatted choices:', {
        formattedChoices,
        formattedChoicesLength: formattedChoices.length,
        formattedChoicesType: typeof formattedChoices,
        formattedChoicesIsArray: Array.isArray(formattedChoices),
        formattedChoicesJSON: JSON.stringify(formattedChoices)
      })
      
      // Format answer - support multiple answers separated by comma
      let formattedAnswer = formData.answer.trim()
      // Check if it contains comma (multiple answers)
      if (formattedAnswer.includes(',')) {
        // Split by comma, convert each number to circled number, and join back
        formattedAnswer = formattedAnswer
          .split(',')
          .map(ans => {
            const num = parseInt(ans.trim())
            if (!isNaN(num) && num >= 1 && num <= 5) {
              return circledNumbers[num - 1]
            }
            return ans.trim() // Keep as-is if not a valid number
          })
          .join(', ')
      } else {
        // Single answer
        const answerNum = parseInt(formattedAnswer)
        if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
          formattedAnswer = circledNumbers[answerNum - 1]
        }
      }
      
      const requestBody = {
        ...formData,
        choices: formattedChoices,
        answer: formattedAnswer,
        difficulty: formData.difficulty || undefined,
        grade_level: formData.grade_level || undefined,
        passage_text: formData.passage_text || undefined,
        explanation: formData.explanation || undefined,
        question_text_forward: formData.question_text_forward || undefined,
        question_text_backward: formData.question_text_backward || undefined,
        source_type: formData.source_type || undefined,
        source_1: formData.source_1 || undefined,
        source_2: formData.source_2 || undefined,
        source_3: formData.source_3 || undefined,
        source_4: formData.source_4 || undefined,
        bankProblemTypeId: formData.problem_type_id,
      }
      
      console.log('[Client Single Upload] Request body:', JSON.stringify(requestBody, null, 2))
      console.log('[Client Single Upload] Request body choices:', {
        choices: requestBody.choices,
        choicesType: typeof requestBody.choices,
        choicesIsArray: Array.isArray(requestBody.choices),
        choicesLength: Array.isArray(requestBody.choices) ? requestBody.choices.length : 'N/A',
        choicesJSON: JSON.stringify(requestBody.choices)
      })
      
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/questions/upload', workspaceSubject), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      
      const responseData = await response.json().catch(() => ({}))
      console.log('[Client Single Upload] Response status:', response.status)
      console.log('[Client Single Upload] Response data:', JSON.stringify(responseData, null, 2))
      
      if (!response.ok) {
        console.error('[Client Single Upload] Upload failed:', {
          status: response.status,
          error: responseData.error,
          details: responseData.details
        })
        throw new Error(responseData.error || '문제 업로드에 실패했습니다.')
      }
      
      console.log('[Client Single Upload] ====== END SINGLE UPLOAD (SUCCESS) ======')
      toast.success('문제가 성공적으로 업로드되었습니다.')
      
      setFormData({
        question_text: '',
        question_text_forward: '',
        question_text_backward: '',
        passage_text: '',
        answer: '',
        choices: ['', '', '', '', ''],
        explanation: '',
        difficulty: undefined,
        grade_level: undefined,
        problem_type_id: '',
        yearId: '',
        bookId: '',
        source_type: '',
        source_1: '',
        source_2: '',
        source_3: '',
        source_4: '',
      })
      
    } catch (error: unknown) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  const validCount = parsedQuestions.filter(q => q.isValid).length
  const needsReviewCount = parsedQuestions.filter(q => q.conversionStatus === 'needs_review').length
  const invalidCount = parsedQuestions.filter(q => !q.isValid && q.conversionStatus !== 'needs_review').length
  
  return (
    <>
      {/* HWPX AI Template Conversion Section */}
      <Card className="mb-8 border-blue-200 bg-blue-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            AI 템플릿 변환
          </CardTitle>
          <CardDescription>
            HWPX 파일에서 텍스트를 추출해 AI가 문제은행 업로드 초안을 만듭니다. 문서 내용은 AI provider로 전송되며, 저장 전 반드시 검수해야 합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>연도 *</Label>
              <Select value={hwpxYearId} onValueChange={setHwpxYearId}>
                <SelectTrigger><SelectValue placeholder="연도 선택" /></SelectTrigger>
                <SelectContent>
                  {bankYears.map((year) => (
                    <SelectItem key={year.id} value={year.id}>{year.label || year.year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>교재 *</Label>
              <Select value={hwpxBookId} onValueChange={setHwpxBookId}>
                <SelectTrigger><SelectValue placeholder="교재 선택" /></SelectTrigger>
                <SelectContent>
                  {bankBooks.map((book) => (
                    <SelectItem key={book.id} value={book.id}>{book.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>기본 학년</Label>
              <Select value={hwpxDefaultGradeLevel} onValueChange={setHwpxDefaultGradeLevel}>
                <SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger>
                <SelectContent>
                  {gradeLevels.map((grade) => (
                    <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>기본 난이도</Label>
              <Select value={hwpxDefaultDifficulty} onValueChange={setHwpxDefaultDifficulty}>
                <SelectTrigger><SelectValue placeholder="선택 안 함" /></SelectTrigger>
                <SelectContent>
                  {difficulties.map((difficulty) => (
                    <SelectItem key={difficulty} value={difficulty}>{difficulty}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>기본 출처종류</Label>
              <Input value={hwpxSourceType} onChange={(event) => setHwpxSourceType(event.target.value)} placeholder="예: 수능특강" />
            </div>
          </div>
          <input ref={hwpxFileInputRef} type="file" accept=".hwpx" onChange={handleHwpxFileChange} className="hidden" />
          <Button type="button" onClick={() => hwpxFileInputRef.current?.click()} disabled={isAnalyzingHwpx || !hwpxYearId || !hwpxBookId}>
            {isAnalyzingHwpx ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            HWPX 업로드 후 AI 분석
          </Button>
        </CardContent>
      </Card>

      {/* Bulk Upload Section */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            대량 업로드
          </CardTitle>
          <CardDescription>
            엑셀 또는 CSV 파일로 여러 문제를 한 번에 업로드할 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Template Download */}
          <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div>
              <p className="font-medium text-blue-900">1. 템플릿 다운로드</p>
              <p className="text-sm text-blue-700">
                양식에 맞게 문제를 작성하세요. 첫 번째 행에 샘플 데이터가 포함되어 있습니다.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={handleDownloadTemplate}
              disabled={isDownloadingTemplate}
              className="bg-white"
            >
              {isDownloadingTemplate ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              템플릿 다운로드
            </Button>
          </div>
          
          {/* File Upload Area */}
          <div>
            <p className="font-medium mb-2">2. 파일 업로드</p>
            <div
              className={`
                relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${dragActive ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-gray-400'}
                ${isParsing ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
              `}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              
              {isParsing ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="h-10 w-10 text-primary animate-spin mb-3" />
                  <p className="text-gray-600">파일을 처리하고 있습니다...</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-600 mb-1">
                    파일을 드래그하여 놓거나 클릭하여 선택하세요
                  </p>
                  <p className="text-sm text-gray-400">
                    지원 형식: .xlsx, .csv
                  </p>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Parsed Questions Preview */}
      {parsedQuestions.length > 0 && (
        <div className="mb-8 space-y-4">
          {/* Summary and Actions */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-sm text-gray-600">전체</span>
                <p className="text-xl font-bold">{parsedQuestions.length}개</p>
              </div>
              <div>
                <span className="text-sm text-green-600">유효</span>
                <p className="text-xl font-bold text-green-600">{validCount}개</p>
              </div>
              {needsReviewCount > 0 && (
                <div>
                  <span className="text-sm text-amber-600">검수 필요</span>
                  <p className="text-xl font-bold text-amber-600">{needsReviewCount}개</p>
                </div>
              )}
              {invalidCount > 0 && (
                <div>
                  <span className="text-sm text-red-600">오류</span>
                  <p className="text-xl font-bold text-red-600">{invalidCount}개</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadFilledTemplate}
                disabled={isDownloadingFilledTemplate || parsedQuestions.length === 0}
              >
                {isDownloadingFilledTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                채워진 템플릿 다운로드
              </Button>
              <Button 
                variant="outline" 
                onClick={handleClearAllParsed}
                disabled={isBulkSaving}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                전체 삭제
              </Button>
              <Button 
                onClick={handleBulkSave}
                disabled={isBulkSaving || validCount === 0}
              >
                {isBulkSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                일괄 업로드 ({validCount}개)
              </Button>
            </div>
          </div>
          
          {/* Question Cards */}
          {parsedQuestions.map((question, index) => (
            <Card 
              key={question.id} 
              className={`${!question.isValid ? 'border-red-300 bg-red-50/50' : ''}`}
            >
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">문제 {index + 1}</CardTitle>
                    {question.conversionStatus && (
                      <Badge variant={question.conversionStatus === 'valid' ? 'default' : question.conversionStatus === 'needs_review' ? 'secondary' : 'destructive'}>
                        {question.conversionStatus === 'valid' ? 'AI 검수 완료' : question.conversionStatus === 'needs_review' ? '검수 필요' : '변환 오류'}
                      </Badge>
                    )}
                    {typeof question.confidence === 'number' && <Badge variant="outline">신뢰도 {Math.round(question.confidence * 100)}%</Badge>}
                    {!question.isValid && (
                      <div className="flex items-center gap-1 text-red-600 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        <span>{question.errorMessage || '필수 항목을 확인해주세요'}</span>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDeleteParsedQuestion(question.id)}
                    className="text-red-500 hover:text-red-700 hover:bg-red-100"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {question.warnings && question.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">AI 경고</p>
                    <ul className="mt-1 list-disc pl-5">
                      {question.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}
                    </ul>
                  </div>
                )}
                {question.sourceSnippet && (
                  <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">원문 스니펫</p>
                    <p className="mt-1 whitespace-pre-wrap">{question.sourceSnippet}</p>
                  </div>
                )}
                {question.conversionStatus === 'needs_review' && (
                  <Button type="button" variant="outline" onClick={() => handleMarkHwpxQuestionReviewed(question.id)}>
                    검수 완료
                  </Button>
                )}

                {/* Problem Type */}
                <div className="space-y-2">
                  <Label>문제 유형 *</Label>
                  <Select 
                    value={question.problem_type_id} 
                    onValueChange={(value) => {
                      const selectedType = problemTypes.find(pt => pt.id === value)
                      handleUpdateParsedQuestion(question.id, 'problem_type_id', value)
                      if (selectedType) {
                        handleUpdateParsedQuestion(question.id, 'problem_type_name', selectedType.type_name)
                      }
                    }}
                  >
                    <SelectTrigger className={!question.problem_type_id ? 'border-red-300' : ''}>
                      <SelectValue placeholder="문제 유형을 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {problemTypes.map((type) => (
                        <SelectItem key={type.id} value={type.id}>
                          {type.type_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>연도 *</Label>
                    <Select
                      value={question.yearId}
                      onValueChange={(value) => handleUpdateParsedQuestion(question.id, 'yearId', value)}
                    >
                      <SelectTrigger className={!question.yearId ? 'border-red-300' : ''}>
                        <SelectValue placeholder="연도 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankYears.map((year) => (
                          <SelectItem key={year.id} value={year.id}>
                            {year.label || year.year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>교재 *</Label>
                    <Select
                      value={question.bookId}
                      onValueChange={(value) => handleUpdateParsedQuestion(question.id, 'bookId', value)}
                    >
                      <SelectTrigger className={!question.bookId ? 'border-red-300' : ''}>
                        <SelectValue placeholder="교재 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {bankBooks.map((book) => (
                          <SelectItem key={book.id} value={book.id}>
                            {book.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Passage */}
                <div className="space-y-2">
                  <Label>지문 (선택)</Label>
                  <Textarea
                    value={question.passage_text}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'passage_text', e.target.value)}
                    rows={4}
                    placeholder="영어 지문을 입력하세요..."
                  />
                </div>
                
                {/* Question Text Forward */}
                <div className="space-y-2">
                  <Label>문제 앞 텍스트 (선택)</Label>
                  <Textarea
                    value={question.question_text_forward || ''}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'question_text_forward', e.target.value)}
                    rows={2}
                    placeholder="문제 앞에 박스로 표시될 텍스트를 입력하세요..."
                  />
                </div>
                
                {/* Question Text */}
                <div className="space-y-2">
                  <Label>문제 내용 *</Label>
                  <Textarea
                    value={question.question_text}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'question_text', e.target.value)}
                    rows={3}
                    placeholder="문제 내용을 입력하세요..."
                    className={!question.question_text.trim() ? 'border-red-300' : ''}
                  />
                </div>
                
                {/* Question Text Backward */}
                <div className="space-y-2">
                  <Label>문제 뒤 텍스트 (선택)</Label>
                  <Textarea
                    value={question.question_text_backward || ''}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'question_text_backward', e.target.value)}
                    rows={2}
                    placeholder="문제 뒤에 박스로 표시될 텍스트를 입력하세요..."
                  />
                </div>
                
                {/* Choices */}
                <div className="space-y-2">
                  <Label>선택지 (선택)</Label>
                  <div className="space-y-2">
                    {question.choices.map((choice, choiceIndex) => {
                      const circledNumbers = ['①', '②', '③', '④', '⑤']
                      return (
                        <Input
                          key={choiceIndex}
                          placeholder={`${circledNumbers[choiceIndex]} 선택지 내용 (선택사항)`}
                          value={choice}
                          onChange={(e) => handleUpdateParsedQuestionChoice(question.id, choiceIndex, e.target.value)}
                        />
                      )
                    })}
                  </div>
                </div>
                
                {/* Answer */}
                <div className="space-y-2">
                  <Label>정답 * (1-5 숫자 또는 ①-⑤)</Label>
                  <Input
                    value={question.answer}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'answer', e.target.value)}
                    placeholder="예: 3 또는 ③"
                    className={!question.answer.trim() ? 'border-red-300' : ''}
                  />
                </div>
                
                {/* Explanation */}
                <div className="space-y-2">
                  <Label>해설 (선택)</Label>
                  <Textarea
                    value={question.explanation}
                    onChange={(e) => handleUpdateParsedQuestion(question.id, 'explanation', e.target.value)}
                    rows={3}
                    placeholder="해설을 입력하세요..."
                  />
                </div>
                
                {/* Grade Level and Difficulty */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>학년 (선택)</Label>
                    <Select 
                      value={question.grade_level || undefined}
                      onValueChange={(value) => handleUpdateParsedQuestion(question.id, 'grade_level', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="학년 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {gradeLevels.map((grade) => (
                          <SelectItem key={grade} value={grade}>
                            {grade}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>난이도 (선택)</Label>
                    <Select 
                      value={question.difficulty || undefined}
                      onValueChange={(value) => handleUpdateParsedQuestion(question.id, 'difficulty', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="난이도 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {difficulties.map((diff) => (
                          <SelectItem key={diff} value={diff}>
                            {diff}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Question Source Info */}
                <div className="space-y-4 pt-4 border-t">
                  <h4 className="font-medium text-sm text-gray-700">출처 정보 (선택)</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>출처 종류</Label>
                      <Input
                        placeholder="예: 모의고사, 수능"
                        value={question.source_type || ''}
                        onChange={(e) => handleUpdateParsedQuestion(question.id, 'source_type', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>출처 1 (상세)</Label>
                      <Input
                        placeholder="예: 2023년 3월"
                        value={question.source_1 || ''}
                        onChange={(e) => handleUpdateParsedQuestion(question.id, 'source_1', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>출처 2 (상세)</Label>
                      <Input
                        placeholder="예: 31번"
                        value={question.source_2 || ''}
                        onChange={(e) => handleUpdateParsedQuestion(question.id, 'source_2', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>출처 3 (상세)</Label>
                      <Input
                        value={question.source_3 || ''}
                        onChange={(e) => handleUpdateParsedQuestion(question.id, 'source_3', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>출처 4 (상세)</Label>
                      <Input
                        value={question.source_4 || ''}
                        onChange={(e) => handleUpdateParsedQuestion(question.id, 'source_4', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {/* Bottom Action Bar */}
          <div className="sticky bottom-4 p-4 bg-white rounded-lg border shadow-lg flex items-center justify-between">
            <p className="text-sm text-gray-600">
              총 <span className="font-bold">{parsedQuestions.length}</span>개 중 
              <span className="font-bold text-green-600 ml-1">{validCount}</span>개 업로드 가능
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadFilledTemplate}
                disabled={isDownloadingFilledTemplate || parsedQuestions.length === 0}
              >
                {isDownloadingFilledTemplate ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                채워진 템플릿 다운로드
              </Button>
              <Button 
                variant="outline" 
                onClick={handleClearAllParsed}
                disabled={isBulkSaving}
              >
                전체 삭제
              </Button>
              <Button 
                onClick={handleBulkSave}
                disabled={isBulkSaving || validCount === 0}
                size="lg"
              >
                {isBulkSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                일괄 업로드 ({validCount}개)
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Single Upload Section */}
      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>개별 문제 업로드</CardTitle>
            <CardDescription>문제 하나를 직접 입력하여 업로드합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Problem Type */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="problem_type_id">문제 유형 *</Label>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => setIsDialogOpen(true)}
                  className="text-primary"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  문제 유형 추가
                </Button>
              </div>
              <Select 
                value={formData.problem_type_id} 
                onValueChange={(value) => setFormData({ ...formData, problem_type_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="문제 유형을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {problemTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.type_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="yearId">연도 *</Label>
                <Select
                  value={formData.yearId}
                  onValueChange={(value) => setFormData({ ...formData, yearId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="연도 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankYears.map((year) => (
                      <SelectItem key={year.id} value={year.id}>
                        {year.label || year.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="bookId">교재 *</Label>
                <Select
                  value={formData.bookId}
                  onValueChange={(value) => setFormData({ ...formData, bookId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="교재 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankBooks.map((book) => (
                      <SelectItem key={book.id} value={book.id}>
                        {book.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Passage Text */}
            <div className="space-y-2">
              <Label htmlFor="passage_text">지문 (선택)</Label>
              <Textarea
                id="passage_text"
                placeholder="영어 지문을 입력하세요..."
                value={formData.passage_text}
                onChange={(e) => setFormData({ ...formData, passage_text: e.target.value })}
                rows={6}
              />
            </div>
            
            {/* Question Text Forward */}
            <div className="space-y-2">
              <Label htmlFor="question_text_forward">문제 앞 텍스트 (선택)</Label>
              <Textarea
                id="question_text_forward"
                placeholder="문제 앞에 박스로 표시될 텍스트를 입력하세요..."
                value={formData.question_text_forward}
                onChange={(e) => setFormData({ ...formData, question_text_forward: e.target.value })}
                rows={2}
              />
              <p className="text-xs text-gray-500">입력한 내용이 문제 앞에 배경색 박스로 표시됩니다.</p>
            </div>
            
            {/* Question Text */}
            <div className="space-y-2">
              <Label htmlFor="question_text">문제 내용 *</Label>
              <Textarea
                id="question_text"
                placeholder="문제 내용을 입력하세요..."
                value={formData.question_text}
                onChange={(e) => setFormData({ ...formData, question_text: e.target.value })}
                rows={4}
                required
              />
            </div>
            
            {/* Question Text Backward */}
            <div className="space-y-2">
              <Label htmlFor="question_text_backward">문제 뒤 텍스트 (선택)</Label>
              <Textarea
                id="question_text_backward"
                placeholder="문제 뒤에 박스로 표시될 텍스트를 입력하세요..."
                value={formData.question_text_backward}
                onChange={(e) => setFormData({ ...formData, question_text_backward: e.target.value })}
                rows={2}
              />
              <p className="text-xs text-gray-500">입력한 내용이 문제 뒤에 배경색 박스로 표시됩니다.</p>
            </div>
            
            {/* Choices */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>선택지 (선택)</Label>
                <Button type="button" variant="outline" size="sm" onClick={addChoice}>
                  <Plus className="h-4 w-4 mr-1" />
                  선택지 추가
                </Button>
              </div>
              <div className="space-y-2">
                {formData.choices.map((choice, index) => {
                  const circledNumbers = ['①', '②', '③', '④', '⑤']
                  return (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder={`${circledNumbers[index]} 선택지 내용`}
                        value={choice}
                        onChange={(e) => handleChoiceChange(index, e.target.value)}
                      />
                      {formData.choices.length > 1 && (
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
                value={formData.answer}
                onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
                required
              />
            </div>
            
            {/* Explanation */}
            <div className="space-y-2">
              <Label htmlFor="explanation">해설 (선택)</Label>
              <Textarea
                id="explanation"
                placeholder="해설을 입력하세요..."
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                rows={4}
              />
            </div>
            
            {/* Grade Level and Difficulty */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="grade_level">학년 (선택)</Label>
                <Select 
                  value={formData.grade_level} 
                  onValueChange={(value) => setFormData({ ...formData, grade_level: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="학년 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {gradeLevels.map((grade) => (
                      <SelectItem key={grade} value={grade}>
                        {grade}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="difficulty">난이도 (선택)</Label>
                <Select 
                  value={formData.difficulty} 
                  onValueChange={(value) => setFormData({ ...formData, difficulty: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="난이도 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {difficulties.map((difficulty) => (
                      <SelectItem key={difficulty} value={difficulty}>
                        {difficulty}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Source Information */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-sm text-gray-700">출처 정보 (선택)</h4>
                {activeSourceConfig && (
                  <Badge variant="outline" className="text-xs">
                    {activeSourceConfig.type_name} 설정 적용 중
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="source_type">출처 종류</Label>
                  {sourceConfigs.length > 0 ? (
                    <Select
                      value={formData.source_type}
                      onValueChange={(value) => setFormData({ ...formData, source_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="출처 종류 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceConfigs.map((config) => (
                          <SelectItem key={config.id} value={config.type_name}>
                            {config.type_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id="source_type"
                      placeholder="예: 모의고사, 수능"
                      value={formData.source_type}
                      onChange={(e) => setFormData({ ...formData, source_type: e.target.value })}
                    />
                  )}
                </div>

                {[1, 2, 3, 4].map((num) => {
                  const labelKey = `source_${num}_label` as keyof SourceConfig
                  const optionsKey = `source_${num}_options` as keyof SourceConfig
                  const fieldKey = `source_${num}` as keyof typeof formData
                  
                  const label = activeSourceConfig?.[labelKey] 
                    ? (activeSourceConfig[labelKey] as string)
                    : `출처 ${num} (상세)`
                  
                  const options = activeSourceConfig?.[optionsKey] as string[] | undefined

                  return (
                    <div key={num} className="space-y-2">
                      <Label htmlFor={`source_${num}`}>{label}</Label>
                      {options && options.length > 0 ? (
                        <Select
                          value={formData[fieldKey] as string}
                          onValueChange={(value) => setFormData({ ...formData, [fieldKey]: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`${label} 선택`} />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          id={`source_${num}`}
                          placeholder={`예: ${num === 1 ? '2023년 3월' : '상세 정보'}`}
                          value={formData[fieldKey] as string}
                          onChange={(e) => setFormData({ ...formData, [fieldKey]: e.target.value })}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            
            {/* Submit Button */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                문제 업로드
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
      
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) {
          resetProblemTypeForm()
          setDeleteConfirmId(null)
        }
      }}>
        {/* max-w-none를 사용하여 기본 max-width 제한을 제거하고 Resizable이 크기를 제어하도록 함 */}
        {/* flex justify-center items-center를 추가하여 화면 정중앙에 위치하도록 명시함 */}
        <DialogContent 
          className="max-w-none w-auto p-0 border-0 bg-transparent shadow-none flex justify-center items-center"
          onInteractOutside={(e) => e.preventDefault()} // 영역 밖 클릭 시 닫힘 방지
          showCloseButton={false} // 기본 닫기 버튼 숨김
        >
          {/* Resizable 컴포넌트로 감싸서 크기 조절 기능 추가 */}
          <Resizable
            defaultSize={{
              width: 1000,
              height: 'auto',
            }}
            minWidth={800}
            minHeight={600}
            className="bg-white rounded-lg border shadow-lg flex flex-col overflow-hidden relative" // relative 추가 (닫기 버튼 배치를 위해)
            enable={{
              top: false,
              right: true,
              bottom: true,
              left: false,
              topRight: false,
              bottomRight: true,
              bottomLeft: false,
              topLeft: false,
            }}
          >
            {/* 커스텀 닫기 버튼 (우측 상단) */}
            <button
              onClick={() => setIsDialogOpen(false)}
              className="absolute right-4 top-4 p-2 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground z-50"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>

            {/* 실제 컨텐츠 영역 */}
            <div className="flex flex-col h-full w-full">
              <DialogHeader className="p-6 pb-2 pr-12"> {/* 닫기 버튼 공간 확보를 위해 pr-12 추가 */}
                <DialogTitle>문제 유형 관리</DialogTitle>
                <DialogDescription>
                  문제 유형을 추가, 수정, 삭제할 수 있습니다.
                </DialogDescription>
              </DialogHeader>
              
              <div className="flex gap-6 p-6 pt-2 h-full overflow-hidden">
                {/* Left Sidebar - Problem Type List */}
                <div className="w-1/3 border-r pr-4 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <h3 className="font-medium text-sm text-gray-700">기존 문제 유형</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={fetchAllProblemTypes}
                      disabled={isLoadingTypes}
                      className="h-7 w-7"
                    >
                      <RefreshCw className={`h-4 w-4 ${isLoadingTypes ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                  
                  <div className="overflow-y-auto space-y-2 pr-1 flex-1">
                    {isLoadingTypes ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                      </div>
                    ) : allProblemTypes.length === 0 ? (
                      <p className="text-sm text-gray-500 text-center py-8">
                        등록된 문제 유형이 없습니다.
                      </p>
                    ) : (
                      allProblemTypes.map((type) => (
                        <div
                          key={type.id}
                          className={`p-3 rounded-lg border transition-colors ${
                            editingType?.id === type.id
                              ? 'border-primary bg-primary/5'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{type.type_name}</p>
                              {type.description && (
                                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                                  {type.description}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {type.is_active === false ? (
                                  <Badge variant="secondary" className="text-xs">비활성</Badge>
                                ) : (
                                  <Badge className="bg-green-100 text-green-700 text-xs">활성</Badge>
                                )}
                                {type.provider && (
                                  <Badge variant="outline" className="text-xs">{type.provider}</Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleEditProblemType(type)}
                                title="수정"
                              >
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setDeleteConfirmId(type.id)}
                                title="삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                          
                          {/* Delete Confirmation */}
                          {deleteConfirmId === type.id && (
                            <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                              <p className="text-xs text-red-700 mb-2">정말 삭제하시겠습니까?</p>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-xs"
                                  onClick={() => handleDeleteProblemType(type.id)}
                                  disabled={isDeleting}
                                >
                                  {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : '삭제'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => setDeleteConfirmId(null)}
                                  disabled={isDeleting}
                                >
                                  취소
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                
                {/* Right Side - Form */}
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <h3 className="font-medium text-sm text-gray-700">
                      {editingType ? '문제 유형 수정' : '새 문제 유형 추가'}
                    </h3>
                    {editingType && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetProblemTypeForm}
                        className="text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        새로 추가
                      </Button>
                    )}
                  </div>
                  
                  <div className="space-y-4 overflow-y-auto flex-1 pr-2">
                    <div className="space-y-2">
                      <Label htmlFor="type_name">문제 유형 이름 *</Label>
                      <Input
                        id="type_name"
                        placeholder="예: 문장삽입형 문제"
                        value={newProblemType.type_name}
                        onChange={(e) => setNewProblemType({ ...newProblemType, type_name: e.target.value })}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="description">설명 (선택)</Label>
                      <Textarea
                        id="description"
                        placeholder="문제 유형에 대한 간단한 설명"
                        value={newProblemType.description}
                        onChange={(e) => setNewProblemType({ ...newProblemType, description: e.target.value })}
                        rows={3}
                      />
                    </div>
                    
                    {editingType && (
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="is_active"
                          checked={newProblemType.is_active}
                          onChange={(e) => setNewProblemType({ ...newProblemType, is_active: e.target.checked })}
                          className="rounded border-gray-300"
                        />
                        <Label htmlFor="is_active" className="text-sm font-normal cursor-pointer">
                          활성화 상태
                        </Label>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-end gap-2 mt-6 shrink-0 pt-4 border-t">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setIsDialogOpen(false)
                        resetProblemTypeForm()
                      }} 
                      disabled={isAddingProblemType}
                    >
                      닫기
                    </Button>
                    {editingType ? (
                      <Button 
                        onClick={handleUpdateProblemType} 
                        disabled={isAddingProblemType || !newProblemType.type_name.trim()}
                      >
                        {isAddingProblemType && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        저장
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleAddProblemType} 
                        disabled={isAddingProblemType || !newProblemType.type_name.trim()}
                      >
                        {isAddingProblemType && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        추가
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Resizable>
        </DialogContent>
      </Dialog>
    </>
  )
}
