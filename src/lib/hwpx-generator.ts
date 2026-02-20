import JSZip from 'jszip'
import { saveAs } from 'file-saver'

// ============================================
// Types (consistent with export-utils.ts)
// ============================================

interface Choice {
  label: string
  text: string
}

interface Question {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: Choice[]
  answer: string
  explanation: string
}

type ViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
type ColumnLayout = 'single' | 'double'

interface ExamPaper {
  title: string
  description?: string
  questions: Question[]
  viewMode?: ViewMode
  columnLayout?: ColumnLayout
}

// ============================================
// XML Escape Utility
// ============================================

/**
 * XML 특수문자 이스케이프
 */
function escapeXml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ============================================
// OWPML XML Generation Helpers
// ============================================

/**
 * OWPML 형식의 단일 문단(hp:p) 생성
 * @param text - 텍스트 내용
 * @param options - 추가 옵션 (bold, indent 등)
 */
function generateParagraphXML(
  text: string,
  options: { 
    bold?: boolean
    indent?: number
    paragraphStyle?: string 
  } = {}
): string {
  const escapedText = escapeXml(text)
  const { bold = false, indent = 0 } = options
  
  // 줄바꿈을 별도 run으로 분리
  const lines = escapedText.split('\n')
  
  const runsXml = lines.map((line, index) => {
    const charPrXml = bold ? '<hp:charPr bold="true" />' : ''
    const lineXml = `<hp:run>${charPrXml}<hp:t>${line}</hp:t></hp:run>`
    
    // 마지막 라인이 아니면 줄바꿈 추가
    if (index < lines.length - 1) {
      return lineXml + '<hp:run><hp:lineBreak /></hp:run>'
    }
    return lineXml
  }).join('')
  
  // 들여쓰기 속성
  const indentAttr = indent > 0 ? ` indent="${indent}"` : ''
  
  return `<hp:p${indentAttr}>${runsXml}</hp:p>`
}

/**
 * 박스 스타일 문단 생성 (지문, questionTextForward 등)
 */
function generateBoxParagraphXML(text: string): string {
  if (!text) return ''
  
  const lines = text.split('\n')
  return lines.map(line => generateParagraphXML(line)).join('')
}

/**
 * 빈 문단 생성 (줄 간격용)
 */
function generateEmptyParagraphXML(): string {
  return '<hp:p><hp:run><hp:t></hp:t></hp:run></hp:p>'
}

/**
 * 개별 문제를 OWPML 문단들로 변환
 */
function generateQuestionXML(
  question: Question,
  showQuestions: boolean,
  showAnswers: boolean
): string {
  const paragraphs: string[] = []
  
  if (showQuestions) {
    // 1. 문제 번호 + 발문
    paragraphs.push(
      generateParagraphXML(`${question.number}. ${question.questionText}`, { bold: true })
    )
    
    // 2. Question Text Forward (박스)
    if (question.questionTextForward) {
      paragraphs.push(generateEmptyParagraphXML())
      paragraphs.push(generateBoxParagraphXML(question.questionTextForward))
    }
    
    // 3. Passage Text (박스)
    if (question.passageText) {
      paragraphs.push(generateEmptyParagraphXML())
      paragraphs.push(generateBoxParagraphXML(question.passageText))
    }
    
    // 4. Question Text Backward (박스)
    if (question.questionTextBackward) {
      paragraphs.push(generateEmptyParagraphXML())
      paragraphs.push(generateBoxParagraphXML(question.questionTextBackward))
    }
    
    // 5. 선지 (있는 경우만)
    if (Array.isArray(question.choices) && question.choices.length > 0) {
      paragraphs.push(generateEmptyParagraphXML())
      question.choices.forEach(choice => {
        paragraphs.push(
          generateParagraphXML(`${choice.label} ${choice.text}`, { indent: 200 })
        )
      })
    }
  } else {
    // answer-only 모드: 번호만 표시
    paragraphs.push(
      generateParagraphXML(`${question.number}번`, { bold: true })
    )
  }
  
  // 6. 정답 및 해설
  if (showAnswers) {
    paragraphs.push(generateEmptyParagraphXML())
    paragraphs.push(
      generateParagraphXML(`정답: ${question.answer}`, { bold: true })
    )
    paragraphs.push(
      generateParagraphXML(`해설: ${question.explanation}`)
    )
  }
  
  // 문제 간 간격
  paragraphs.push(generateEmptyParagraphXML())
  paragraphs.push(generateEmptyParagraphXML())
  
  return paragraphs.join('\n')
}

