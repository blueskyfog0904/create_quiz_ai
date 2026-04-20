/**
 * @typedef {{
 *   number: number
 *   questionText: string
 *   questionTextForward?: string | null
 *   questionTextBackward?: string | null
 *   passageText?: string | null
 *   choices: { label: string, text: string }[]
 *   answer: string
 *   explanation: string
 * }} PrintQuestion
 */

function estimatePrintQuestionWeight(question, showQuestions, showAnswers, isDoubleColumn) {
  let weight = isDoubleColumn ? 12 : 16

  if (showQuestions) {
    weight += Math.ceil(question.questionText.length / (isDoubleColumn ? 48 : 72))
    weight += Math.ceil((question.questionTextForward?.length ?? 0) / (isDoubleColumn ? 56 : 84))
    weight += Math.ceil((question.questionTextBackward?.length ?? 0) / (isDoubleColumn ? 56 : 84))
    weight += Math.ceil((question.passageText?.length ?? 0) / (isDoubleColumn ? 56 : 84))
    weight += question.choices.reduce((sum, choice) => (
      sum + Math.max(1, Math.ceil((choice.label.length + choice.text.length) / (isDoubleColumn ? 54 : 80)))
    ), 0)
  }

  if (showAnswers) {
    weight += Math.max(1, Math.ceil(question.answer.length / (isDoubleColumn ? 56 : 84)))
    weight += Math.ceil(question.explanation.length / (isDoubleColumn ? 60 : 90))
  }

  return weight
}

/**
 * @param {{
 *   questions: PrintQuestion[]
 *   showQuestions: boolean
 *   showAnswers: boolean
 *   isDoubleColumn: boolean
 *   hasDescription: boolean
 * }} input
 */
export function paginateExamPaperQuestions(input) {
  const {
    questions,
    showQuestions,
    showAnswers,
    isDoubleColumn,
    hasDescription,
  } = input

  const firstPageCapacity = isDoubleColumn
    ? (hasDescription ? 62 : 66)
    : (hasDescription ? 78 : 88)
  const otherPageCapacity = isDoubleColumn ? 72 : 96

  return questions.reduce((pages, question) => {
    const weight = estimatePrintQuestionWeight(question, showQuestions, showAnswers, isDoubleColumn)
    const currentPage = pages[pages.length - 1]
    const pageIndex = pages.length - 1
    const currentWeight = currentPage.reduce((sum, item) => (
      sum + estimatePrintQuestionWeight(item, showQuestions, showAnswers, isDoubleColumn)
    ), 0)
    const capacity = pageIndex === 0 ? firstPageCapacity : otherPageCapacity

    if (currentPage.length > 0 && currentWeight + weight > capacity) {
      pages.push([question])
      return pages
    }

    currentPage.push(question)
    return pages
  }, [[]]).filter((page) => page.length > 0)
}
