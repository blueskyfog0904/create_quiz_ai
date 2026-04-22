const basePassageParts = [
  'From an organizational viewpoint, teams rarely fail because they lack information. They fail because crucial details arrive in forms that do not fit the limited attention available to each decision maker.',
  'When the same report must be understood by leaders, teachers, and students, the most effective documents are the ones that preserve order while breaking the message into smaller readable units.',
  'If a page layout treats a long passage as one indivisible block, the remaining whitespace on that page cannot be reused even when the next sentence would have fit comfortably in the open space.',
]

const longPassage = [...basePassageParts, ...basePassageParts].join(' ')

export const underfillExamPaper = {
  title: '언더필 테스트',
  description: '2단 첫 칼럼 여백을 재현하는 고정 fixture',
  viewMode: 'exam-only',
  columnLayout: 'double',
  questions: [
    {
      number: 1,
      questionText: '다음 글의 핵심 내용을 고르시오.',
      questionTextForward: null,
      passageText: longPassage,
      questionTextBackward: null,
      choices: [],
      answer: '',
      explanation: '',
    },
  ],
}
