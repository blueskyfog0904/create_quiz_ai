'use client';

import { useState } from 'react';
import { updateSystemSettings } from '@/app/api/admin/settings/actions';
import { SystemSetting, AIConfig, DifficultyLevel } from '@/app/api/admin/settings/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Save, Plus, X, Trash2 } from 'lucide-react';

interface SettingsEditorProps {
  initialSettings: SystemSetting | null;
}

export default function SettingsEditor({ initialSettings }: SettingsEditorProps) {
  const [config, setConfig] = useState<AIConfig>(
    initialSettings?.value || {
      difficultyLevels: [
        { id: 'high', name: '고등 (High)', promptValue: 'advanced / high school level (CEFR B2-C1)' },
        { id: 'middle', name: '중등 (Middle)', promptValue: 'intermediate / middle school level (CEFR A2-B1)' }
      ],
      counts: [1, 3, 5, 10]
    }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [newCount, setNewCount] = useState('');

  // Count Handlers
  const handleAddCount = () => {
    const parsed = parseInt(newCount);
    if (isNaN(parsed) || parsed <= 0) return;
    if (config.counts.includes(parsed)) return;
    
    setConfig(prev => ({
      ...prev,
      counts: [...prev.counts, parsed].sort((a, b) => a - b)
    }));
    setNewCount('');
  };

  const handleRemoveCount = (num: number) => {
    setConfig(prev => ({
      ...prev,
      counts: prev.counts.filter(c => c !== num)
    }));
  };

  // Difficulty Handlers
  const handleAddDifficulty = () => {
    const newId = `diff_${Date.now()}`;
    setConfig(prev => ({
      ...prev,
      difficultyLevels: [
        ...(prev.difficultyLevels || []),
        { id: newId, name: '새 난이도', promptValue: '' }
      ]
    }));
  };

  const handleDifficultyChange = (id: string, field: keyof DifficultyLevel, val: string) => {
    setConfig(prev => ({
      ...prev,
      difficultyLevels: prev.difficultyLevels.map(lvl => 
        lvl.id === id ? { ...lvl, [field]: val } : lvl
      )
    }));
  };

  const handleRemoveDifficulty = (id: string) => {
    setConfig(prev => ({
      ...prev,
      difficultyLevels: prev.difficultyLevels.filter(lvl => lvl.id !== id)
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSystemSettings('ai_config', config);
      toast.success('설정이 저장되었습니다.');
    } catch (error) {
      toast.error('설정 저장 실패');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>AI 생성 설정 관리</CardTitle>
        <CardDescription>
          지문 생성 시 적용될 변수값과 UI 옵션을 설정합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-10">
        
        {/* Difficulty Configuration */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">난이도 프롬프트 값 설정</h3>
            <Button variant="outline" size="sm" onClick={handleAddDifficulty}>
              <Plus className="w-4 h-4 mr-2" /> 난이도 추가
            </Button>
          </div>
          
          <div className="grid gap-6">
            {config.difficultyLevels?.map((level) => (
              <div key={level.id} className="relative p-4 border rounded-lg bg-card/50 space-y-3 group">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleRemoveDifficulty(level.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-1 space-y-2">
                    <Label>난이도 표시 이름 (UI)</Label>
                    <Input 
                      value={level.name}
                      onChange={(e) => handleDifficultyChange(level.id, 'name', e.target.value)}
                      placeholder="예: 고등 (High)"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label>프롬프트 값 (Value)</Label>
                    <Input 
                      value={level.promptValue}
                      onChange={(e) => handleDifficultyChange(level.id, 'promptValue', e.target.value)}
                      placeholder="예: advanced high school level..."
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  AI 프롬프트의 {`{difficulty}`} 변수에 "<b>{level.promptValue || '...'}</b>" 값이 주입됩니다.
                </p>
              </div>
            ))}
            {(!config.difficultyLevels || config.difficultyLevels.length === 0) && (
               <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                 등록된 난이도가 없습니다. 추가해주세요.
               </div>
            )}
          </div>
        </div>

        {/* Counts Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">생성할 지문 개수 옵션</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {config.counts.map((num) => (
              <div key={num} className="flex items-center bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm">
                {num}개
                <button 
                  onClick={() => handleRemoveCount(num)}
                  className="ml-2 hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 max-w-xs">
            <Input 
              type="number" 
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              placeholder="숫자 입력"
              className="w-24"
            />
            <Button variant="outline" size="sm" onClick={handleAddCount}>
              <Plus className="w-4 h-4 mr-1" /> 추가
            </Button>
          </div>
        </div>

        <div className="pt-4 border-t flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            설정 저장
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
