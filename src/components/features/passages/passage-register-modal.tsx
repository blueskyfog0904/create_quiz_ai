'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { createPassage, Passage } from '@/app/api/passages/actions';
import { toast } from 'sonner';
import { usePathname } from 'next/navigation';
import { resolvePassageWorkspaceSubject } from './workspace-subject';

interface PassageRegisterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (passage: Passage) => void;
}

export function PassageRegisterModal({
  open,
  onOpenChange,
  onSuccess,
}: PassageRegisterModalProps) {
  const pathname = usePathname();
  const workspaceSubject = resolvePassageWorkspaceSubject(pathname);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [titleKo, setTitleKo] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      toast.error('지문 내용을 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newPassage = await createPassage({
        title_ko: titleKo,
        title_en: titleEn,
        content: content,
        content_translation: '', // Init empty
        tags: [],
        is_bookmarked: false,
      }, { workspaceSubject });

      toast.success('지문이 등록되었습니다.');
      onSuccess(newPassage);
      onOpenChange(false);
      // Reset form
      setTitleKo('');
      setTitleEn('');
      setContent('');
    } catch (error) {
      console.error(error);
      toast.error('지문 등록에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>새 영어 지문 등록</DialogTitle>
          <DialogDescription>
             직접 지문을 입력하여 등록합니다. 등록된 지문은 바로 사용 가능합니다.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="titleKo">제목 (한글)</Label>
              <Input
                id="titleKo"
                placeholder="예: 2024년 3월 모의고사 20번"
                value={titleKo}
                onChange={(e) => setTitleKo(e.target.value)}
              />
            </div>
             <div className="space-y-2">
              <Label htmlFor="titleEn">제목 (영어) - 선택</Label>
              <Input
                id="titleEn"
                placeholder="Optional"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">지문 내용 <span className="text-red-500">*</span></Label>
            <Textarea
              id="content"
              placeholder="영어 지문 내용을 입력하세요..."
              className="min-h-[300px] font-mono leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
             <p className="text-xs text-muted-foreground text-right">
                {content.length}자
             </p>
          </div>

          <DialogFooter className="justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              등록하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
