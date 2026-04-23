export const answerOnlyDoubleOverflowFixture = {
  title: 'answer-only overflow fixture',
  description: '2단 answer-only overflow 최소 재현 fixture',
  viewMode: 'answer-only',
  columnLayout: 'double',
  questions: [
    {
      number: 1,
      questionText: 'unused',
      questionTextForward: null,
      questionTextBackward: null,
      passageText: null,
      choices: [],
      answer: '①',
      explanation: Array.from({ length: 12 }, (_, index) => (
        `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
      )).join(' '),
    },
  ],
}
