export function getWorkspaceLandingFeatureGridClassName(itemCount: number) {
  return itemCount <= 3
    ? 'mx-auto grid max-w-6xl gap-6 md:grid-cols-2 xl:grid-cols-3'
    : 'grid gap-6 md:grid-cols-2 xl:grid-cols-4'
}

export function getWorkspaceLandingWorkflowGridClassName(itemCount: number) {
  return itemCount <= 3
    ? 'mx-auto grid max-w-6xl gap-4 lg:grid-cols-3'
    : 'grid gap-4 lg:grid-cols-4'
}
