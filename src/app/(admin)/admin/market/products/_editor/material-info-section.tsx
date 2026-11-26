import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { MARKET_ITEM_SOURCE_MAX } from '@/lib/market-item-options'
import { MONTH_OPTIONS, SOURCE_FIELDS } from '../_lib/product-form'
import type { ProductAdminContext } from '../market-products-client'

export function MaterialInfoSection({ ctx }: { ctx: ProductAdminContext }) {
  const {
    form, setForm, productOptionChoices,
  } = ctx

  return (
    <>
              <div className="space-y-2">
                <Label>상세 설명</Label>
                <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-[140px]" />
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium text-gray-900">자료 정보</p>
                  <p className="text-sm text-gray-500">상세 페이지 자료 정보 카드에 노출되는 값을 입력합니다. 과목과 등록일자는 자동으로 표시됩니다.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>학년</Label>
                    <select
                      value={form.gradeLevel}
                      onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))}
                      className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                    >
                      {productOptionChoices('grade', form.gradeLevel).map((choice) => (
                        <option key={choice.value} value={choice.value}>{choice.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>자료유형</Label>
                    <select
                      value={form.sourceType}
                      onChange={(event) => setForm((current) => ({ ...current, sourceType: event.target.value }))}
                      className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                    >
                      {productOptionChoices('material_type', form.sourceType).map((choice) => (
                        <option key={choice.value} value={choice.value}>{choice.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>문항 수</Label>
                    <Input type="number" min={0} value={form.questionCount} onChange={(event) => setForm((current) => ({ ...current, questionCount: event.target.value }))} placeholder="예: 24" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    {SOURCE_FIELDS.map((field, index) => (
                      <div key={field} className="space-y-1">
                        <Label htmlFor={`market-item-${field}`}>출처 {index + 1}</Label>
                        <Input
                          id={`market-item-${field}`}
                          value={form[field]}
                          maxLength={MARKET_ITEM_SOURCE_MAX}
                          onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">상세 &apos;출처&apos;에 입력한 순서대로 &apos; · &apos;로 이어 보입니다. 칸마다 {MARKET_ITEM_SOURCE_MAX}자까지 입력합니다.</p>
                </div>
              </div>
    </>
  )
}

export function ExamScheduleFields({ ctx }: { ctx: ProductAdminContext }) {
  const {
    form, setForm, examYearOptions, isExamYearOpen, setIsExamYearOpen, currentExamYear, scrollExamYearListToAnchor,
    pickExamYear,
  } = ctx

  return (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>연도</Label>
                  <Popover open={isExamYearOpen} onOpenChange={setIsExamYearOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" aria-label="연도" className="flex h-10 w-full items-center justify-between rounded-md border bg-white px-3 text-sm">
                        <span className={form.examYear ? 'text-gray-900' : 'text-gray-500'}>{form.examYear || '선택'}</span>
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
                      <div ref={scrollExamYearListToAnchor} role="listbox" aria-label="연도" className="relative max-h-64 overflow-y-auto">
                        <button
                          type="button"
                          role="option"
                          aria-selected={!form.examYear}
                          onClick={() => pickExamYear('')}
                          className="flex w-full rounded px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-gray-100"
                        >
                          선택 안 함
                        </button>
                        {examYearOptions.map((year) => (
                          <button
                            key={year}
                            type="button"
                            role="option"
                            data-year={year}
                            aria-selected={form.examYear === year}
                            onClick={() => pickExamYear(year)}
                            className={`flex w-full items-center justify-between rounded px-3 py-1.5 text-left text-sm hover:bg-gray-100 ${
                              form.examYear === year ? 'bg-gray-900 font-medium text-white hover:bg-gray-800' : 'text-gray-900'
                            }`}
                          >
                            {year}
                            {year === currentExamYear ? <span className={`text-xs ${form.examYear === year ? 'text-gray-300' : 'text-blue-600'}`}>올해</span> : null}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>월</Label>
                  <select
                    value={form.examMonth}
                    onChange={(event) => setForm((current) => ({ ...current, examMonth: event.target.value }))}
                    className="flex h-10 w-full rounded-md border bg-white px-3 text-sm"
                  >
                    <option value="">선택</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month} value={month}>{month}월</option>
                    ))}
                  </select>
                </div>
              </div>
  )
}
