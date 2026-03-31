'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, ChevronLeft, ChevronRight, Bookmark } from 'lucide-react';
import { getPassages, Passage } from '@/app/api/passages/actions';
import { PassageFilterBar } from './passage-filter-bar';
import { PassageDetailModal } from './passage-detail-modal';
import { PassageTimeline } from './passage-timeline';
import { toast } from 'sonner';
import { usePathname, useRouter } from 'next/navigation';
import { buildPassageLibraryHref, resolvePassageWorkspaceSubject } from './workspace-subject';

interface PassageSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (passage: Passage) => void;
}

export function PassageSelectorModal({
  open,
  onOpenChange,
  onSelect,
}: PassageSelectorModalProps) {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceSubject = resolvePassageWorkspaceSubject(pathname);
  
  // Data state
  const [passages, setPassages] = useState<Passage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  // Filter state
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  
  // Confirmation dialog state
  const [confirmPassage, setConfirmPassage] = useState<Passage | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  // Detail modal state
  const [detailPassage, setDetailPassage] = useState<Passage | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  
  // Fetch passages
  const fetchPassages = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await getPassages({
        page: currentPage,
        limit: itemsPerPage,
        search: search || undefined,
        tags: tags.length > 0 ? tags : undefined,
        isBookmarked: isBookmarked || undefined,
        startDate: dateRange.from?.toISOString().split('T')[0],
        endDate: dateRange.to?.toISOString().split('T')[0],
        workspaceSubject,
      });
      setPassages(result.data);
      setTotalCount(result.count);
    } catch {
      toast.error('지문 목록을 불러오는데 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, itemsPerPage, search, tags, isBookmarked, dateRange, workspaceSubject]);
  
  // Load passages when modal opens or filters change
  useEffect(() => {
    if (open) {
      fetchPassages();
    }
  }, [open, fetchPassages]);
  
  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, tags, isBookmarked, dateRange]);
  
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  
  // Handle Use button click - show confirmation
  const handleUseClick = (passage: Passage) => {
    setConfirmPassage(passage);
    setShowConfirmDialog(true);
  };
  
  // Handle confirmation
  const handleConfirmUse = () => {
    if (confirmPassage) {
      onSelect(confirmPassage);
      setShowConfirmDialog(false);
      setConfirmPassage(null);
      onOpenChange(false);
    }
  };
  
  // Handle cancel confirmation
  const handleCancelConfirm = () => {
    setShowConfirmDialog(false);
    setConfirmPassage(null);
  };
  
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle>내 영어지문 불러오기</DialogTitle>
            <DialogDescription>
              AI 문제를 생성할 영어지문을 선택하세요.
            </DialogDescription>
          </DialogHeader>
          
          {/* Filter Bar */}
          <div className="px-6 py-3 border-b bg-muted/30 shrink-0">
            <PassageFilterBar
              search={search}
              onSearchChange={setSearch}
              tags={tags}
              onTagsChange={setTags}
              isBookmarked={isBookmarked}
              onBookmarkChange={setIsBookmarked}
              dateRange={dateRange}
              onDateRangeChange={(range) => setDateRange(range || {})}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          </div>
          
          {/* Passages List */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">지문 목록 로딩 중...</span>
              </div>
            ) : passages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
                {totalCount === 0 && !search && tags.length === 0 ? (
                  <>
                    <p className="text-muted-foreground">등록된 영어지문이 없습니다.</p>
                    <Button
                      variant="link"
                      className="mt-2"
                      onClick={() => {
                        onOpenChange(false);
                        router.push(buildPassageLibraryHref(pathname));
                      }}
                    >
                      영어지문 등록하러 가기 →
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">검색 결과가 없습니다.</p>
                )}
              </div>
            ) : viewMode === 'timeline' ? (
              /* Timeline View */
              <PassageTimeline
                passages={passages}
                onView={(p) => {
                  setDetailPassage(p);
                  setShowDetailModal(true);
                }}
                onBookmarkToggle={() => {}}
                onTagAdd={() => {}}
                onUse={handleUseClick}
              />
            ) : (
              /* List View */
              <div className="border rounded-lg divide-y">
                {passages.map(p => (
                  <div
                    key={p.id}
                    className="p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Clickable content area for detail view */}
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left focus:outline-none"
                        onClick={() => {
                          setDetailPassage(p);
                          setShowDetailModal(true);
                        }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {p.is_bookmarked && (
                            <Bookmark className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                          )}
                          <p className="font-medium truncate">
                            {p.title_ko || p.title_en || '제목 없음'}
                          </p>
                        </div>
                        {p.title_en && p.title_ko && (
                          <p className="text-sm text-muted-foreground truncate">{p.title_en}</p>
                        )}
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {p.content?.substring(0, 150)}...
                        </p>
                        {p.tags && p.tags.length > 0 && (
                          <div className="flex gap-1 mt-2 flex-wrap">
                            {p.tags.slice(0, 5).map(tag => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                            {p.tags.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{p.tags.length - 5}
                              </Badge>
                            )}
                          </div>
                        )}
                      </button>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString('ko-KR')}
                        </span>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleUseClick(p)}
                        >
                          사용
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-3 border-t bg-muted/30 shrink-0 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                총 {totalCount}개 중 {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, totalCount)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || isLoading}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || isLoading}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
          
          {/* Footer */}
          <div className="px-6 py-3 border-t shrink-0 flex justify-center">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>지문 사용 확인</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {confirmPassage && (
              <div className="space-y-3">
                <div className="p-4 border rounded-lg bg-muted/30">
                  <p className="font-medium text-lg">
                    {confirmPassage.title_ko || '제목 없음'}
                  </p>
                  {confirmPassage.title_en && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {confirmPassage.title_en}
                    </p>
                  )}
                </div>
                <p className="text-center text-muted-foreground">
                  이 지문을 사용하시겠습니까?
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="justify-center gap-2">
            <Button variant="outline" onClick={handleCancelConfirm}>
              취소
            </Button>
            <Button onClick={handleConfirmUse}>
              예
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Passage Detail Modal */}
      <PassageDetailModal
        passage={detailPassage}
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        onUpdate={fetchPassages}
        workspaceSubject={workspaceSubject}
      />
    </>
  );
}
