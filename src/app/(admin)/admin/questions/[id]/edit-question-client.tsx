'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertTriangle,
  ArrowLeft,
  Save,
  RefreshCw,
  Trash2,
  Plus,
  X,
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
  problem_types: { id: string; type_name: string } | null
  profiles: { id: string; name: string | null; email: string | null } | null
}

interface EditQuestionClientProps {
  questionId: string
}

const gradeLevels = ['중1', '중2', '중3', '고1', '고2', '고3']
const difficulties = ['하', '중', '상']

export function EditQuestionClient({ questionId }: EditQuestionClientProps) {
  const router = useRouter()
  const [question, setQuestion] = useState<Question | null>(null)
  const [problemTypes, setProblemTypes] = useState<Array<{ id: string; type_name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    question_text: '',
    question_text_forward: '',
    question_text_backward: '',
    passage_text: '',
    choices: [
      { label: '①', text: '' },
      { label: '②', text: '' },
      { label: '③', text: '' },
      { label: '④', text: '' },
      { label: '⑤', text: '' },
    ],
    answer: '',
    explanation: '',
    grade_level: '',
    difficulty: '',
    problem_type_id: '',
    source: '',
  })

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch question and problem types in parallel
        const [questionRes, typesRes] = await Promise.all([
          fetch(`/api/admin/questions/${questionId}`),
          fetch('/api/admin/problem-types'),
        ])

        if (!questionRes.ok) throw new Error('Failed to fetch question')
        
        const { question: fetchedQuestion } = await questionRes.json()
        
        let types: Array<{ id: string; type_name: string }> = []
        if (typesRes.ok) {
          const typesData = await typesRes.json()
          types = typesData.types || typesData || []
        }

        setQuestion(fetchedQuestion)
        setProblemTypes(types)
        
        // Initialize form data
        setFormData({
          question_text: fetchedQuestion.question_text || '',
          question_text_forward: fetchedQuestion.question_text_forward || '',
          question_text_backward: fetchedQuestion.question_text_backward || '',
          passage_text: fetchedQuestion.passage_text || '',
          choices: fetchedQuestion.choices || [
            { label: '①', text: '' },
            { label: '②', text: '' },
            { label: '③', text: '' },
            { label: '④', text: '' },
            { label: '⑤', text: '' },
          ],
          answer: fetchedQuestion.answer || '',
          explanation: fetchedQuestion.explanation || '',
          grade_level: fetchedQuestion.grade_level || '',
          difficulty: fetchedQuestion.difficulty || '',
          problem_type_id: fetchedQuestion.problem_type_id || '',
          source: fetchedQuestion.source || '',
        })
        
        setError(null)
      } catch (err) {
        setError('문제를 불러오는데 실패했습니다.')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [questionId])

  const handleChoiceChange = (index: number, value: string) => {
    const newChoices = [...formData.choices]
    newChoices[index] = { ...newChoices[index], text: value }
    setFormData({ ...formData, choices: newChoices })
  }

  const addChoice = () => {
    const labels = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
    const nextLabel = labels[formData.choices.length] || `${formData.choices.length + 1}`
    setFormData({
      ...formData,
      choices: [...formData.choices, { label: nextLabel, text: '' }],
    })
  }

  const removeChoice = (index: number) => {
    if (formData.choices.length <= 2) return
    const newChoices = formData.choices.filter((_, i) => i !== index)
    setFormData({ ...formData, choices: newChoices })
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_text: formData.question_text,
          question_text_forward: formData.question_text_forward || null,
          question_text_backward: formData.question_text_backward || null,
          passage_text: formData.passage_text || null,
          choices: formData.choices,
          answer: formData.answer,
          explanation: formData.explanation || null,
          grade_level: formData.grade_level || null,
          difficulty: formData.difficulty || null,
          problem_type_id: formData.problem_type_id || null,
          source: formData.source || null,
        }),
      })

      if (!response.ok) throw new Error('Failed to save')

      const { question: updatedQuestion } = await response.json()
      setQuestion(updatedQuestion)
      
      alert('문제가 저장되었습니다.')
    } catch (err) {
      console.error(err)
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('이 문제를 정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return

    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete')

      alert('문제가 삭제되었습니다.')
      router.push('/admin/questions')
    } catch (err) {
      console.error(err)
      alert('삭제에 실패했습니다.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error || !question) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <p className="text-gray-600">{error || '문제를 찾을 수 없습니다.'}</p>
        <Link href="/admin/questions">
          <Button className="mt-4">문제 목록으로</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/questions">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">문제 수정</h1>
            <p className="text-sm text-gray-500 mt-1">
              생성일: {new Date(question.created_at).toLocaleDateString('ko-KR')} •
              수정일: {new Date(question.updated_at).toLocaleDateString('ko-KR')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            삭제
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? '저장 중...' : '저장'}
          </Button>
        </div>
      </div>

      {/* Meta Info */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">
              ID: {question.id.slice(0, 8)}...
            </Badge>
            <Badge variant="outline">
              업로더: {question.profiles?.name || question.profiles?.email || '알 수 없음'}
            </Badge>
            {question.problem_types && (
              <Badge className="bg-blue-100 text-blue-700">
                {question.problem_types.type_name}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Passage */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">지문</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="지문이 있는 경우 입력하세요..."
                rows={6}
                value={formData.passage_text}
                onChange={(e) => setFormData({ ...formData, passage_text: e.target.value })}
                className="resize-none"
              />
            </CardContent>
          </Card>

          {/* Question Text */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">문제</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>문제 본문 *</Label>
                <Textarea
                  placeholder="문제 내용을 입력하세요..."
                  rows={3}
                  value={formData.question_text}
                  onChange={(e) => setFormData({ ...formData, question_text: e.target.value })}
                  className="resize-none mt-1"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>문제 (앞부분)</Label>
                  <Input
                    placeholder="선택지 앞에 올 텍스트"
                    value={formData.question_text_forward}
                    onChange={(e) => setFormData({ ...formData, question_text_forward: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>문제 (뒷부분)</Label>
                  <Input
                    placeholder="선택지 뒤에 올 텍스트"
                    value={formData.question_text_backward}
                    onChange={(e) => setFormData({ ...formData, question_text_backward: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Choices */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">선택지</CardTitle>
              <Button variant="outline" size="sm" onClick={addChoice}>
                <Plus className="h-4 w-4 mr-1" />
                추가
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {formData.choices.map((choice, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-8 text-center font-medium text-gray-500">
                    {choice.label}
                  </span>
                  <Input
                    placeholder={`선택지 ${index + 1}`}
                    value={choice.text}
                    onChange={(e) => handleChoiceChange(index, e.target.value)}
                    className={formData.answer === choice.label ? 'border-green-500 bg-green-50' : ''}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFormData({ ...formData, answer: choice.label })}
                    className={formData.answer === choice.label ? 'text-green-600' : 'text-gray-400'}
                    title="정답으로 설정"
                  >
                    {formData.answer === choice.label ? '✓' : '○'}
                  </Button>
                  {formData.choices.length > 2 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeChoice(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-500 mt-2">
                ○ 버튼을 클릭하여 정답을 선택하세요. 현재 정답: <Badge className="bg-green-500">{formData.answer || '미선택'}</Badge>
              </p>
            </CardContent>
          </Card>

          {/* Explanation */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">해설</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="문제 해설을 입력하세요..."
                rows={4}
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                className="resize-none"
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Settings */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">설정</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>학년</Label>
                <Select
                  value={formData.grade_level}
                  onValueChange={(value) => setFormData({ ...formData, grade_level: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="학년 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">선택 안함</SelectItem>
                    {gradeLevels.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>난이도</Label>
                <Select
                  value={formData.difficulty}
                  onValueChange={(value) => setFormData({ ...formData, difficulty: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="난이도 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">선택 안함</SelectItem>
                    {difficulties.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>문제 유형</Label>
                <Select
                  value={formData.problem_type_id}
                  onValueChange={(value) => setFormData({ ...formData, problem_type_id: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="유형 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">선택 안함</SelectItem>
                    {problemTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id}>{type.type_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>출처</Label>
                <Input
                  placeholder="예: 2024 수능, 교과서..."
                  value={formData.source}
                  onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          {/* Preview */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">미리보기</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-3 p-3 bg-gray-50 rounded-lg">
                {formData.passage_text && (
                  <div className="p-2 bg-blue-50 rounded text-xs text-gray-700 line-clamp-3">
                    {formData.passage_text}
                  </div>
                )}
                <p className="font-medium">
                  {formData.question_text || '문제 내용을 입력하세요'}
                </p>
                <div className="space-y-1">
                  {formData.choices.map((choice, idx) => (
                    <div
                      key={idx}
                      className={`text-xs p-1 rounded ${
                        choice.label === formData.answer ? 'bg-green-100' : ''
                      }`}
                    >
                      {choice.label} {choice.text || '...'}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

