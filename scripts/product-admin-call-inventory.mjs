// 18번 1단계(상품 화면 나누기) 호출 목록: fetch(·uploadToSignedUrl(·router.refresh/push/replace( 를
// 둘러싼 함수 이름과 그 함수 안 순서, 인자 글(공백 정리)·주소 변수의 대입 글과 함께 뽑는다.
// 나누기 전(파일 하나)과 뒤(나눈 파일들)의 결과가 같아야 한다(tests/fixtures/product-admin-call-inventory.json).

// 18번 2단계: 진행률을 받는 서명 업로드(uploadFileToSignedUrl, XMLHttpRequest)도 센다.
const CALL_PATTERN = /\b(fetch|uploadToSignedUrl|uploadFileToSignedUrl|router\.refresh|router\.push|router\.replace)\(/g

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// 여는 괄호 바로 뒤부터 짝이 맞는 닫는 괄호까지의 글(문자열·템플릿 안 괄호는 무시)
function readArguments(source, openIndex) {
  let depth = 0
  let quote = null
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return source.slice(openIndex + 1, index)
      }
    }
  }
  return source.slice(openIndex + 1)
}

// 호출 위치 앞에서 가장 가까운 2칸 들여쓰기 함수(컴포넌트·훅 안 const 함수)나 모듈 수준 function
function enclosingFunction(source, position) {
  const before = source.slice(0, position)
  const pattern = /\n(?: {2}const (\w+) = |(?:export )?(?:async )?function (\w+)\()/g
  let name = null
  for (const match of before.matchAll(pattern)) {
    name = match[1] ?? match[2]
  }
  return name
}

// 함수 안에서 `const NAME = …` 대입 글(다음 줄 들여쓰기가 더 깊으면 이어진 글로 본다)
function resolveVariable(source, functionStart, position, name) {
  const scope = source.slice(functionStart, position)
  const lines = scope.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const match = line.match(new RegExp(`^(\\s*)const ${name} = (.*)$`))
    if (!match) continue
    const indent = match[1].length
    const parts = [match[2]]
    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLine = lines[next]
      const nextIndent = nextLine.match(/^\s*/)[0].length
      if (!nextLine.trim() || nextIndent <= indent) break
      parts.push(nextLine)
    }
    return normalize(parts.join(' '))
  }
  return null
}

export function buildCallInventory(files) {
  const calls = []
  for (const { text } of files) {
    for (const match of text.matchAll(CALL_PATTERN)) {
      const kind = match[1]
      const openIndex = match.index + match[0].length - 1
      const args = readArguments(text, openIndex)
      const fn = enclosingFunction(text, match.index)
      const fnStart = fn ? text.lastIndexOf(`const ${fn} = `, match.index) : 0
      const firstArg = normalize(args).split(',')[0]
      const variables = {}
      for (const token of firstArg.match(/\b[a-zA-Z_]\w*\b/g) ?? []) {
        const resolved = resolveVariable(text, Math.max(fnStart, 0), match.index, token)
        if (resolved) variables[token] = resolved
      }
      calls.push({ fn, kind, args: normalize(args), variables })
    }
  }

  // 함수마다 호출 순서를 붙이고, 비교가 파일 순서에 흔들리지 않게 함수 이름·순서로 정렬한다.
  const counters = new Map()
  const withOrder = calls.map((call) => {
    const key = call.fn ?? '(module)'
    const order = counters.get(key) ?? 0
    counters.set(key, order + 1)
    return { ...call, order }
  })
  withOrder.sort((left, right) => (left.fn ?? '').localeCompare(right.fn ?? '') || left.order - right.order)

  const counts = {}
  for (const call of withOrder) counts[call.kind] = (counts[call.kind] ?? 0) + 1
  return { counts, calls: withOrder }
}
