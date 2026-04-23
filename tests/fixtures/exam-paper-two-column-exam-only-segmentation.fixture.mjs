const longPassage = [
  'From an organizational viewpoint, one of the most fascinating examples of how any organization may contain many different types of culture is to recognize the functional operations of different departments within the organization.',
  'The varying departments and divisions within an organization will inevitably view any given situation from their own biased and prejudiced perspective.',
  'A department and its members will acquire tunnel vision which disallows them to see things as others see them.',
  'The very structure of organizations can create conflict.',
  'The choice of whether the structure is mechanistic or organic can have a profound influence on conflict management.',
  'A mechanistic structure has a vertical hierarchy with many rules, many procedures, and many levels of management involved in decision making.',
  'Organic structures are more horizontal in nature, where decision making is less centralized and spread across the plane of the organization.',
].join(' ')

export const examOnlyDoubleSegmentationFixture = {
  title: 'exam-only segmentation fixture',
  description: '2단 시험지 본문 분할 이상 최소 재현 fixture',
  viewMode: 'exam-only',
  columnLayout: 'double',
  questions: [
    {
      number: 1,
      questionText: '다음 밑줄 친 부분이 의미하는 바로 가장 적절한 것은?',
      questionTextForward: '다음 글을 읽고 밑줄 친 부분의 의미를 고르시오.',
      questionTextBackward: '조직 구조와 부서별 시각 차이가 어떻게 충돌을 만들 수 있는지 파악하시오.',
      passageText: `${longPassage} ${longPassage}`,
      choices: [
        { label: '①', text: '조직은 언제나 하나의 관점만 가진다.' },
        { label: '②', text: '부서별 관점 차이는 갈등과 해석 차이를 만든다.' },
        { label: '③', text: '규칙은 조직 갈등과 무관하다.' },
        { label: '④', text: '의사결정은 늘 동일한 속도로 진행된다.' },
        { label: '⑤', text: '수직 구조와 수평 구조는 완전히 동일하다.' },
        { label: '⑥', text: '조직 문화는 기능 부서와 무관하게 형성된다.' },
      ],
      answer: '',
      explanation: '',
    },
  ],
}
