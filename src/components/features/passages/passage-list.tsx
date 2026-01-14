'use client';

import React from 'react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { 
  BookOpen, 
  Bookmark, 
  MoreVertical,
  Plus,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from '@/lib/utils';
import { Passage } from '@/app/api/passages/actions';
import { TagInput } from './tag-input';

interface PassageListProps {
  passages: Passage[];
  totalCount: number;
  currentPage: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  onView: (passage: Passage) => void;
  onBookmarkToggle: (id: string, current: boolean) => void;
  onTagAdd: (id: string, tags: string[]) => void;
}

export function PassageList({
  passages,
  totalCount,
  currentPage,
  itemsPerPage,
  onPageChange,
  onLimitChange,
  onView,
  onBookmarkToggle,
  onTagAdd
}: PassageListProps) {
  const totalPages = Math.ceil(totalCount / itemsPerPage) || 1;

  if (passages.length === 0) {
     return (
        <div className="text-center py-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <BookOpen className="w-10 h-10 mx-auto mb-4 opacity-50" />
            <p>표시할 지문이 없습니다.</p>
        </div>
     );
  }

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="flex items-center justify-between pb-2">
        <div className="text-sm text-muted-foreground">
             총 <span className="font-semibold text-foreground">{totalCount}</span>개 중 {passages.length}개 표시
        </div>
        <select 
            className="bg-transparent border rounded-md text-sm p-1 ml-auto"
            value={itemsPerPage}
            onChange={(e) => onLimitChange(Number(e.target.value))}
        >
            <option value={10}>10개씩 보기</option>
            <option value={30}>30개씩 보기</option>
            <option value={50}>50개씩 보기</option>
        </select>
      </div>

      <div className="border rounded-lg divide-y bg-card">
        {passages.map((passage) => (
          <div 
            key={passage.id} 
            className="group flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 hover:bg-accent/5 transition-colors"
          >
            {/* Bookmark */}
            <div className="flex items-center gap-3 shrink-0">
               <button 
                 onClick={(e) => { e.stopPropagation(); onBookmarkToggle(passage.id, !!passage.is_bookmarked); }}
                 className={cn(
                    "p-1 rounded-md hover:bg-muted transition-colors",
                    passage.is_bookmarked ? "text-yellow-500" : "text-muted-foreground/30 hover:text-muted-foreground"
                 )}
               >
                 <Bookmark className={cn("w-5 h-5", passage.is_bookmarked && "fill-current")} />
               </button>
               <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200 shrink-0">지문</Badge>
            </div>

            {/* Content Info */}
            <div 
                className="flex-1 min-w-0 cursor-pointer space-y-1"
                onClick={() => onView(passage)}
            >
                <div className="flex items-center gap-2 flex-wrap">
                     <h3 className="font-semibold text-base truncate">
                        {passage.title_ko || passage.title_en || '제목 없음'}
                     </h3>
                     
                     {/* Source Badges - matching question bank style */}
                     {(passage.source_type || passage.source_1 || passage.source_2 || passage.source_3 || passage.source_4) && (
                       <div className="flex items-center gap-1 flex-wrap">
                         {passage.source_type && (
                           <Badge variant="default" className="text-xs font-normal">
                             {passage.source_type}
                           </Badge>
                         )}
                         {passage.source_1 && (
                           <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                             {passage.source_1}
                           </Badge>
                         )}
                         {passage.source_2 && (
                           <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                             {passage.source_2}
                           </Badge>
                         )}
                         {passage.source_3 && (
                           <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                             {passage.source_3}
                           </Badge>
                         )}
                         {passage.source_4 && (
                           <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                             {passage.source_4}
                           </Badge>
                         )}
                       </div>
                     )}
                </div>
                {passage.title_en && (
                    <p className="text-xs text-muted-foreground truncate">{passage.title_en}</p>
                )}
                
                {/* Mobile Tags View */}
                <div className="flex sm:hidden flex-wrap gap-1 mt-1">
                     {passage.tags?.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">{tag}</Badge>
                     ))}
                </div>
            </div>

            {/* Right Side: Tags (Desktop) & Actions */}
            <div className="flex flex-row sm:flex-col md:flex-row items-center gap-2 w-full sm:w-auto justify-between sm:justify-end mt-2 sm:mt-0">
                {/* Tags Area */}
                <div className="hidden sm:flex flex-wrap gap-1 justify-end max-w-[300px]">
                    {passage.tags?.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs font-normal">
                             {tag}
                             <button
                                className="ml-1 hover:text-destructive"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    const newTags = passage.tags?.filter(t => t !== tag) || [];
                                    onTagAdd(passage.id, newTags);
                                }}
                             >
                                &times;
                             </button>
                        </Badge>
                    ))}
                    
                    {/* Add Tag Popover */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full border border-dashed text-muted-foreground hover:text-foreground">
                                <Plus className="w-3 h-3" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-2 w-[200px]" align="end">
                            <TagInput 
                                value={passage.tags || []} 
                                onChange={(newTags) => onTagAdd(passage.id, newTags)}
                                placeholder="태그 입력..."
                            />
                        </PopoverContent>
                    </Popover>
                </div>

                {/* Problem Count Badge (Dummy for now) */}
                <div className="shrink-0">
                    <Button variant="outline" size="sm" className="h-8 text-xs font-normal text-muted-foreground" disabled>
                        문제 (0개)
                    </Button>
                </div>
            </div>
          </div>
        ))}
      </div>
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2 mt-8">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onPageChange(currentPage - 1); }}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm px-4">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onPageChange(currentPage + 1); }}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
