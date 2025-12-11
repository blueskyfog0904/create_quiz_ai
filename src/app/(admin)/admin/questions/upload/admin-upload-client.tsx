'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Plus, X, Download, Upload, FileSpreadsheet, CheckCircle2, Trash2, AlertCircle, Edit, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'

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
}

// Parsed question from Excel file
interface ParsedQuestion {
  id: string
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
  isValid: boolean
  errorMessage?: string
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

export default function AdminUploadClient({ problemTypes, gradeLevels, difficulties }: AdminUploadClientProps) {
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Problem Type Management states
  const [allProblemTypes, setAllProblemTypes] = useState<ProblemType[]>([])
  const [editingType, setEditingType] = useState<ProblemType | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  
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
      const response = await fetch('/api/admin/problem-types')
      if (!response.ok) throw new Error('Failed to fetch')
      const data = await response.json()
      setAllProblemTypes(data.types || [])
    } catch (error) {
      console.error('Error fetching problem types:', error)
      toast.error('문제 유형 목록을 불러오는데 실패했습니다.')
    } finally {
      setIsLoadingTypes(false)
    }
  }, [])
  
  // Fetch problem types when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      fetchAllProblemTypes()
    }
  }, [isDialogOpen, fetchAllProblemTypes])
  
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
      const response = await fetch(`/api/admin/problem-types/${editingType.id}`, {
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
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsAddingProblemType(false)
    }
  }
  
  // Handle delete problem type
  const handleDeleteProblemType = async (id: string) => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/admin/problem-types/${id}`, {
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
    } catch (error: any) {
      toast.error(error.message)
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
      
      const response = await fetch('/api/admin/problem-types', {
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
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsAddingProblemType(false)
    }
  }
  
  // Bulk upload handlers
  const handleDownloadTemplate = async () => {
    setIsDownloadingTemplate(true)
    try {
      const response = await fetch('/api/admin/questions/template')
      
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
    } catch (error: any) {
      toast.error(error.message)
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
      
      const response = await fetch('/api/admin/questions/bulk-upload', {
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
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsParsing(false)
    }
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileParse(file)
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }
  
  const handleDrop = (e: React.DragEvent) => {
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
  
  // Update parsed question
  const handleUpdateParsedQuestion = (id: string, field: string, value: string | string[]) => {
    setParsedQuestions(prev => prev.map(q => {
      if (q.id === id) {
        const updated = { ...q, [field]: value }
        // Revalidate
        updated.isValid = validateParsedQuestion(updated)
        if (updated.isValid) {
          updated.errorMessage = undefined
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
        updated.isValid = validateParsedQuestion(updated)
        if (updated.isValid) {
          updated.errorMessage = undefined
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
  
  // Bulk save all parsed questions
  const handleBulkSave = async () => {
    const validQuestions = parsedQuestions.filter(q => q.isValid)
    
    if (validQuestions.length === 0) {
      toast.error('업로드할 유효한 문제가 없습니다.')
      return
    }
    
    setIsBulkSaving(true)
    
    const circledNumbers = ['①', '②', '③', '④', '⑤']
    let successCount = 0
    let failCount = 0
    
    for (const question of validQuestions) {
      try {
        console.log('[Client Bulk Save] Processing question:', {
          id: question.id,
          question_text: question.question_text,
          originalChoices: question.choices,
          originalChoicesLength: question.choices.length,
          originalChoicesType: typeof question.choices,
          originalChoicesIsArray: Array.isArray(question.choices)
        })
        
        // Format choices (선택사항 - 빈 배열도 허용)
        const validChoices = question.choices.filter(c => c.trim())
        console.log('[Client Bulk Save] Valid choices after filter:', {
          validChoices,
          validChoicesLength: validChoices.length,
          originalChoicesLength: question.choices.length
        })
        
        // 빈 배열도 DB에 저장 (null 대신 빈 배열)
        const formattedChoices = validChoices.length > 0
          ? validChoices.map((choice, index) => ({
              label: circledNumbers[index],
              text: choice
            }))
          : [] // 빈 배열로 저장
        
        console.log('[Client Bulk Save] Formatted choices:', {
          formattedChoices,
          formattedChoicesLength: formattedChoices.length,
          formattedChoicesType: typeof formattedChoices,
          formattedChoicesIsArray: Array.isArray(formattedChoices),
          formattedChoicesJSON: JSON.stringify(formattedChoices)
        })
        
        // Format answer
        let formattedAnswer = question.answer.trim()
        const answerNum = parseInt(formattedAnswer)
        if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
          formattedAnswer = circledNumbers[answerNum - 1]
        }
        
        const requestBody = {
          question_text: question.question_text,
          question_text_forward: question.question_text_forward || undefined,
          question_text_backward: question.question_text_backward || undefined,
          passage_text: question.passage_text || undefined,
          answer: formattedAnswer,
          choices: formattedChoices,
          explanation: question.explanation || undefined,
          difficulty: question.difficulty || undefined,
          grade_level: question.grade_level || undefined,
          problem_type_id: question.problem_type_id,
        }
        
        console.log('[Client Bulk Save] Request body:', JSON.stringify(requestBody, null, 2))
        console.log('[Client Bulk Save] Request body choices:', {
          choices: requestBody.choices,
          choicesType: typeof requestBody.choices,
          choicesIsArray: Array.isArray(requestBody.choices),
          choicesLength: Array.isArray(requestBody.choices) ? requestBody.choices.length : 'N/A',
          choicesJSON: JSON.stringify(requestBody.choices)
        })
        
        const response = await fetch('/api/admin/questions/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
        
        const responseData = await response.json().catch(() => ({}))
        console.log('[Client Bulk Save] Response status:', response.status)
        console.log('[Client Bulk Save] Response data:', JSON.stringify(responseData, null, 2))
        
        if (response.ok) {
          console.log('[Client Bulk Save] Question saved successfully:', question.id)
          successCount++
        } else {
          console.error('[Client Bulk Save] Failed to save question:', {
            questionId: question.id,
            status: response.status,
            error: responseData.error,
            details: responseData.details
          })
          failCount++
        }
      } catch (error: any) {
        console.error('[Client Bulk Save] Exception while saving question:', {
          questionId: question.id,
          error: error.message,
          stack: error.stack
        })
        failCount++
      }
    }
    
    setIsBulkSaving(false)
    
    if (successCount > 0) {
      toast.success(`${successCount}개의 문제가 성공적으로 업로드되었습니다.`)
      // Remove successfully uploaded questions
      setParsedQuestions([])
      router.refresh()
    }
    
    if (failCount > 0) {
      toast.error(`${failCount}개의 문제 업로드에 실패했습니다.`)
    }
  }
  
  // Single upload submit
  const handleSubmit = async (e: React.FormEvent) => {
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
      
      let formattedAnswer = formData.answer.trim()
      const answerNum = parseInt(formattedAnswer)
      if (!isNaN(answerNum) && answerNum >= 1 && answerNum <= 5) {
        formattedAnswer = circledNumbers[answerNum - 1]
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
      }
      
      console.log('[Client Single Upload] Request body:', JSON.stringify(requestBody, null, 2))
      console.log('[Client Single Upload] Request body choices:', {
        choices: requestBody.choices,
        choicesType: typeof requestBody.choices,
        choicesIsArray: Array.isArray(requestBody.choices),
        choicesLength: Array.isArray(requestBody.choices) ? requestBody.choices.length : 'N/A',
        choicesJSON: JSON.stringify(requestBody.choices)
      })
      
      const response = await fetch('/api/admin/questions/upload', {
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
      })
      
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const validCount = parsedQuestions.filter(q => q.isValid).length
  const invalidCount = parsedQuestions.filter(q => !q.isValid).length
  
  return (
    <>
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
      
      {/* Problem Type Management Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        setIsDialogOpen(open)
        if (!open) {
          resetProblemTypeForm()
          setDeleteConfirmId(null)
        }
      }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>문제 유형 관리</DialogTitle>
            <DialogDescription>
              문제 유형을 추가, 수정, 삭제할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex gap-6 py-4">
            {/* Left Sidebar - Problem Type List */}
            <div className="w-1/3 border-r pr-4">
              <div className="flex items-center justify-between mb-3">
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
              
              <div className="max-h-[400px] overflow-y-auto space-y-2 pr-1">
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
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
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
              
              <div className="space-y-4">
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
              
              <div className="flex justify-end gap-2 mt-6">
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
        </DialogContent>
      </Dialog>
    </>
  )
}
