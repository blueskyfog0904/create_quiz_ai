export interface QuestionBankYear {
  id: string
  year: number
  label: string
  sort: number
  isActive: boolean
}

export interface QuestionBankBook {
  id: string
  name: string
  slug: string
  description: string | null
  sort: number
  isActive: boolean
}

export interface QuestionBankAvailability {
  problemTypeId: string
  availableCount: number
}

export interface RandomExamTypeCount {
  problemTypeId: string
  count: number
}

export interface RandomExamValidationError {
  code:
    | 'missing_title'
    | 'empty_type_counts'
    | 'invalid_problem_type_id'
    | 'invalid_count'
    | 'duplicate_problem_type'
    | 'total_over_limit'
    | 'insufficient_availability'
  field: 'title' | 'typeCounts'
  message: string
  problemTypeId?: string
}

export interface RandomExamValidationResult {
  isValid: boolean
  errors: RandomExamValidationError[]
}
