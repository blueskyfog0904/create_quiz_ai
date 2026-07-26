'use client'

import type { ReactNode } from 'react'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

interface DetailTabsProps {
  questionCount: number
  information: ReactNode
  passage: ReactNode
  questions: ReactNode
  sample: ReactNode
  guide: ReactNode
}

export function DetailTabs({
  questionCount,
  information,
  passage,
  questions,
  sample,
  guide,
}: DetailTabsProps) {
  return (
    <Tabs defaultValue="information" className="gap-0">
      <div className="overflow-x-auto border-b border-[var(--studio-border)]">
        <TabsList
          variant="line"
          aria-label="자료 상세 메뉴"
          className="h-14 min-w-max gap-5 px-1"
        >
          <TabsTrigger value="information" className="min-h-11 px-2 font-bold">
            자료 정보
          </TabsTrigger>
          <TabsTrigger value="passage" className="min-h-11 px-2 font-bold">
            지문 구조
          </TabsTrigger>
          <TabsTrigger value="questions" className="min-h-11 px-2 font-bold">
            포함 문항 {questionCount}
          </TabsTrigger>
          <TabsTrigger value="sample" className="min-h-11 px-2 font-bold">
            샘플 보기
          </TabsTrigger>
          <TabsTrigger value="guide" className="min-h-11 px-2 font-bold">
            이용 안내
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="information" className="pt-8">
        {information}
      </TabsContent>
      <TabsContent value="passage" className="pt-8">
        {passage}
      </TabsContent>
      <TabsContent value="questions" className="pt-8">
        {questions}
      </TabsContent>
      <TabsContent value="sample" className="pt-8">
        {sample}
      </TabsContent>
      <TabsContent value="guide" className="pt-8">
        {guide}
      </TabsContent>
    </Tabs>
  )
}
