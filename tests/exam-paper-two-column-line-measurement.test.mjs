import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  loadRuntimeExportUtils,
  loadRuntimeLayoutContract,
  runMeasuredTwoColumnPreview,
  runProductionMeasuredPathInBrowser,
  withBrowserPage,
} from './helpers/exam-paper-two-column-runtime-harness.mjs'

function createLongPassageExamPaper() {
  return {
    title: 'Line measurement regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [{
      number: 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: null,
      passageText: [
        'From an organizational viewpoint, one of the most fascinating examples of how any organization may contain many different types of culture is to recognize the functional operations of different departments within the organization.',
        'The varying departments and divisions within an organization will inevitably view any given situation from their own biased and prejudiced perspective.',
        'A department and its members will [acquire “tunnel vision”] which disallows them to see things as others see them.',
        'The very structure of organizations can create conflict.',
        'The choice of whether the structure is “mechanistic” or “organic” can have a profound influence on conflict management.',
        'A mechanistic structure has a vertical hierarchy with many rules, many procedures, and many levels of management involved in decision making.',
        'Organic structures are more horizontal in nature, where decision making is less centralized and spread across the plane of the organization.',
      ].join(' '),
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
      ],
      answer: '①',
      explanation: 'explanation',
    }],
  }
}

function createExplicitLineBreakExamPaper() {
  return {
    title: 'Explicit line break regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [{
      number: 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: null,
      passageText: 'First [line]\nSecond line keeps break.',
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
      ],
      answer: '①',
      explanation: 'explanation',
    }],
  }
}

test('buildTwoColumnLayoutPlan keeps body fragment splitting enabled for default layout planning', async () => {
  const layoutContract = await loadRuntimeLayoutContract()
  const examPaper = createLongPassageExamPaper()
  const renderOptions = layoutContract.buildExamPaperRenderOptions({
    viewMode: 'exam-only',
    columnLayout: 'double',
  })
  const questionPlans = examPaper.questions.map((question) => (
    layoutContract.buildQuestionSectionPlan(question, renderOptions)
  ))
  const layoutPlan = layoutContract.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: false,
  })
  const sectionIds = layoutPlan.pages.flatMap((page) => (
    page.columns.flatMap((column) => column.sectionIds)
  ))

  assert.ok(
    sectionIds.some((sectionId) => sectionId.includes('question-1-body-part-2')),
    `expected layout plan to keep split body fragments, received ${JSON.stringify(sectionIds)}`
  )
})

test('two-column measurement HTML keeps body as one raw measurable section before line splitting', async () => {
  const exportUtils = await loadRuntimeExportUtils()
  const html = exportUtils.buildExamPaperTwoColumnMeasurementHtml(createLongPassageExamPaper())

  assert.match(
    html,
    /data-section-id="question-1-body"/,
    'expected measurement HTML to expose the full body section as a single measurable body node'
  )
  assert.doesNotMatch(
    html,
    /data-section-id="question-1-body-part-2"/,
    'expected measurement HTML not to pre-fragment body into sentence-sized block chunks'
  )
  assert.match(
    html,
    /data-body-raw-text="[^"]*organizational viewpoint/,
    'expected measurement body node to carry raw body text for DOM line splitting'
  )
})

test('measurement body renders as multiple visual lines in Chromium before pagination splitting', async () => {
  const exportUtils = await loadRuntimeExportUtils()
  const html = exportUtils.buildExamPaperTwoColumnMeasurementHtml(createLongPassageExamPaper())

  const measurement = await withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(250)

    return page.evaluate(() => {
      const flow = document.querySelector('.question-body-chunk .flow-body-text')
      if (!flow) {
        throw new Error('expected measurement body flow text element')
      }

      const style = getComputedStyle(flow)
      const lineHeight = Number.parseFloat(style.lineHeight || '0') || 0
      const range = document.createRange()
      range.selectNodeContents(flow)
      const visualLines = Array.from(range.getClientRects()).filter((rect) => rect.height > 0)

      return {
        lineHeight,
        visualLineCount: visualLines.length,
        flowHeight: flow.getBoundingClientRect().height,
      }
    })
  })

  assert.ok(measurement.lineHeight > 0, `expected positive line height, received ${JSON.stringify(measurement)}`)
  assert.ok(
    measurement.visualLineCount > 3,
    `expected long body to wrap to multiple visual lines, received ${JSON.stringify(measurement)}`
  )
})

