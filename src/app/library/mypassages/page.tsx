import { Suspense } from 'react';
import { getPassages } from '@/app/api/passages/actions';
import { PassageSelector } from '@/components/features/passages/passage-selector';
import { PassageListContainer } from './passage-list-container';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function MyPassagesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  
  const page = Number(params?.page) || 1;
  const limit = Number(params?.limit) || 10;
  const search = typeof params?.search === 'string' ? params.search : undefined;
  
  // Normalize tags to string[]
  let tags: string[] | undefined;
  if (params?.tags) {
    tags = Array.isArray(params.tags) ? params.tags : [params.tags];
  }

  // Normalize isBookmarked
  const isBookmarked = params?.isBookmarked === 'true' ? true : 
                       params?.isBookmarked === 'false' ? false : undefined;

  const startDate = typeof params?.startDate === 'string' ? params.startDate : undefined;
  const endDate = typeof params?.endDate === 'string' ? params.endDate : undefined;

  // Source filters
  const sourceType = typeof params?.sourceType === 'string' ? params.sourceType : undefined;
  const source1 = typeof params?.source1 === 'string' ? params.source1 : undefined;
  const source2 = typeof params?.source2 === 'string' ? params.source2 : undefined;
  const source3 = typeof params?.source3 === 'string' ? params.source3 : undefined;
  const source4 = typeof params?.source4 === 'string' ? params.source4 : undefined;

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
    source4
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto py-10 space-y-12">
        {/* Top Section: Passage Selector */}
        <section>
          <PassageSelector />
        </section>

        {/* Bottom Section: Passage List */}
        <section id="passage-list" className="scroll-mt-10">
           <PassageListContainer 
             initialPassages={passages}
             totalCount={count}
             currentPage={page}
             itemsPerPage={limit}
           />
        </section>
      </div>
    </div>
  );
}
