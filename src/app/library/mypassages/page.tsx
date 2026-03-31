import { getPassages } from '@/app/api/passages/actions';
import { PassageSelector } from '@/components/features/passages/passage-selector';
import { PassageListContainer } from './passage-list-container';
import { DEFAULT_WORKSPACE_SUBJECT, isWorkspaceSubject } from '@/lib/workspace-subject';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  params?: Promise<{ subject?: string }>;
}

export default async function MyPassagesPage({ searchParams, params }: PageProps) {
  const queryParams = await searchParams;
  const routeParams = params ? await params : undefined;
  const workspaceSubject = isWorkspaceSubject(routeParams?.subject)
    ? routeParams.subject
    : DEFAULT_WORKSPACE_SUBJECT
  
  const page = Number(queryParams?.page) || 1;
  const limit = Number(queryParams?.limit) || 10;
  const search = typeof queryParams?.search === 'string' ? queryParams.search : undefined;
  
  // Normalize tags to string[]
  let tags: string[] | undefined;
  if (queryParams?.tags) {
    tags = Array.isArray(queryParams.tags) ? queryParams.tags : [queryParams.tags];
  }

  // Normalize isBookmarked
  const isBookmarked = queryParams?.isBookmarked === 'true' ? true :
                       queryParams?.isBookmarked === 'false' ? false : undefined;

  const startDate = typeof queryParams?.startDate === 'string' ? queryParams.startDate : undefined;
  const endDate = typeof queryParams?.endDate === 'string' ? queryParams.endDate : undefined;

  // Source filters
  const sourceType = typeof queryParams?.sourceType === 'string' ? queryParams.sourceType : undefined;
  const source1 = typeof queryParams?.source1 === 'string' ? queryParams.source1 : undefined;
  const source2 = typeof queryParams?.source2 === 'string' ? queryParams.source2 : undefined;
  const source3 = typeof queryParams?.source3 === 'string' ? queryParams.source3 : undefined;
  const source4 = typeof queryParams?.source4 === 'string' ? queryParams.source4 : undefined;

  const { data: passages, count } = await getPassages({
    page,
    limit,
    search,
    tags,
    isBookmarked,
    startDate,
    endDate,
    sourceType,
    source1,
    source2,
    source3,
    source4,
    workspaceSubject,
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto py-10 space-y-12">
        {/* Top Section: Passage Selector */}
        <section>
          <PassageSelector workspaceSubject={workspaceSubject} />
        </section>

        {/* Bottom Section: Passage List */}
        <section id="passage-list" className="scroll-mt-10">
           <PassageListContainer 
             initialPassages={passages}
             totalCount={count}
             currentPage={page}
             itemsPerPage={limit}
             workspaceSubject={workspaceSubject}
           />
        </section>
      </div>
    </div>
  );
}
