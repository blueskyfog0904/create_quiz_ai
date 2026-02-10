'use client'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { exportToPDF, exportToWord } from '@/lib/export-utils'
import { exportToHwpx } from '@/lib/hwpx-generator'
import { toast } from 'sonner'
import { useState } from 'react'
import type { ViewMode } from './exam-paper-view'

export type ColumnLayout = 'single' | 'double'

interface Choice {
  label: string
  text: string
}

interface Question {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: Choice[]
  answer: string
  explanation: string
}

interface ExportButtonsProps {
  examPaper: {
    paper_title: string
    description?: string | null
  }
  questions: Question[]
  viewMode: ViewMode
}

export function ExportButtons({ examPaper, questions, viewMode }: ExportButtonsProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [columnLayout, setColumnLayout] = useState<ColumnLayout>('single')

  const handleExportPDF = async () => {
    setIsExporting(true)
    try {
      await exportToPDF({
        title: examPaper.paper_title,
        description: examPaper.description || undefined,
        questions,
        viewMode,
        columnLayout
      })
      toast.success('PDF 파일이 다운로드되었습니다.')
    } catch (error) {
      console.error('PDF export error:', error)
      toast.error('PDF 생성 중 오류가 발생했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportWord = async () => {
    setIsExporting(true)
    try {
      await exportToWord({
        title: examPaper.paper_title,
        description: examPaper.description || undefined,
        questions,
        viewMode,
        columnLayout
      })
      toast.success('Word 파일이 다운로드되었습니다.')
    } catch (error) {
      console.error('Word export error:', error)
      toast.error('Word 파일 생성 중 오류가 발생했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportHwpx = async () => {
    setIsExporting(true)
    try {
      await exportToHwpx({
        title: examPaper.paper_title,
        description: examPaper.description || undefined,
        questions,
        viewMode,
        columnLayout
      })
      toast.success('한글(HWPX) 파일이 다운로드되었습니다.')
    } catch (error) {
      console.error('HWPX export error:', error)
      toast.error('한글 파일 생성 중 오류가 발생했습니다.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {/* Layout Selector */}
      <div className="flex items-center justify-center gap-4">
        <Label className="text-sm font-medium">레이아웃</Label>
        <Select value={columnLayout} onValueChange={(value) => setColumnLayout(value as ColumnLayout)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">1단</SelectItem>
            <SelectItem value="double">2단</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-gray-500">
          {columnLayout === 'double' ? '(페이지 공간 절약)' : '(기본)'}
        </span>
      </div>

      {/* Export Buttons */}
      <div className="flex gap-4 justify-center">
        <Button 
          size="lg" 
          variant="outline"
          onClick={handleExportPDF}
          disabled={isExporting}
        >
          📄 {isExporting ? 'PDF 생성 중...' : 'PDF로 저장'}
        </Button>
        <Button 
          size="lg" 
          variant="outline"
          onClick={handleExportWord}
          disabled={isExporting}
        >
          📝 {isExporting ? 'Word 생성 중...' : 'Word로 저장'}
        </Button>
        <Button 
          size="lg" 
          variant="outline"
          onClick={handleExportHwpx}
          disabled={isExporting}
        >
          📄 {isExporting ? '한글 생성 중...' : '한글(HWP)로 저장'}
        </Button>
      </div>
    </div>
  )
}


