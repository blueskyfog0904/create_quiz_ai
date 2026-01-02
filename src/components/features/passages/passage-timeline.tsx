'use client';

import * as React from 'react';
import { format, isSameDay } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Bookmark, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Passage } from '@/app/api/passages/actions';

interface PassageTimelineProps {
  passages: Passage[];
  onView: (passage: Passage) => void;
  onBookmarkToggle: (id: string, current: boolean) => void;
  onTagAdd: (id: string, tags: string[]) => void;
}

export function PassageTimeline({
  passages,
  onView,
  onBookmarkToggle,
  onTagAdd,
}: PassageTimelineProps) {
  // Group passages by date
  const groupedPassages = React.useMemo(() => {
    const groups: { date: Date; items: Passage[] }[] = [];
    
    passages.forEach((passage) => {
      const date = new Date(passage.created_at);
      const existingGroup = groups.find(g => isSameDay(g.date, date));
      
      if (existingGroup) {
        existingGroup.items.push(passage);
      } else {
        groups.push({ date, items: [passage] });
      }
    });
    
    return groups;
  }, [passages]);

  if (passages.length === 0) {
    return (
        <div className="text-center py-20 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
            <Clock className="w-10 h-10 mx-auto mb-4 opacity-50" />
            <p>표시할 지문이 없습니다.</p>
        </div>
    );
  }

  return (
    <div className="space-y-8 pl-4 border-l-2 border-muted relative">
      {groupedPassages.map((group, groupIdx) => (
        <div key={groupIdx} className="relative">
          {/* Date Header */}
          <div className="absolute -left-[21px] top-0 flex items-center gap-3">
             <div className="w-3 h-3 rounded-full bg-primary ring-4 ring-background" />
             <h3 className="font-bold text-lg text-foreground/80 flex items-center gap-2">
                {format(group.date, 'yyyy년 MM월 dd일 (EEE)', { locale: ko })}
                <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {group.items.length}개 지문
                </span>
             </h3>
          </div>

          <div className="pt-8 space-y-3">
            {group.items.map((passage) => (
               <div 
                 key={passage.id}
                 className="group relative bg-card hover:bg-accent/5 transition-colors border rounded-lg p-4 cursor-pointer flex gap-4 items-start shadow-sm hover:shadow"
                 onClick={() => onView(passage)}
               >
                  <div className="text-xs text-muted-foreground whitespace-nowrap pt-1 font-mono">
                    {format(new Date(passage.created_at), 'a h:mm', { locale: ko })}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                             <div 
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onBookmarkToggle(passage.id, !!passage.is_bookmarked);
                                }}
                                className={cn(
                                    "p-1 rounded-md hover:bg-muted transition-colors",
                                    passage.is_bookmarked ? "text-yellow-500" : "text-muted-foreground/30 hover:text-muted-foreground"
                                )}
                             >
                                <Bookmark className={cn("w-4 h-4", passage.is_bookmarked && "fill-current")} />
                             </div>
                             <h4 className="font-semibold truncate">
                                {passage.title_ko || passage.title_en || '제목 없음'}
                             </h4>
                             {passage.title_en && (
                                <span className="text-xs text-muted-foreground hidden sm:inline-block truncate max-w-[200px]">
                                    {passage.title_en}
                                </span>
                             )}
                          </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {passage.content}
                      </p>

                      <div className="flex flex-wrap gap-1">
                        {passage.tags?.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {tag}
                            </Badge>
                        ))}
                      </div>
                  </div>
               </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
