'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { TagInput } from './tag-input';
import { Loader2, Trash2, Edit2, Save, Bookmark, Copy } from 'lucide-react';
import { Passage, updatePassage, deletePassage } from '@/app/api/passages/actions';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface PassageDetailModalProps {
  passage: Passage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function PassageDetailModal({ 
  passage, 
  open, 
  onOpenChange,
  onUpdate
}: PassageDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [titleEn, setTitleEn] = useState('');
  const [titleKo, setTitleKo] = useState('');
  const [content, setContent] = useState('');
  const [translation, setTranslation] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isLineByLine, setIsLineByLine] = useState(false);

  // Render sentences in fixed 3-line height blocks for perfect alignment
  const renderLineByLine = (text: string) => {
    if (!text) return null;
    const sentences = text.split('\n').filter(s => s.trim());
    return (
      <div className="space-y-0">
        {sentences.map((sentence, index) => (
          <div 
            key={index} 
            className="min-h-[4.5em] flex items-start border-b border-dashed border-muted-foreground/20 py-2"
            style={{ lineHeight: '1.5em' }}
          >
            <span className="text-muted-foreground text-xs mr-3 mt-0.5 select-none w-6 text-right shrink-0">
              {index + 1}.
            </span>
            <span>{sentence}</span>
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (passage && open) {
      setTitleEn(passage.title_en || '');
      setTitleKo(passage.title_ko || '');
      setContent(passage.content || '');
      setTranslation(passage.content_translation || '');
      setTags(passage.tags || []);
      setIsBookmarked(!!passage.is_bookmarked);
      setIsEditing(false); // Reset edit mode on open
    }
  }, [passage, open]);

  if (!passage) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updatePassage(passage.id, {
        title_en: titleEn || null,
        title_ko: titleKo || null,
        content: content,
        content_translation: translation || null,
        tags: tags,
        is_bookmarked: isBookmarked
      });
      toast.success('지문이 수정되었습니다.');
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      toast.error('수정 중 오류가 발생했습니다.');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('정말로 이 지문을 삭제하시겠습니까?')) return;
    
    setIsDeleting(true);
    try {
      await deletePassage(passage.id);
      toast.success('지문이 삭제되었습니다.');
      onOpenChange(false);
      onUpdate();
    } catch (error) {
      console.error(error);
      toast.error('삭제 실패');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleBookmarkToggle = () => {
      // Toggle local state and auto-save if not in explicit edit mode
      const newValue = !isBookmarked;
      setIsBookmarked(newValue);

      if (!isEditing) {
          updatePassage(passage.id, { is_bookmarked: newValue })
            .then(() => {
                toast.success(newValue ? '북마크 추가됨' : '북마크 해제됨');
                onUpdate();
            })
            .catch(() => {
                setIsBookmarked(!newValue); // Revert
                toast.error('북마크 업데이트 실패');
            });
      }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-40px)] max-w-none h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2 border-b shrink-0">
           <DialogTitle className="flex justify-between items-start">
             <div className="flex items-start gap-4">
                 <button 
                    onClick={handleBookmarkToggle}
                    className={cn(
                        "mt-1 p-1 rounded-md hover:bg-muted transition-colors",
                        isBookmarked ? "text-yellow-500" : "text-muted-foreground/30 hover:text-muted-foreground"
                    )}
                 >
                    <Bookmark className={cn("w-6 h-6", isBookmarked && "fill-current")} />
                 </button>
                 <div className="space-y-1">
                     <h2 className="text-xl font-bold leading-none">
                        {isEditing ? '지문 수정' : (titleKo || '제목 없음')}
                     </h2>
                     {!isEditing && titleEn && (
                         <p className="text-sm text-muted-foreground">{titleEn}</p>
                     )}
                 </div>
                 {/* Tags in Header */}
                 {!isEditing && (
                   <div className="flex flex-wrap gap-1.5 ml-4 items-center">
                     {tags.length > 0 ? (
                       tags.map(tag => <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>)
                     ) : null}
                   </div>
                 )}
             </div>
             
             {!isEditing && (
                <div className="flex gap-2 mr-8">
                   <Button 
                     variant="outline" 
                     size="sm" 
                     onClick={() => setIsEditing(true)}
                     className="gap-2"
                   >
                     <Edit2 className="w-3 h-3" /> 수정
                   </Button>
                   <Button 
                     variant="destructive" 
                     size="sm" 
                     onClick={handleDelete}
                     disabled={isDeleting}
                     className="gap-2"
                   >
                     {isDeleting ? <Loader2 className="w-3 h-3 animate-spin"/> : <Trash2 className="w-3 h-3" />} 
                     삭제
                   </Button>
                </div>
             )}
           </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
           <div className="grid md:grid-cols-2 gap-8 h-full">
              <div className="space-y-6 flex flex-col">
                 {/* Left Column */}
                 
                 {/* Tags (only in edit mode) */}
                 {isEditing && (
                   <div className="space-y-2">
                      <Label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Tags</Label>
                      <TagInput value={tags} onChange={setTags} />
                   </div>
                 )}

                 {/* Titles (Only in Edit Mode) */}
                 {isEditing && (
                    <>
                        <div className="space-y-2">
                            <Label>한글 제목</Label>
                            <Input value={titleKo} onChange={(e) => setTitleKo(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>영어 제목</Label>
                            <Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
                        </div>
                    </>
                 )}

                 {/* Content */}
                 <div className="space-y-2 flex-1 flex flex-col">
                   <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Original Content</Label>
                          <button
                            type="button"
                            onClick={() => setIsLineByLine(!isLineByLine)}
                            className={cn(
                              "text-xs px-2 py-0.5 rounded border transition-colors",
                              isLineByLine 
                                ? "bg-primary text-primary-foreground border-primary" 
                                : "bg-muted/50 text-muted-foreground border-muted hover:bg-muted"
                            )}
                          >
                            한줄씩 보기
                          </button>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6" 
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(content);
                              toast.success('영어 지문이 복사되었습니다.');
                            } catch (err) {
                              toast.error('복사에 실패했습니다.');
                            }
                          }}
                        >
                            <Copy className="w-3 h-3" />
                        </Button>
                   </div>
                   {isEditing ? (
                     <Textarea 
                       value={content} 
                       onChange={(e) => setContent(e.target.value)} 
                       className="flex-1 min-h-[300px] font-mono leading-relaxed resize-none p-4"
                     />
                    ) : isLineByLine ? (
                      <div className="flex-1 bg-muted/30 border rounded-md p-4 text-base leading-relaxed font-serif overflow-y-auto shadow-sm">
                        {renderLineByLine(content)}
                      </div>
                    ) : (
                      <div className="flex-1 bg-muted/30 border rounded-md p-6 text-base leading-relaxed font-serif overflow-y-auto shadow-sm">
                        {content}
                      </div>
                   )}
                 </div>
              </div>

              <div className="space-y-6 flex flex-col">
                 {/* Right Column: Translation */}
                 <div className="space-y-2 flex-1 flex flex-col">
                    <div className="flex items-center justify-between">
                        <Label className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Korean Translation</Label>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6" 
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(translation || '');
                              toast.success('한글 번역이 복사되었습니다.');
                            } catch (err) {
                              toast.error('복사에 실패했습니다.');
                            }
                          }}
                        >
                            <Copy className="w-3 h-3" />
                        </Button>
                    </div>
                   {isEditing ? (
                     <Textarea 
                       value={translation} 
                       onChange={(e) => setTranslation(e.target.value)} 
                       className="flex-1 min-h-[300px] leading-relaxed resize-none p-4"
                       placeholder="번역 입력"
                     />
                    ) : isLineByLine ? (
                      <div className="flex-1 bg-muted/50 border-none rounded-md p-4 text-base leading-relaxed text-foreground/90 overflow-y-auto">
                        {renderLineByLine(translation)}
                      </div>
                    ) : (
                      <div className="flex-1 bg-muted/50 border-none rounded-md p-6 text-base leading-relaxed text-foreground/90 overflow-y-auto">
                        {translation || '번역 내용이 없습니다.'}
                      </div>
                   )}
                 </div>
              </div>
           </div>
        </div>

        {isEditing && (
          <div className="p-4 border-t bg-muted/10 shrink-0 flex justify-center gap-2">
             <Button variant="ghost" onClick={() => setIsEditing(false)} disabled={isSaving}>취소</Button>
             <Button onClick={handleSave} disabled={isSaving} className="gap-2 min-w-[100px]">
               {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
               저장
             </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
