import { EditQuestionClient } from './edit-question-client'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditQuestionPage({ params }: PageProps) {
  const { id } = await params
  
  return (
    <div>
      <EditQuestionClient questionId={id} />
    </div>
  )
}

