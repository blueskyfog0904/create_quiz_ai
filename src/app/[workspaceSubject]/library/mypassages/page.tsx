import MyPassagesPage from '@/app/library/mypassages/page'

interface WorkspaceMyPassagesPageProps {
  params: Promise<{ workspaceSubject: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function WorkspaceMyPassagesPage({ params, searchParams }: WorkspaceMyPassagesPageProps) {
  const { workspaceSubject } = await params

  return (
    <MyPassagesPage
      params={Promise.resolve({ subject: workspaceSubject })}
      searchParams={searchParams}
    />
  )
}
