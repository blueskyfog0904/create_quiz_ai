'use client';

import { useState } from 'react';
import { SystemPrompt, updateSystemPrompt } from '@/app/api/admin/prompts/actions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Loader2, Save, Undo } from 'lucide-react';

interface PromptEditorProps {
  initialPrompts: SystemPrompt[];
}

export default function PromptEditor({ initialPrompts }: PromptEditorProps) {
  const [prompts, setPrompts] = useState(initialPrompts);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Map easy-to-read names
  const promptNames: Record<string, string> = {
    'ocr_pdf_extraction': 'OCR 텍스트 추출 (PDF/Image)',
    'ai_passage_generation': 'AI 지문 생성 (주제별)'
  };

  const startEditing = (prompt: SystemPrompt) => {
    setEditingKey(prompt.key);
    setEditContent(prompt.content);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditContent('');
  };

  const handleSave = async (key: string) => {
    setIsSaving(true);
    try {
      await updateSystemPrompt(key, editContent);
      
      // Update local state
      setPrompts(prompts.map(p => 
        p.key === key ? { ...p, content: editContent, updated_at: new Date().toISOString() } : p
      ));
      
      toast.success('프롬프트가 업데이트되었습니다.');
      setEditingKey(null);
    } catch (error) {
      toast.error('저장 실패');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {prompts.map((prompt) => (
        <Card key={prompt.key} className="overflow-hidden">
          <CardHeader className="bg-muted/30 pb-4">
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg">
                  {promptNames[prompt.key] || prompt.key}
                </CardTitle>
                <CardDescription className="mt-1">
                  {prompt.description}
                </CardDescription>
                <div className="text-xs text-muted-foreground mt-2 font-mono">
                  KEY: {prompt.key}
                </div>
              </div>
              
              {editingKey !== prompt.key ? (
                <Button variant="outline" size="sm" onClick={() => startEditing(prompt)}>
                  수정하기
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={isSaving}>
                    <Undo className="w-4 h-4 mr-1" /> 취소
                  </Button>
                  <Button size="sm" onClick={() => handleSave(prompt.key)} disabled={isSaving}>
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    저장
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {editingKey === prompt.key ? (
              <div className="p-4 bg-background">
                <Textarea 
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[200px] font-mono text-sm leading-relaxed"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  * 변경 사항은 즉시 시스템에 반영됩니다. 신중하게 수정해주세요.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-muted/10 font-mono text-sm leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {prompt.content}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
