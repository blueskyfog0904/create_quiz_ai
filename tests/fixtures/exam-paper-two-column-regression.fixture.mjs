const organizationalPassage = [
  'From an organizational viewpoint, one of the most fascinating examples of perceptual bias comes from the way departments interpret the same event.',
  'Marketing may focus on customer sentiment, finance may focus on margins, and operations may focus on deadlines, even when they are all looking at identical evidence.',
  'Because each division optimizes for a different local objective, the final decision often reflects competing partial truths rather than a fully shared perspective.'
].join(' ')

const climatePassage = [
  'When city planners redesign streets for climate resilience, they often discover that the technical solution is easier than the coordination problem.',
  'Drainage experts, transportation officials, neighborhood groups, and budget officers may all support the same goal while disagreeing about which inconvenience is acceptable.',
  'The final design succeeds only when each stakeholder can see the trade-off from the others\' perspective.'
].join(' ')

const memoryPassage = [
  'Memory researchers note that retrieval is not a neutral replay of stored facts.',
  'Each act of remembering reshapes the story, strengthening some details while weakening others, especially when later explanations feel more coherent than the original experience.',
  'As a result, confidence can rise even when fidelity falls.'
].join(' ')

const innovationPassage = [
  'Organizations that praise innovation in public may still reward predictability in private performance reviews.',
  'Employees quickly learn which message is ceremonial and which message determines advancement, so they adjust their risk-taking accordingly.',
  'If leaders want genuine experimentation, the system of incentives must support the language of creativity.'
].join(' ')

const attentionPassage = [
  'Attention is often described as a spotlight, but in practice it behaves more like a negotiation among competing goals.',
  'Urgent cues, unfinished tasks, and emotionally charged memories all bid for access to the limited workspace of conscious thought.',
  'The mind appears focused only because countless alternatives are being suppressed at the same time.'
].join(' ')

const ethicsPassage = [
  'Ethical failures in complex systems rarely begin with a single dramatic decision.',
  'They usually emerge through repeated small accommodations, each of which seems reasonable when viewed in isolation but damaging when viewed as a sequence.',
  'By the time the pattern is visible, responsibility has already been distributed across many hands.'
].join(' ')

