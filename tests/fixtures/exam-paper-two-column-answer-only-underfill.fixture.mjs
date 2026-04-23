export const answerOnlyDoubleUnderfillFixture = {
  title: 'answer-only underfill fixture',
  description: '2단 answer-only underfill 최소 재현 fixture',
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
      explanation: 'Short explanation to seed the page before the continued answer.',
    },
    {
      number: 2,
      questionText: 'unused',
      questionTextForward: null,
      questionTextBackward: null,
      passageText: null,
      choices: [],
      answer: '②',
      explanation: Array.from({ length: 6 }, (_, index) => (
        `Explanation sentence ${index + 1} clarifies the reason for the answer with enough detail to create a continuation decision near the lower column boundary.`
      )).join(' '),
    },
  ],
}
