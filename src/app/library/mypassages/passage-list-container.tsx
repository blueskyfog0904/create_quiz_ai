'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PassageList } from '@/components/features/passages/passage-list';
import { PassageTimeline } from '@/components/features/passages/passage-timeline';
import { PassageDetailModal } from '@/components/features/passages/passage-detail-modal';
import { PassageFilterBar } from '@/components/features/passages/passage-filter-bar';
import { Passage, updatePassage } from '@/app/api/passages/actions';
import { toast } from 'sonner';

interface PassageListContainerProps {
  initialPassages: Passage[];
  totalCount: number;
  currentPage: number;
  itemsPerPage: number;
}

export function PassageListContainer({
  initialPassages,
  totalCount,
  currentPage,
  itemsPerPage,
}: PassageListContainerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Local state for optimistic updates
  const [passages, setPassages] = useState<Passage[]>(initialPassages);
  
  const [selectedPassage, setSelectedPassage] = useState<Passage | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filter States
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [tags, setTags] = useState<string[]>(searchParams.getAll('tags') || []);
  const [isBookmarked, setIsBookmarked] = useState(searchParams.get('isBookmarked') === 'true');
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date } | undefined>(() => {
    const start = searchParams.get('startDate');
    const end = searchParams.get('endDate');
    return start ? { from: new Date(start), to: end ? new Date(end) : undefined } : undefined;
  });
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');

  // Sync props to state (when server refetches)
  useEffect(() => {
    setPassages(initialPassages);
  }, [initialPassages]);

  // Handle URL updates for filters
  const updateFilters = (newParams: Record<string, any>) => {
    const params = new URLSearchParams(searchParams.toString());
    
    // Reset page on filter change
    if (!newParams.page) params.set('page', '1');

    Object.entries(newParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0) || value === false) {
        params.delete(key);
      } else if (Array.isArray(value)) {
        params.delete(key);
        value.forEach(v => params.append(key, v));
      } else if (value instanceof Date) {
        params.set(key, value.toISOString().split('T')[0]);
      } else {
        params.set(key, String(value));
      }
    });

    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Filter Handlers
  const handleSearchChange = (val: string) => {
    setSearch(val);
    // Debounce usually recommended, but for now direct update
  };
  // Trigger search on Enter or blur could be better, but let's debounce effect
  useEffect(() => {
      const timer = setTimeout(() => {
          if (search !== (searchParams.get('search') || '')) {
              updateFilters({ search });
          }
      }, 500);
      return () => clearTimeout(timer);
  }, [search]);

  const handleTagsChange = (newTags: string[]) => {
    setTags(newTags);
    updateFilters({ tags: newTags });
  };

  const handleBookmarkFilterChange = (checked: boolean) => {
    setIsBookmarked(checked);
    updateFilters({ isBookmarked: checked });
  };

  const handleDateRangeChange = (range: { from?: Date; to?: Date } | undefined) => {
    setDateRange(range);
    updateFilters({ 
        startDate: range?.from, 
        endDate: range?.to 
    });
  };

  // Pagination Handlers
  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`?${params.toString()}`, { scroll: false });
  };

  const handleLimitChange = (limit: number) => {
    updateFilters({ limit });
  };

  const handleUpdate = () => {
    router.refresh();
  };

  // Data Update Handlers (Optimistic)
  const handleBookmarkToggle = async (id: string, current: boolean) => {
    // Optimistic update
    setPassages(prev => prev.map(p => p.id === id ? { ...p, is_bookmarked: !current } : p));
    
    try {
        await updatePassage(id, { is_bookmarked: !current });
        toast.success(current ? '북마크 해제됨' : '북마크 추가됨');
        router.refresh(); 
    } catch (error) {
        // Revert
        setPassages(prev => prev.map(p => p.id === id ? { ...p, is_bookmarked: current } : p));
        toast.error('북마크 업데이트 실패');
    }
  };

  const handleTagAdd = async (id: string, newTags: string[]) => {
    // Optimistic update
    setPassages(prev => prev.map(p => p.id === id ? { ...p, tags: newTags } : p));

    try {
        await updatePassage(id, { tags: newTags });
        router.refresh();
    } catch (error) {
        toast.error('태그 업데이트 실패');
        router.refresh(); // Revert by refresh
    }
  };

  return (
    <>
      <PassageFilterBar 
        search={search}
        onSearchChange={handleSearchChange}
        tags={tags}
        onTagsChange={handleTagsChange}
        isBookmarked={isBookmarked}
        onBookmarkChange={handleBookmarkFilterChange}
        dateRange={dateRange || {}}
        onDateRangeChange={handleDateRangeChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {viewMode === 'list' ? (
          <PassageList 
            passages={passages}
            totalCount={totalCount}
            currentPage={currentPage}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
            onView={(passage) => {
              setSelectedPassage(passage);
              setIsModalOpen(true);
            }}
            onBookmarkToggle={handleBookmarkToggle}
            onTagAdd={handleTagAdd}
          />
      ) : (
          <PassageTimeline 
             passages={passages}
             onView={(passage) => {
                 setSelectedPassage(passage);
                 setIsModalOpen(true);
             }}
             onBookmarkToggle={handleBookmarkToggle}
             onTagAdd={handleTagAdd}
          />
      )}

      <PassageDetailModal 
        passage={selectedPassage}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onUpdate={handleUpdate}
      />
    </>
  );
}
