export const DEFAULT_RESPONSE_STRUCTURE_PROMPT = `다음 JSON 구조로만 응답하세요.

{
  "question_text": "문제 본문 텍스트",
  "question_text_forward": null,
  "question_text_backward": null,
  "passage_text": null,
  "choices": [
    { "label": "①", "text": "첫 번째 선택지" },
    { "label": "②", "text": "두 번째 선택지" },
    { "label": "③", "text": "세 번째 선택지" },
    { "label": "④", "text": "네 번째 선택지" },
    { "label": "⑤", "text": "다섯 번째 선택지" }
  ],
  "answer": "정답",
  "explanation": "해설"
}

필수 필드: question_text, choices, answer, explanation.
선택지가 문제 본문에 이미 포함되어 별도 선택지 텍스트가 없으면 choices는 빈 배열로 반환하세요.`

export const DEFAULT_REVIEW_PROMPT = `너는 영어 교육 평가 문항 검토자입니다.
생성된 문제가 문제 생성 프롬프트와 응답 구조 프롬프트를 충실히 따랐는지 검토하세요.

검토 기준:
1. 문제와 정답이 지문에 근거하는가
2. 선택지와 정답 형식이 응답 구조 프롬프트를 따르는가
3. 해설이 정답을 설명하기에 충분한가
4. 학년/난이도 조건에 맞는가
5. JSON 필수 필드가 누락되지 않았는가

반드시 다음 JSON 형식으로만 응답하세요.
{
  "passed": true,
  "feedback": "통과 또는 미통과 사유",
  "issues": [
    {
      "severity": "info",
      "message": "검토 의견",
      "field": "선택 필드명",
      "suggestion": "선택 수정 제안"
    }
  ],
  "score": 100
}`
