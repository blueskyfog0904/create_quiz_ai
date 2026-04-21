import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PREVIEW_TWO_COLUMN_BASELINE,
  TWO_COLUMN_BODY_BASE_UNIT,
  TWO_COLUMN_CHOICE_BASE_UNIT,
  calibrateTwoColumnUnits,
} from '../src/lib/exam-paper-two-column-calibration.ts'

function createPdfLineUnits(overrides = {}) {
  return {
    bodyLineUnit: 4.8,
    choiceLineUnit: 5,
    ...overrides,
  }
}

test('calibration keeps first-page capacity owned by the preview baseline', () => {
  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf: createPdfLineUnits(),
  })

  assert.equal(
    calibration.profile.firstPageCapacity,
    PREVIEW_TWO_COLUMN_BASELINE.firstPageCapacity
  )
})

test('calibration keeps other-page capacity owned by the preview baseline', () => {
  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf: createPdfLineUnits(),
  })

  assert.equal(
    calibration.profile.otherPageCapacity,
    PREVIEW_TWO_COLUMN_BASELINE.otherPageCapacity
  )
})

test('calibration keeps answer unit owned by the preview baseline', () => {
  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf: createPdfLineUnits(),
  })

  assert.equal(
    calibration.profile.answerBaseUnit,
    PREVIEW_TWO_COLUMN_BASELINE.answerBaseUnit
  )
})

test('calibration derives the body base unit from the named body unit constant', () => {
  const pdf = createPdfLineUnits()
  const expectedBodyRatio = PREVIEW_TWO_COLUMN_BASELINE.bodyLineUnit / pdf.bodyLineUnit
  const expectedBodyBaseUnit = Math.round(TWO_COLUMN_BODY_BASE_UNIT * expectedBodyRatio)

  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf,
  })

  assert.equal(calibration.profile.bodyBaseUnit, expectedBodyBaseUnit)
})

test('calibration derives the choice base unit from the named choice unit constant', () => {
  const pdf = createPdfLineUnits()
  const expectedChoiceRatio = PREVIEW_TWO_COLUMN_BASELINE.choiceLineUnit / pdf.choiceLineUnit
  const expectedChoiceBaseUnit = Math.round(TWO_COLUMN_CHOICE_BASE_UNIT * expectedChoiceRatio)

  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf,
  })

  assert.equal(calibration.profile.choiceBaseUnit, expectedChoiceBaseUnit)
})

test('calibration exposes the body-line scale ratio used for capacity alignment', () => {
  const pdf = createPdfLineUnits()
  const expectedScaleRatio = PREVIEW_TWO_COLUMN_BASELINE.bodyLineUnit / pdf.bodyLineUnit

  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf,
  })

  assert.equal(calibration.scaleRatio, expectedScaleRatio)
  assert.ok(calibration.scaleRatio > 1)
})

test('calibration rejects non-positive preview or pdf line units', () => {
  const invalidCases = [
    {
      name: 'preview body line unit',
      preview: { ...PREVIEW_TWO_COLUMN_BASELINE, bodyLineUnit: 0 },
      pdf: createPdfLineUnits(),
      message: 'preview body line unit must be greater than 0 for two-column calibration',
    },
    {
      name: 'preview choice line unit',
      preview: { ...PREVIEW_TWO_COLUMN_BASELINE, choiceLineUnit: -1 },
      pdf: createPdfLineUnits(),
      message: 'preview choice line unit must be greater than 0 for two-column calibration',
    },
    {
      name: 'pdf body line unit',
      preview: PREVIEW_TWO_COLUMN_BASELINE,
      pdf: createPdfLineUnits({ bodyLineUnit: 0 }),
      message: 'pdf body line unit must be greater than 0 for two-column calibration',
    },
    {
      name: 'pdf choice line unit',
      preview: PREVIEW_TWO_COLUMN_BASELINE,
      pdf: createPdfLineUnits({ choiceLineUnit: -5 }),
      message: 'pdf choice line unit must be greater than 0 for two-column calibration',
    },
  ]

  invalidCases.forEach(({ name, preview, pdf, message }) => {
    assert.throws(
      () => calibrateTwoColumnUnits({ preview, pdf }),
      new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `expected invalid input rejection for ${name}`
    )
  })
})
