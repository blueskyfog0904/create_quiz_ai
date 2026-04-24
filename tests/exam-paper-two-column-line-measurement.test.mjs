import assert from 'node:assert/strict'
import test from 'node:test'

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