/**
 * 전체 section0.xml 내용 생성
 */
function generateSectionXML(examPaper: ExamPaper): string {
  const viewMode: ViewMode = examPaper.viewMode || 'exam-with-answers'
  const columnLayout: ColumnLayout = examPaper.columnLayout || 'single'
  const showQuestions = viewMode !== 'answer-only'
  const showAnswers = viewMode !== 'exam-only'
  const isDoubleColumn = columnLayout === 'double'
  
  const titleSuffix = viewMode === 'answer-only' ? ' - 답안' : 
                      viewMode === 'exam-only' ? ' - 시험지' : ''
  const layoutSuffix = isDoubleColumn ? ' (2단)' : ''
  
  const allParagraphs: string[] = []
  
  // 제목
  allParagraphs.push(
    generateParagraphXML(examPaper.title + titleSuffix + layoutSuffix, { bold: true })
  )
  
  // 설명
  if (examPaper.description) {
    allParagraphs.push(generateParagraphXML(examPaper.description))
  }
  
  // 구분선
  allParagraphs.push(generateEmptyParagraphXML())
  allParagraphs.push(generateEmptyParagraphXML())
  
  // 각 문제 생성
  examPaper.questions.forEach(question => {
    allParagraphs.push(generateQuestionXML(question, showQuestions, showAnswers))
  })
  
  // OWPML section XML 래핑
  const sectionContent = allParagraphs.join('\n')
  
  // 섹션 속성 (secPr) - 다단 설정 포함
  // OWPML에서 다단은 secPr > colDef로 설정 (페이지당 단 수, 간격, 구분선)
  // 단위: hwp unit (1/7200 inch), 8500 hwpunit ≈ 30mm
  const secPrXml = isDoubleColumn ? `
  <hs:secPr textDirection="horizontal" spaceColumns="850" equalWidth="true" pageStartsOn="both" multiColumn="true" columnCount="2">
    <hs:colDef count="2" sameWidth="true" sameGap="true">
      <hs:col width="8500" gap="850" />
      <hs:col width="8500" gap="0" />
    </hs:colDef>
    <hs:colLine type="solid" width="1" color="#808080" />
  </hs:secPr>` : ''
  
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2016/HwpSection"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2016/HwpPara">${secPrXml}
  ${sectionContent}
</hs:sec>`
}

// ============================================
// Main Export Function
// ============================================

/**
 * HWPX 파일로 내보내기
 * 
 * 템플릿 파일을 읽어서 Contents/section0.xml을 교체하고
 * 새로운 HWPX 파일로 다운로드
 */
export async function exportToHwpx(examPaper: ExamPaper): Promise<void> {
  const columnLayout = examPaper.columnLayout || 'single'
  
  // 1. 레이아웃에 따라 적절한 템플릿 선택
  const templateFileName = columnLayout === 'double' 
    ? 'exam_template_double.hwpx' 
    : 'exam_template_single.hwpx'
  const templateUrl = `/templates/${templateFileName}`
  
  let templateResponse: Response
  try {
    templateResponse = await fetch(templateUrl)
    if (!templateResponse.ok) {
      throw new Error(`Template not found: ${templateResponse.status}`)
    }
  } catch {
    console.warn(`Template ${templateFileName} not found, generating minimal HWPX structure`)
    await generateMinimalHwpx(examPaper)
    return
  }
  
  const templateBlob = await templateResponse.blob()
  const templateArrayBuffer = await templateBlob.arrayBuffer()
  
  // 2. JSZip으로 템플릿 압축 해제
  const zip = await JSZip.loadAsync(templateArrayBuffer)
  
  // 3. 기존 section0.xml 읽기
  const sectionFile = zip.file('Contents/section0.xml')
  if (!sectionFile) {
    console.warn('section0.xml not found in template')
    await generateMinimalHwpx(examPaper)
    return
  }
  const existingSectionXml = await sectionFile.async('string')
  
  // 4. 템플릿의 첫 번째 <hp:p> 요소 보존 (secPr, colPr 등 섹션/다단 설정 포함)
  // 첫 번째 </hp:p> 끝 위치를 찾아 첫 문단 전체를 유지
  const firstParaEndIndex = findFirstParagraphEnd(existingSectionXml)
  const closingTagIndex = existingSectionXml.lastIndexOf('</hs:sec>')
  
  if (firstParaEndIndex === -1 || closingTagIndex === -1) {
    // 파싱 실패 시 fallback
    const newSectionXml = generateSectionXML(examPaper)
    zip.file('Contents/section0.xml', newSectionXml)
  } else {
    // 템플릿의 헤더 부분 (XML 선언 + <hs:sec ...> + 첫 번째 <hp:p>...</hp:p>)
    let templateHeader = existingSectionXml.substring(0, firstParaEndIndex)
    
    // 5. 머릿말에 시험지 제목 삽입
    templateHeader = injectTitleIntoHeader(templateHeader, examPaper.title)
    
    // 6. 콘텐츠 문단 생성 (문제들만)
    const contentParagraphs = generateContentParagraphs(examPaper)
    
    // 7. 조합: 템플릿 헤더(secPr+colPr+header 보존) + 콘텐츠 + 닫기 태그
    const newSectionXml = templateHeader + '\n' + contentParagraphs + '\n</hs:sec>'
    zip.file('Contents/section0.xml', newSectionXml)
  }
  
  // 7. 새 HWPX 파일 생성 및 다운로드
  const viewMode = examPaper.viewMode || 'exam-with-answers'
  const titleSuffix = viewMode === 'answer-only' ? '_답안' : 
                      viewMode === 'exam-only' ? '_시험지' : ''
  
  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `${examPaper.title}${titleSuffix}.hwpx`)
}

/**
 * 첫 번째 </hp:p> 종료 태그의 끝 위치를 찾음
 * secPr, colPr 등 섹션 설정은 첫 번째 hp:p에 포함됨
 */
function findFirstParagraphEnd(xml: string): number {
  // 첫 번째 </hp:p> 태그 직후 위치 반환
  // 단, 중첩 <hp:p>가 있을 수 있으므로 depth 트래킹
  let depth = 0
  let i = 0
  const openTag = '<hp:p'
  const closeTag = '</hp:p>'
  
  while (i < xml.length) {
    if (xml.substring(i, i + openTag.length) === openTag) {
      // <hp:p 또는 <hp:p>로 시작하는지 확인 (hp:pagePr 등 배제)
      const nextChar = xml[i + openTag.length]
      if (nextChar === ' ' || nextChar === '>' || nextChar === '/') {
        depth++
      }
    }
    if (xml.substring(i, i + closeTag.length) === closeTag) {
      depth--
      if (depth === 0) {
        return i + closeTag.length
      }
    }
    i++
  }
  return -1
}

/**
 * 템플릿 헤더 XML에서 머릿말(hp:header) 내부의 텍스트를 시험지 제목으로 교체
 *
 * 우선순위:
 * 1) drawText 내부 self-closing run(<hp:run .../>)을 텍스트 run으로 교체
 * 2) drawText 내부 <hp:t/> 또는 <hp:t></hp:t> 교체
 * 3) header 내부 <hp:t/> 또는 <hp:t></hp:t> 교체
 */
function injectTitleIntoHeader(templateHeader: string, title: string): string {
  const headerStart = templateHeader.indexOf('<hp:header')
  if (headerStart === -1) {
    // 머릿말이 없으면 그대로 반환
    return templateHeader
  }
  
  const headerEnd = templateHeader.indexOf('</hp:header>', headerStart)
  if (headerEnd === -1) return templateHeader
  
  const headerSection = templateHeader.substring(headerStart, headerEnd + '</hp:header>'.length)
  const escapedTitle = escapeXml(title)
  
  let modifiedHeader = headerSection

  // drawText 영역 우선 처리 (현재 템플릿은 drawText 내부 run이 self-closing 형태)
  const drawTextIdx = modifiedHeader.indexOf('<hp:drawText')
  if (drawTextIdx !== -1) {
    const afterDrawText = modifiedHeader.substring(drawTextIdx)

    // 패턴 1: <hp:run .../> -> <hp:run ...><hp:t>title</hp:t></hp:run>
    const runSelfCloseMatch = afterDrawText.match(/<hp:run([^>]*)\/>/)
    if (runSelfCloseMatch && typeof runSelfCloseMatch.index === 'number') {
      const runStart = drawTextIdx + runSelfCloseMatch.index
      const runOriginal = runSelfCloseMatch[0]
      const runAttrs = runSelfCloseMatch[1] || ''
      const runReplacement = `<hp:run${runAttrs}><hp:t>${escapedTitle}</hp:t></hp:run>`
      modifiedHeader = modifiedHeader.substring(0, runStart) +
        runReplacement +
        modifiedHeader.substring(runStart + runOriginal.length)
      return templateHeader.substring(0, headerStart) + modifiedHeader + templateHeader.substring(headerEnd + '</hp:header>'.length)
    }

    // 패턴 2: drawText 내부의 빈 텍스트 태그 교체
    const tSelfClose = afterDrawText.indexOf('<hp:t/>')
    const tEmpty = afterDrawText.indexOf('<hp:t></hp:t>')
    if (tSelfClose !== -1 && (tEmpty === -1 || tSelfClose < tEmpty)) {
      modifiedHeader = modifiedHeader.substring(0, drawTextIdx + tSelfClose) +
        `<hp:t>${escapedTitle}</hp:t>` +
        modifiedHeader.substring(drawTextIdx + tSelfClose + '<hp:t/>'.length)
      return templateHeader.substring(0, headerStart) + modifiedHeader + templateHeader.substring(headerEnd + '</hp:header>'.length)
    }
    if (tEmpty !== -1) {
      modifiedHeader = modifiedHeader.substring(0, drawTextIdx + tEmpty) +
        `<hp:t>${escapedTitle}</hp:t>` +
        modifiedHeader.substring(drawTextIdx + tEmpty + '<hp:t></hp:t>'.length)
      return templateHeader.substring(0, headerStart) + modifiedHeader + templateHeader.substring(headerEnd + '</hp:header>'.length)
    }
  }

  // drawText가 없거나 패턴 매칭 실패 시 header 내부의 빈 텍스트 태그를 직접 교체
  const tSelfClose = modifiedHeader.indexOf('<hp:t/>')
  const tEmpty = modifiedHeader.indexOf('<hp:t></hp:t>')
  if (tSelfClose !== -1 && (tEmpty === -1 || tSelfClose < tEmpty)) {
    modifiedHeader = modifiedHeader.substring(0, tSelfClose) +
      `<hp:t>${escapedTitle}</hp:t>` +
      modifiedHeader.substring(tSelfClose + '<hp:t/>'.length)
  } else if (tEmpty !== -1) {
    modifiedHeader = modifiedHeader.substring(0, tEmpty) +
      `<hp:t>${escapedTitle}</hp:t>` +
      modifiedHeader.substring(tEmpty + '<hp:t></hp:t>'.length)
  }
  
  // 원본에서 header 부분만 교체
  return templateHeader.substring(0, headerStart) + modifiedHeader + templateHeader.substring(headerEnd + '</hp:header>'.length)
}

/**
 * 콘텐츠 문단 생성 (templateHeader 뒤에 추가될 부분)
 */
function generateContentParagraphs(examPaper: ExamPaper): string {
  const viewMode: ViewMode = examPaper.viewMode || 'exam-with-answers'
  const showQuestions = viewMode !== 'answer-only'
  const showAnswers = viewMode !== 'exam-only'
  
  const allParagraphs: string[] = []
  
  // 문제들만 출력 (제목/설명은 머릿말에 배치되므로 본문에서 제외)
  examPaper.questions.forEach(question => {
    allParagraphs.push(generateQuestionXML(question, showQuestions, showAnswers))
  })
  
  return allParagraphs.join('\n')
}

/**
 * 템플릿 없이 최소한의 HWPX 구조 생성
 * (fallback용)
 */
async function generateMinimalHwpx(examPaper: ExamPaper): Promise<void> {
  const zip = new JSZip()
  
  // [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/Contents/section0.xml" ContentType="application/xml"/>
</Types>`)
  
  // version.xml
  zip.file('version.xml', `<?xml version="1.0" encoding="UTF-8"?>
<hwpVersion version="1.0"/>`)
  
  // Contents/section0.xml
  const sectionXml = generateSectionXML(examPaper)
  zip.file('Contents/section0.xml', sectionXml)
  
  // Contents/content.hpf (minimal)
  zip.file('Contents/content.hpf', `<?xml version="1.0" encoding="UTF-8"?>
<hpf:package xmlns:hpf="http://www.hancom.co.kr/hwpml/2016/HwpPackage">
  <hpf:contentFiles>
    <hpf:item>section0.xml</hpf:item>
  </hpf:contentFiles>
</hpf:package>`)
  
  // Generate and download
  const viewMode = examPaper.viewMode || 'exam-with-answers'
  const titleSuffix = viewMode === 'answer-only' ? '_답안' : 
                      viewMode === 'exam-only' ? '_시험지' : ''
  
  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `${examPaper.title}${titleSuffix}.hwpx`)
}
