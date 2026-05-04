export interface QuestionBankYear {
  id: string
  title: string
}

export interface QuestionBankBook {
  id: string
  title: string
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
