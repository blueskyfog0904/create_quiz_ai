// Display label mapping utilities for client-side usage
// These are static mappings that can be used without API calls.
// For dynamic values managed in admin panel, use the API.

export interface DisplayLabelMap {
  [dbValue: string]: string;
}

// Default mappings (fallback when DB is not available)
export const defaultGradeLevelLabels: DisplayLabelMap = {
  'Middle1': '중1',
  'Middle2': '중2',
  'Middle3': '중3',
  'High1': '고1',
  'High2': '고2',
  'High3': '고3',
};

export const defaultDifficultyLabels: DisplayLabelMap = {
  'Low': '하',
  'Medium': '중',
  'High': '상',
};

// Get display value with fallback
export function getGradeLevelLabel(dbValue: string, labelMap?: DisplayLabelMap): string {
  const map = labelMap || defaultGradeLevelLabels;
  return map[dbValue] || dbValue;
}

export function getDifficultyLabel(dbValue: string, labelMap?: DisplayLabelMap): string {
  const map = labelMap || defaultDifficultyLabels;
  return map[dbValue] || dbValue;
}

// Convert array of labels to map for easy lookup
export function labelsToMap(labels: Array<{ db_value: string; display_value: string }>): DisplayLabelMap {
  return labels.reduce((acc, label) => {
    acc[label.db_value] = label.display_value;
    return acc;
  }, {} as DisplayLabelMap);
}