test('buildMeasuredTwoColumnPreviewPages splits measured body into line chunks in Chromium runtime', async () => {
  const result = await runMeasuredTwoColumnPreview(createLongPassageExamPaper())

  assert.ok(result.pageCount >= 1, `expected measured preview pages, received ${JSON.stringify(result)}`)
  assert.ok(
    result.bodyLineChunkCount > 3,
    `expected measured runtime body to split into multiple line chunks, received ${JSON.stringify(result)}`
  )
  assert.equal(result.firstBodyLineChunk?.kind, 'body')
  assert.equal(result.firstBodyLineChunk?.sourceSectionId, 'question-1-body')
  assert.equal(result.firstBodyLineChunk?.bodyLineIndex, 0)
})

test('production measured preview groups adjacent body line chunks into one visual flow block per column segment', async () => {
  const result = await runProductionMeasuredPathInBrowser(createLongPassageExamPaper())

  assert.ok(result.pageCount >= 1, `expected measured preview pages, received ${JSON.stringify(result)}`)
  assert.ok(
    result.bodyLineChunkCount > 3,
    `expected measured preview to derive multiple DOM body line chunks, received ${JSON.stringify(result)}`
  )
  assert.match(
    result.html,
    /class="question-chunk question-body-chunk two-column-measured-body-flow"/,
    'expected final measured preview to render grouped body flow blocks'
  )
  assert.match(
    result.html,
    /two-column-measured-body-flow[\s\S]*?<div class="flow-body-text">[\s\S]*?From an organizational viewpoint[\s\S]*?The varying departments and divisions within an organization[\s\S]*?<\/div>/,
    'expected adjacent body lines to be joined into the same measured flow block'
  )
  assert.doesNotMatch(
    result.html,
    /question-1-body-part-2/,
    'expected final measured preview to avoid the old paragraph fragment ids'
  )
})

test('production measured preview preserves authored line breaks and underline spans when regrouping measured body lines', async () => {
  const result = await runProductionMeasuredPathInBrowser(createExplicitLineBreakExamPaper())

  assert.match(
    result.html,
    /class="question-chunk question-body-chunk two-column-measured-body-flow"/,
    'expected final measured preview to render grouped measured body flow blocks'
  )
  assert.match(
    result.html,
    /First <span[^>]*>line<\/span><br>\s*Second line keeps break\./,
    'expected regrouped measured body html to preserve the authored newline between body chunks'
  )
})


function createWeakBodyWordIsolationExamPaper() {
  const intro = 'From an organizational viewpoint, the committee described the transition as a careful negotiation between local habit and shared responsibility, because each department interpreted the same directive through its own daily pressures and professional vocabulary.'
  const base = 'The planning team reviewed the sequence of meetings, reports, and approvals so that every participant could see how small decisions in one office would alter the workload, timing, and confidence of another office across the institution.'
  const reflection = 'Observers noted that the organization often moved from reflection to action in the next review, even when the broader educational purpose remained unsettled.'
  const passageText = [intro, base, base, reflection].join(' ')

  return {
    title: 'Weak body word isolation regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: Array.from({ length: 3 }, (_, index) => ({
      number: index + 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: null,
      passageText: `${passageText} ${passageText} ${passageText}`,
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
        { label: '③', text: 'third option' },
        { label: '④', text: 'fourth option' },
        { label: '⑤', text: 'fifth option' },
      ],
      answer: '①',
      explanation: 'explanation',
    })),
  }
}