export const regressionExamPaper = {
  title: '테스트 - 시험지',
  description: 'direct PDF 2단 저장 회귀를 고정하는 테스트 fixture',
  viewMode: 'exam-only',
  columnLayout: 'double',
  questions: [
    {
      number: 1,
      questionText: '다음 밑줄 친 부분이 의미하는 바로 가장 적절한 것은?',
      questionTextForward: '다음 글을 읽고, 밑줄 친 blind spot 의 의미를 고르시오.',
      passageText: organizationalPassage,
      questionTextBackward: 'Because departments within an organization inevitably possess blind spots, leaders should interpret disagreement as evidence that multiple partial viewpoints are colliding.',
      choices: [
        { label: '①', text: 'have a narrow perspective limited to their own department\'s interests' },
        { label: '②', text: 'develop a physical eye condition that restricts their field of view' },
        { label: '③', text: 'cooperate harmoniously with other divisions to achieve a common goal' },
        { label: '④', text: 'fail to perceive situations from the viewpoints of other departments' },
        { label: '⑤', text: 'strictly follow the vertical hierarchy and rules of the organization' },
      ],
      answer: '①, ④',
      explanation: '정답: ①, ④\n해설: 부서별로 보는 관점이 다르기 때문에 조직의 blind spot 은 특정 부서의 시야 제한과 타 부서 관점의 부재를 뜻한다.',
    },
    {
      number: 2,
      questionText: '다음 글의 요지로 가장 적절한 것은?',
      questionTextForward: null,
      passageText: climatePassage,
      questionTextBackward: 'Coordination succeeds when participants stop treating inconvenience as a purely technical variable and instead recognize whose burden each option creates.',
      choices: [
        { label: '①', text: 'Technical expertise alone is enough to guarantee policy agreement.' },
        { label: '②', text: 'Stakeholders reach durable agreement only when trade-offs are mutually legible.' },
        { label: '③', text: 'Budget officers usually resist climate resilience because it delays projects.' },
        { label: '④', text: 'Neighborhood groups should defer to transportation officials in design disputes.' },
        { label: '⑤', text: 'Infrastructure planning is most effective when citizens are excluded from review.' },
      ],
      answer: '②',
      explanation: '정답: ②\n해설: 글은 이해관계자들이 서로의 부담을 볼 수 있을 때 지속 가능한 합의가 가능하다고 말한다.',
    },
    {
      number: 3,
      questionText: '다음 글의 제목으로 가장 적절한 것은?',
      questionTextForward: '다음 글을 읽고 제목을 고르시오.',
      passageText: memoryPassage,
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'Why perfect memory is the basis of creativity' },
        { label: '②', text: 'How confidence grows as evidence disappears' },
        { label: '③', text: 'Why repeated rehearsal always preserves original meaning' },
        { label: '④', text: 'How memory eliminates the need for interpretation' },
        { label: '⑤', text: 'Why forgetting is unrelated to later explanation' },
      ],
      answer: '②',
      explanation: '정답: ②\n해설: 기억은 재생이 아니라 재구성이므로, 설명의 개연성이 높을수록 확신은 커질 수 있다.',
    },
    {
      number: 4,
      questionText: '다음 글에서 필자가 주장하는 바로 가장 적절한 것은?',
      questionTextForward: '다음 글을 읽고 필자의 주장을 고르시오.',
      passageText: innovationPassage,
      questionTextBackward: 'When formal praise and practical reward diverge, employees trust the reward structure, not the slogan.',
      choices: [
        { label: '①', text: 'Creative slogans are enough to sustain organizational experimentation.' },
        { label: '②', text: 'Innovation programs fail only when employees misunderstand the mission statement.' },
        { label: '③', text: 'Incentive systems must align with stated innovation goals.' },
        { label: '④', text: 'Predictable routines should replace risky experiments in all teams.' },
        { label: '⑤', text: 'Performance reviews matter less than public speeches in shaping behavior.' },
      ],
      answer: '③',
      explanation: '정답: ③\n해설: 표면적인 혁신 찬양보다 보상 구조의 정렬이 실제 행동을 결정하므로, 보상 구조가 메시지와 일치해야 한다.',
    },
    {
      number: 5,
      questionText: '다음 글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳은?',
      questionTextForward: '주어진 문장: The mind appears focused only because countless alternatives are being suppressed at the same time.',
      passageText: attentionPassage,
      questionTextBackward: 'The metaphor of a spotlight hides the active filtering work that makes selective attention possible.',
      choices: [
        { label: '①', text: '첫 문장 앞' },
        { label: '②', text: '첫 문장 뒤' },
        { label: '③', text: '둘째 문장 뒤' },
        { label: '④', text: '셋째 문장 뒤' },
        { label: '⑤', text: '마지막 문장 뒤' },
      ],
      answer: '④',
      explanation: '정답: ④\n해설: 주어진 문장은 앞선 설명을 종합해 결론화하므로 마지막 설명 직전에 들어가는 것이 자연스럽다.',
    },
    {
      number: 6,
      questionText: '다음 글을 읽고, 밑줄 친 부분에 대한 이해로 가장 적절한 것은?',
      questionTextForward: null,
      passageText: ethicsPassage,
      questionTextBackward: 'By the time the pattern is visible, responsibility has already been distributed across many hands.',
      choices: [
        { label: '①', text: 'A single decision usually determines the entire ethical outcome of a system.' },
        { label: '②', text: 'Distributed responsibility can conceal the cumulative force of small compromises.' },
        { label: '③', text: 'Ethical review is unnecessary when each individual action looks reasonable.' },
        { label: '④', text: 'Repeated accommodations become harmless if no one actor intends harm.' },
        { label: '⑤', text: 'Patterns in complex systems are obvious from the beginning of a project.' },
      ],
      answer: '②',
      explanation: '정답: ②\n해설: 작은 타협의 누적과 책임 분산이 전체 패턴을 가리므로, 개별 행동이 합리적으로 보여도 전체 흐름을 함께 봐야 한다.',
    },
  ],
}

export const regressionParityExpectations = {
  targetedPages: [1, 3, 6],
  sharedBuilders: ['buildQuestionSectionPlan', 'buildTwoColumnLayoutPlan'],
  page1: {
    pageIndex: 0,
    questionNumber: 1,
    anchorReason: 'left-column-lead-before-choice-spill',
    leadingSectionIds: ['question-1-header', 'question-1-passage-part-1'],
    shouldNotAppearInLeftColumn: ['question-1-choice-part-1'],
  },
  page3: {
    pageIndex: 2,
    questionNumber: 4,
    anchorReason: 'prompt-answer-same-page-group',
    promptSectionId: 'question-4-header',
    answerSectionId: 'question-4-answer',
  },
  page6: {
    pageIndex: 5,
    questionNumber: 6,
    anchorReason: 'preview-pdf-page-6-parity',
    promptSectionId: 'question-6-header',
    answerSectionId: 'question-6-answer',
  },
}
