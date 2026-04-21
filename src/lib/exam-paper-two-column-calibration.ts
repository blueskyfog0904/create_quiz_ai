export interface TwoColumnPreviewBaseline {
  firstPageCapacity: number
  otherPageCapacity: number
  bodyLineUnit: number
  choiceLineUnit: number
  answerBaseUnit: number
}

export interface TwoColumnPdfLineUnitInput {
  bodyLineUnit: number
  choiceLineUnit: number
}

export interface TwoColumnCalibrationProfile {
  firstPageCapacity: number
  otherPageCapacity: number
  bodyBaseUnit: number
  choiceBaseUnit: number
  answerBaseUnit: number
}

export interface TwoColumnCalibrationResult {
  scaleRatio: number
  profile: TwoColumnCalibrationProfile
}

// Legacy direct-PDF body chunk unit before preview-baseline calibration.
export const TWO_COLUMN_BODY_BASE_UNIT = 6

// Legacy direct-PDF choice chunk unit before preview-baseline calibration.
export const TWO_COLUMN_CHOICE_BASE_UNIT = 5

export const PREVIEW_TWO_COLUMN_BASELINE: TwoColumnPreviewBaseline = {
  firstPageCapacity: 1280,
  otherPageCapacity: 1280,
  bodyLineUnit: 23,
  choiceLineUnit: 22,
  answerBaseUnit: 156,
}

function assertPositiveLineUnit(label: string, value: number) {
  if (value <= 0) {
    throw new Error(`${label} must be greater than 0 for two-column calibration`)
  }
}

function roundScaledUnit(baseUnit: number, previewLineUnit: number, pdfLineUnit: number) {
  assertPositiveLineUnit('preview line unit', previewLineUnit)
  assertPositiveLineUnit('pdf line unit', pdfLineUnit)

  return Math.round(baseUnit * (previewLineUnit / pdfLineUnit))
}

export function calibrateTwoColumnUnits(
  {
    preview,
    pdf,
  }: {
    preview: TwoColumnPreviewBaseline
    pdf: TwoColumnPdfLineUnitInput
  }
): TwoColumnCalibrationResult {
  assertPositiveLineUnit('preview body line unit', preview.bodyLineUnit)
  assertPositiveLineUnit('pdf body line unit', pdf.bodyLineUnit)
  assertPositiveLineUnit('preview choice line unit', preview.choiceLineUnit)
  assertPositiveLineUnit('pdf choice line unit', pdf.choiceLineUnit)

  const scaleRatio = preview.bodyLineUnit / pdf.bodyLineUnit

  return {
    scaleRatio,
    profile: {
      firstPageCapacity: preview.firstPageCapacity,
      otherPageCapacity: preview.otherPageCapacity,
      bodyBaseUnit: roundScaledUnit(
        TWO_COLUMN_BODY_BASE_UNIT,
        preview.bodyLineUnit,
        pdf.bodyLineUnit
      ),
      choiceBaseUnit: roundScaledUnit(
        TWO_COLUMN_CHOICE_BASE_UNIT,
        preview.choiceLineUnit,
        pdf.choiceLineUnit
      ),
      answerBaseUnit: preview.answerBaseUnit,
    },
  }
}