async function readMeasuredBodyFlowEndings(html) {
  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })

    return page.evaluate(() => (
      Array.from(document.querySelectorAll('.two-column-measured-body-flow[data-question-number] .flow-body-text'))
        .map((flowBodyText, blockIndex) => {
          const bodyFlowBlock = flowBodyText.closest('.two-column-measured-body-flow[data-question-number]')
          const questionNumber = Number.parseInt(bodyFlowBlock?.getAttribute('data-question-number') ?? '', 10)
          const flowText = flowBodyText.textContent?.replace(/\s+/g, ' ').trim() ?? ''
          const words = flowText.match(/[A-Za-z']+/g) ?? []

          return {
            blockIndex,
            questionNumber,
            lastWord: (words.at(-1) ?? '').toLowerCase(),
            endingText: words.slice(-12).join(' '),
          }
        })
    ))
  })
}

function createSplitSupplementalDividerExamPaper() {
  const forwardSentence = 'Read this supplemental instruction carefully because it is intentionally long enough to span multiple columns while staying within the same forward section.'
  const passageSentence = 'The main passage follows after the instruction and should not affect the divider continuity of the supplemental instruction.'

  return {
    title: 'Supplemental divider regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [{
      number: 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: Array.from({ length: 80 }, () => forwardSentence).join(' '),
      passageText: Array.from({ length: 4 }, () => passageSentence).join(' '),
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
      ],
      answer: '①',
      explanation: 'explanation',
    }],
  }
}

test('measured supplemental body dividers continue across column breaks without duplicated full separators', async () => {
  const result = await runProductionMeasuredPathInBrowser(createSplitSupplementalDividerExamPaper())
  const forwardSegments = result.html.match(/flow-body-segment-forward[^"]*/g) ?? []

  assert.ok(
    forwardSegments.length >= 2,
    `expected long forward text to span multiple measured flow blocks, received ${JSON.stringify(forwardSegments)}`
  )
  assert.ok(
    forwardSegments.some((className) => className.includes('flow-body-supplemental-continued-start')),
    `expected the first split supplemental fragment to drop its bottom divider, received ${JSON.stringify(forwardSegments)}`
  )
  assert.ok(
    forwardSegments.some((className) => className.includes('flow-body-supplemental-continued-end')),
    `expected the last split supplemental fragment to drop its top divider, received ${JSON.stringify(forwardSegments)}`
  )
  assert.doesNotMatch(
    result.html,
    /flow-body-segment-forward flow-body-supplemental"[\s\S]*?flow-body-segment-forward flow-body-supplemental"/,
    'expected split forward fragments not to render multiple standalone full top-and-bottom divider blocks'
  )
})

test('measured supplemental body lines reserve height for rendered divider padding and borders', () => {
  const measurementSource = readFileSync(
    new URL('../src/lib/exam-paper-two-column-measurement.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    measurementSource,
    /calculateSupplementalInsetForLine/,
    'expected measured two-column line chunks to add supplemental divider padding and border height when paginating'
  )
  assert.match(
    measurementSource,
    /measuredHeightPx:\s*lineHeightPx \+ supplementalInsetPx/,
    'expected measured body line height to include supplemental inset before pagination guards are applied'
  )
})

test('measured two-column pagination does not leave a weak body word alone at a column break', async () => {
  const result = await runProductionMeasuredPathInBrowser(createWeakBodyWordIsolationExamPaper())
  const bodyFlowEndings = await readMeasuredBodyFlowEndings(result.html)
  const question3FlowEndings = bodyFlowEndings.filter(({ questionNumber }) => questionNumber === 3)
  const question3TheEndingBlocks = question3FlowEndings
    .filter(({ lastWord }) => lastWord === 'the')
    .map(({ questionNumber, lastWord, endingText }) => ({
      questionNumber,
      lastWord,
      endingText,
    }))

  assert.ok(result.pageCount >= 2, `expected multi-page measured preview, received ${JSON.stringify(result)}`)
  assert.ok(
    result.bodyLineChunkCount > 20,
    `expected long measured body text to create many line chunks, received ${JSON.stringify(result)}`
  )
  assert.ok(
    question3FlowEndings.length >= 2,
    `expected question 3 to span multiple measured body flow blocks, received ${JSON.stringify(question3FlowEndings)}`
  )
  assert.deepEqual(
    question3TheEndingBlocks,
    [],
    `expected q3 measured body flow blocks to avoid ending on \"the\", received ${JSON.stringify(question3FlowEndings)}`
  )
})
