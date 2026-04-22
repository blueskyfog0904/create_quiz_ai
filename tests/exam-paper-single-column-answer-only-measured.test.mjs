import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const singleColumnLayoutSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const singleColumnMeasurementSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-measurement.ts', import.meta.url),
  'utf8'
)
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimeModules() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-answer-measured-'))
  const layoutPath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const measurementPath = join(tempDir, 'exam-paper-single-column-measurement.runtime.ts')

  writeFileSync(
    layoutPath,
    singleColumnLayoutSource
      .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
      .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  )

  writeFileSync(
    measurementPath,
    singleColumnMeasurementSource
      .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
      .replace(/@\/lib\/exam-paper-single-column-layout/g, './exam-paper-single-column-layout.runtime.ts')
  )

  const [layoutModule, measurementModule] = await Promise.all([
    import(`${pathToFileURL(layoutPath).href}?t=${Date.now()}`),
    import(`${pathToFileURL(measurementPath).href}?t=${Date.now()}`),
  ])

  return {
    buildSingleColumnQuestionGroups: layoutModule.buildSingleColumnQuestionGroups,
    measureSingleColumnPreviewPages: measurementModule.measureSingleColumnPreviewPages,
  }
}

function createLongAnswerOnlyQuestion() {
  return {
    number: 1,
    questionText: '무시되는 answer-only question text',
    answer: '①',
    explanation: Array.from({ length: 12 }, (_, index) => (
      `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
    )).join(' '),
  }
}

function parseSpacing(value) {
  if (!value) {
    return 0
  }

  if (value.endsWith('mm')) {
    return Number.parseFloat(value) * 3
  }

  return Number.parseFloat(value) || 0
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName
    this.children = []
    this.parentNode = null
    this.style = {}
    this.attributes = new Map()
    this.className = ''
    this._textContent = ''
    this._innerHTML = ''
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    return child
  }

  append(content) {
    if (content instanceof FakeElement) {
      this.appendChild(content)
      return
    }

    this._textContent += String(content)
  }

  remove() {
    if (!this.parentNode) {
      return
    }

    const index = this.parentNode.children.indexOf(this)
    if (index >= 0) {
      this.parentNode.children.splice(index, 1)
    }
    this.parentNode = null
  }

  get lastElementChild() {
    return this.children[this.children.length - 1] ?? null
  }

  set textContent(value) {
    this._textContent = String(value ?? '')
    this.children = []
  }

  get textContent() {
    const childText = this.children.map((child) => child.textContent).join('')
    return `${this._textContent}${childText}`
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '')
    this.children = []
  }

  get innerHTML() {
    return this._innerHTML
  }

  get clientHeight() {
    if (this.className === 'preview-page') {
      return 260
    }

    return this.measureHeight()
  }

  get scrollHeight() {
    return this.measureHeight()
  }

  measureHeight() {
    if (this.className === 'preview-page') {
      return this.children.reduce((sum, child) => sum + child.measureHeight(), 0)
    }

    const marginTop = parseSpacing(this.style.marginTop)
    const marginBottom = parseSpacing(this.style.marginBottom)
    const paddingTop = parseSpacing(this.style.paddingTop)
    const paddingBottom = parseSpacing(this.style.paddingBottom)

    if (this.tagName === 'h1') {
      return 50
    }

    if (this.className === 'questions-container') {
      return this.children.reduce((sum, child) => sum + child.measureHeight(), 0)
    }

    if (this.className.includes('question-number') || this.className.includes('answer-text-question')) {
      return 28 + marginBottom
    }

    if (this.className.includes('answer-text-block')) {
      return 12 + paddingTop + paddingBottom + this.children.reduce((sum, child) => sum + child.measureHeight(), 0)
    }

    if (this.className.includes('answer-text-answer')) {
      return 24 + marginBottom
    }

    if (this.className.includes('answer-text-explanation')) {
      return 120
    }

    if (this.className.includes('single-column-answer')) {
      return this.children.reduce((sum, child) => sum + child.measureHeight(), 0) + marginBottom
    }

    if (this.className.includes('single-column-header')) {
      return this.children.reduce((sum, child) => sum + child.measureHeight(), 0) + marginTop
    }

    return this.children.reduce((sum, child) => sum + child.measureHeight(), 0) + marginTop + marginBottom
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body')
  }

  createElement(tagName) {
    return new FakeElement(tagName)
  }
}

test('measured answer-only pagination lets long answer fragments continue across pages', async () => {
  const {
    buildSingleColumnQuestionGroups,
    measureSingleColumnPreviewPages,
  } = await loadRuntimeModules()

  const questionGroups = [
    buildSingleColumnQuestionGroups(createLongAnswerOnlyQuestion(), {
      showQuestions: false,
      showAnswers: true,
    }),
  ]

  const fakeDocument = new FakeDocument()
  const originalDocument = globalThis.document

  Object.assign(globalThis, { document: fakeDocument })

  try {
    const pages = measureSingleColumnPreviewPages({
      pageTitle: '테스트 - 답안',
      description: undefined,
      questionGroups,
      showQuestions: false,
      groupAnswerOnlyQuestion: true,
    })

    assert.ok(pages.length >= 2)
    assert.deepEqual(pages[0].blockIds, ['question-1-answer-part-1'])
    assert.deepEqual(pages[1].blockIds, ['question-1-answer-part-2'])
  } finally {
    if (typeof originalDocument === 'undefined') {
      delete globalThis.document
    } else {
      Object.assign(globalThis, { document: originalDocument })
    }
  }
})
