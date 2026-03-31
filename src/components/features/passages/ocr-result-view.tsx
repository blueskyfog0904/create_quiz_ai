'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { 
  X, 
  Plus, 
  CheckCircle2, 
  Loader2,
  ArrowLeft,
  Sparkles,
  Bot,
  Languages,
  Type,
  BookOpen
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { createPassage, enrichPassage, type PassageAnalysis } from '@/app/api/passages/actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePathname } from 'next/navigation';
import { type WorkspaceSubject } from '@/lib/workspace-subject';
import { resolvePassageWorkspaceSubject } from './workspace-subject';

interface OCRResultViewProps {
  initialPassages: string[];
  preAnalyzedData?: PassageAnalysis[];
  workspaceSubject?: WorkspaceSubject;
  onBack: () => void;
  onClose: () => void;
  onComplete: () => void;
}

interface SourceConfig {
  id: string;
  type_name: string;
  source_1_label?: string | null;
  source_1_options?: string[] | null;
  source_2_label?: string | null;
  source_2_options?: string[] | null;
  source_3_label?: string | null;
  source_3_options?: string[] | null;
  source_4_label?: string | null;
  source_4_options?: string[] | null;
}

interface PassageData {
  id: string;
  content: string;
  title_en: string;
  title_ko: string;
  content_translation: string;
  source_type: string;
  source_1: string;
  source_2: string;
  source_3: string;
  source_4: string;
}

export function OCRResultView({
  initialPassages,
  preAnalyzedData,
  workspaceSubject,
  onBack,
  onClose,
  onComplete,
}: OCRResultViewProps) {
  const pathname = usePathname()
  const activeWorkspaceSubject = resolvePassageWorkspaceSubject(pathname, workspaceSubject)
  // Mode: 'raw' (initial text editing) -> 'analyzed' (metadata editing)
  const [isAnalyzed, setIsAnalyzed] = useState(!!preAnalyzedData);
  
  // Source configs from admin
  const [sourceConfigs, setSourceConfigs] = useState<SourceConfig[]>([]);
  const [selectedSourceType, setSelectedSourceType] = useState<string>('');
  const [selectedSource1, setSelectedSource1] = useState<string>('');
  const [selectedSource2, setSelectedSource2] = useState<string>('');
  const [selectedSource3, setSelectedSource3] = useState<string>('');
  const [selectedSource4, setSelectedSource4] = useState<string>('');

  // Fetch source configs on mount
  useEffect(() => {
    const fetchSourceConfigs = async () => {
      try {
        const response = await fetch('/api/admin/source-configs');
        if (response.ok) {
          const data = await response.json();
          setSourceConfigs(data.configs || []);
        }
      } catch (error) {
        console.error('Failed to fetch source configs:', error);
      }
    };
    fetchSourceConfigs();
  }, []);

  // Get active source config based on selected type
  const activeSourceConfig = useMemo(() => {
    return sourceConfigs.find(c => c.type_name === selectedSourceType) || null;
  }, [sourceConfigs, selectedSourceType]);

  // Reset source 1-4 when source type changes
  useEffect(() => {
    setSelectedSource1('');
    setSelectedSource2('');
    setSelectedSource3('');
    setSelectedSource4('');
  }, [selectedSourceType]);
  
  const [passages, setPassages] = useState<PassageData[]>(() => {
    if (preAnalyzedData && preAnalyzedData.length > 0) {
      // Use pre-analyzed data
      return preAnalyzedData.map((data) => ({
        id: crypto.randomUUID(),
        content: data.content_refined || initialPassages[data.original_index] || '',
        title_en: data.title_en || '',
        title_ko: data.title_ko || '',
        content_translation: data.content_translation || '',
        source_type: '',
        source_1: '',
        source_2: '',
        source_3: '',
        source_4: ''
      }));
    }
    // Use initial passages for raw editing
    return initialPassages.map((text) => ({
      id: crypto.randomUUID(),
      content: text,
      title_en: '',
      title_ko: '',
      content_translation: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: ''
    }));
  });
  
  const [removeLineBreaks, setRemoveLineBreaks] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Analyzing or Saving
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [isLineByLine, setIsLineByLine] = useState(false); // Toggle for analyzed view

  // --- Helpers ---

  const handleTextChange = (id: string, field: keyof PassageData, value: string) => {
    setPassages(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const processText = (text: string) => {
    if (removeLineBreaks) {
      return text.replace(/\n+/g, ' ');
    }
    return text;
  };

  // Process text for analyzed view display based on isLineByLine toggle
  const processTextForDisplay = (text: string) => {
    if (!isLineByLine) {
      // Remove line breaks for continuous display
      return text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return text;
  };

  const handleRemovePassage = (id: string) => {
    setPassages(prev => prev.filter(p => p.id !== id));
  };

  const handleAddPassage = () => {
    setPassages(prev => [...prev, {
      id: crypto.randomUUID(),
      content: '',
      title_en: '',
      title_ko: '',
      content_translation: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: ''
    }]);
  };

  // --- Actions ---

  // --- Actions ---

  // Phase 1 -> Phase 2: AI Analysis
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [showProgressModal, setShowProgressModal] = useState(false);
  const isCancelledRef = useRef(false);

  const handleCancelAnalysis = useCallback(() => {
    if (confirm('분석을 중단하시겠습니까?')) {
        isCancelledRef.current = true;
        setShowProgressModal(false);
        setIsProcessing(false);
        toast.info('분석이 취소되었습니다.');
    }
  }, []);

  const handleAnalyze = async () => {
    const validPassages = passages.filter(p => p.content.trim().length > 0);
    if (validPassages.length === 0) {
      toast.error('분석할 지문이 없습니다.');
      return;
    }

    setIsProcessing(true);
    setShowProgressModal(true);
    setAnalysisProgress({ current: 0, total: validPassages.length });
    isCancelledRef.current = false;

    try {
      const updatedPassages = [...passages];
      let completedCount = 0;

      // Process sequentially to show progress
      for (let i = 0; i < validPassages.length; i++) {
        if (isCancelledRef.current) break;

        const passage = validPassages[i];
        
        // Find index in original passages array
        const originalIndex = passages.findIndex(p => p.id === passage.id);
        
        const contentToSend = removeLineBreaks ? passage.content.replace(/\n+/g, ' ') : passage.content;
        
        try {
          // Process single passage
          const result = await enrichPassage(contentToSend);
          
          if (originalIndex !== -1) {
             updatedPassages[originalIndex] = {
               ...updatedPassages[originalIndex],
               content: result.content_refined || updatedPassages[originalIndex].content,
               title_en: result.title_en,
               title_ko: result.title_ko,
               content_translation: result.content_translation
             };
          }
          completedCount++;
        } catch (err) {
          console.error(`Failed to analyze passage ${i+1}`, err);
          // Continue with others even if one fails
        }

        // Update progress
        setAnalysisProgress(prev => ({ ...prev, current: i + 1 }));
      }

      if (!isCancelledRef.current) {
        setPassages(updatedPassages);
        setIsAnalyzed(true); // Switch to analyzed view
        toast.success(`${completedCount}개의 지문 분석이 완료되었습니다.`);
      }

    } catch (error) {
      console.error(error);
      toast.error('AI 분석 중 오류가 발생했습니다.');
    } finally {
      if (!isCancelledRef.current) {
        setIsProcessing(false);
        setShowProgressModal(false);
      }
    }
  };

  // Phase 2: Final Save
  const handleSaveAll = async () => {
    const validPassages = passages.filter(p => p.content.trim().length > 0);
    if (validPassages.length === 0) {
      toast.error('저장할 지문 내용이 없습니다.');
      return;
    }

    setIsProcessing(true);
    try {
      let successCount = 0;
      await Promise.all(validPassages.map(async (p, index) => {
        // Use processed text if checkbox is checked
        const finalContent = removeLineBreaks ? p.content.replace(/\n+/g, ' ').trim() : p.content.trim();
        
        await createPassage({
          content: finalContent,
          title_en: p.title_en || `Extracted Passage ${index + 1}`,
          title_ko: p.title_ko || null,
          content_translation: p.content_translation || null,
          // Use shared source fields for all passages
          source_type: selectedSourceType || null,
          source_1: selectedSource1 || null,
          source_2: selectedSource2 || null,
          source_3: selectedSource3 || null,
          source_4: selectedSource4 || null
        }, { workspaceSubject: activeWorkspaceSubject });
        successCount++;
      }));

      toast.success(`${successCount}개의 지문이 저장되었습니다.`);
      onComplete();

    } catch (error) {
      console.error(error);
      toast.error('지문 저장 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };


  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 relative">
      {/* Progress Modal */}
      {showProgressModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl w-full max-w-md p-6 relative animate-in zoom-in-95 duration-200">
            {/* Close Button */}
            <button 
                onClick={handleCancelAnalysis}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                type="button"
            >
                <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-6 py-4">
                <div className="space-y-2">
                    <h3 className="text-xl font-bold">AI 분석 및 메타데이터 생성 중</h3>
                    <p className="text-gray-500 text-sm">
                        지문을 분석하고 있습니다, 잠시만 기다려주세요..
                    </p>
                </div>

                <div className="flex justify-center">
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>

                <div className="space-y-1">
                     <p className="text-sm text-gray-400">
                        창을 닫거나, 새로고침하지 마세요.
                     </p>
                     <p className="text-lg font-semibold">
                        {analysisProgress.current} / {analysisProgress.total} 개 완료됨
                     </p>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                        className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                    />
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10 py-4 border-b">
        <div className="flex items-center gap-2">
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowBackConfirm(true)} 
                className="pl-0 gap-2 hover:bg-transparent hover:text-primary"
            >
                <ArrowLeft className="w-5 h-5" />
                <span className="text-xl font-bold text-foreground">
                  {isAnalyzed ? '지문 분석 및 수정' : '지문 추출 결과'}
                </span>
            </Button>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {isAnalyzed ? '(AI 생성 데이터 확인)' : '(이미지 재확인)'}
            </span>
        </div>
        <Button variant="ghost" onClick={onClose} size="sm">
          <X className="w-4 h-4 mr-2" /> 닫기
        </Button>
      </div>

      <div className="space-y-8">
        {/* Source Selection (Only in Analyzed View - Optional) */}
        {isAnalyzed && sourceConfigs.length > 0 && (
          <div className="p-4 bg-indigo-50/80 rounded-lg border border-indigo-100 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              <Label className="text-sm font-semibold text-indigo-900">출처 정보 (선택사항)</Label>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              {/* Source Type */}
              <div className="min-w-[150px]">
                <label className="text-xs font-medium text-indigo-900 mb-1 block">
                  출처 종류
                </label>
                <Select value={selectedSourceType || 'none'} onValueChange={(val) => setSelectedSourceType(val === 'none' ? '' : val)}>
                  <SelectTrigger className="h-9 bg-white border-indigo-200">
                    <SelectValue placeholder="선택 안함" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">선택 안함</SelectItem>
                    {sourceConfigs.map((config) => (
                      <SelectItem key={config.id} value={config.type_name}>
                        {config.type_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Source 1 */}
              {activeSourceConfig?.source_1_label && (
                <div className="min-w-[120px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeSourceConfig.source_1_label}
                  </label>
                  {activeSourceConfig.source_1_options && activeSourceConfig.source_1_options.length > 0 ? (
                    <Select value={selectedSource1} onValueChange={setSelectedSource1}>
                      <SelectTrigger className="h-9 bg-white border-indigo-200">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSourceConfig.source_1_options.map((option, idx) => (
                          <SelectItem key={idx} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={selectedSource1}
                      onChange={(e) => setSelectedSource1(e.target.value)}
                      className="h-9 bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 2 */}
              {activeSourceConfig?.source_2_label && (
                <div className="min-w-[120px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeSourceConfig.source_2_label}
                  </label>
                  {activeSourceConfig.source_2_options && activeSourceConfig.source_2_options.length > 0 ? (
                    <Select value={selectedSource2} onValueChange={setSelectedSource2}>
                      <SelectTrigger className="h-9 bg-white border-indigo-200">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSourceConfig.source_2_options.map((option, idx) => (
                          <SelectItem key={idx} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={selectedSource2}
                      onChange={(e) => setSelectedSource2(e.target.value)}
                      className="h-9 bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 3 */}
              {activeSourceConfig?.source_3_label && (
                <div className="min-w-[120px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeSourceConfig.source_3_label}
                  </label>
                  {activeSourceConfig.source_3_options && activeSourceConfig.source_3_options.length > 0 ? (
                    <Select value={selectedSource3} onValueChange={setSelectedSource3}>
                      <SelectTrigger className="h-9 bg-white border-indigo-200">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSourceConfig.source_3_options.map((option, idx) => (
                          <SelectItem key={idx} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={selectedSource3}
                      onChange={(e) => setSelectedSource3(e.target.value)}
                      className="h-9 bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 4 */}
              {activeSourceConfig?.source_4_label && (
                <div className="min-w-[120px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeSourceConfig.source_4_label}
                  </label>
                  {activeSourceConfig.source_4_options && activeSourceConfig.source_4_options.length > 0 ? (
                    <Select value={selectedSource4} onValueChange={setSelectedSource4}>
                      <SelectTrigger className="h-9 bg-white border-indigo-200">
                        <SelectValue placeholder="선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeSourceConfig.source_4_options.map((option, idx) => (
                          <SelectItem key={idx} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={selectedSource4}
                      onChange={(e) => setSelectedSource4(e.target.value)}
                      className="h-9 bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Helper Options (Only in Raw View) */}
        {!isAnalyzed && (
             <div className="flex items-center justify-end space-x-2">
                <Checkbox 
                id="remove-breaks" 
                checked={removeLineBreaks}
                onCheckedChange={(checked) => setRemoveLineBreaks(checked as boolean)}
                />
                <Label htmlFor="remove-breaks" className="cursor-pointer">줄바꿈 제거 미리보기</Label>
            </div>
        )}

        {passages.map((passage, index) => (
          <div key={passage.id} className="relative group animate-in slide-in-from-bottom-2 duration-500" style={{ animationDelay: `${index * 100}ms` }}>
            { !isAnalyzed ? (
                // --- Raw Text View ---
                <div className="relative">
                    <Label className="mb-2 block text-muted-foreground font-medium">지문 {index + 1}</Label>
                    <div className="relative">
                        <Textarea
                            value={processText(passage.content)}
                            onChange={(e) => handleTextChange(passage.id, 'content', e.target.value)}
                            className="min-h-[150px] resize-none pr-10 text-base leading-relaxed bg-muted/30"
                            placeholder="지문 내용을 입력하거나 OCR 결과를 수정하세요..."
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                            onClick={() => handleRemovePassage(passage.id)}
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                // --- Analyzed Card View ---
                <Card className="border-2 border-primary/10 overflow-hidden shadow-sm hover:shadow-md transition-all">
                    <CardHeader className="bg-muted/30 border-b pb-4">
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded-full">
                                    PASSAGE {index + 1}
                                </span>
                             </div>
                             <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground hover:text-red-500"
                                onClick={() => handleRemovePassage(passage.id)}
                            >
                                <X className="w-4 h-4 mr-1" /> 삭제
                            </Button>
                        </div>
                        <div className="mt-4 space-y-4">
                             {/* English Title */}
                             <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Type className="w-3 h-3" /> 영어 제목 (Title EN)
                                </Label>
                                <Input 
                                    value={passage.title_en}
                                    onChange={(e) => handleTextChange(passage.id, 'title_en', e.target.value)}
                                    placeholder="English Title"
                                    className="font-medium"
                                />
                             </div>
                             {/* Korean Title */}
                             <div className="grid gap-2">
                                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Languages className="w-3 h-3" /> 한글 제목 (Title KO)
                                </Label>
                                <Input 
                                    value={passage.title_ko}
                                    onChange={(e) => handleTextChange(passage.id, 'title_ko', e.target.value)}
                                    placeholder="한글 제목"
                                />
                             </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6 pt-6">
                         <div className="grid md:grid-cols-2 gap-6">
                            {/* Original Content */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="flex items-center gap-2 text-sm font-semibold">
                                       <Sparkles className="w-4 h-4 text-amber-500" /> 
                                       영어 지문 (Content)
                                  </Label>
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
                                    한줄로 보기
                                  </button>
                                </div>
                                <Textarea 
                                    value={processTextForDisplay(passage.content)}
                                    onChange={(e) => handleTextChange(passage.id, 'content', e.target.value)}
                                    className="min-h-[200px] leading-relaxed resize-none bg-amber-50/50 dark:bg-amber-900/10 border-amber-200/50 focus-visible:ring-amber-500"
                                />
                            </div>

                            {/* Korean Translation */}
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2 text-sm font-semibold">
                                     <Bot className="w-4 h-4 text-emerald-500" /> 
                                     한글 번역 (Translation)
                                </Label>
                                <Textarea 
                                    value={processTextForDisplay(passage.content_translation)}
                                    onChange={(e) => handleTextChange(passage.id, 'content_translation', e.target.value)}
                                    className="min-h-[200px] leading-relaxed resize-none bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200/50 focus-visible:ring-emerald-500"
                                    placeholder="AI가 생성한 번역이 여기에 표시됩니다."
                                />
                            </div>
                         </div>
                    </CardContent>
                </Card>
            )}
          </div>
        ))}

        {!isAnalyzed && (
            <Button variant="outline" onClick={handleAddPassage} className="w-full py-8 border-dashed gap-2 text-muted-foreground hover:text-primary">
                <Plus className="w-4 h-4" /> 지문 추가 (Add Empty)
            </Button>
        )}
      </div>

      {/* Footer Actions */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-background/80 backdrop-blur border-t z-20 flex justify-end">
        <div className="w-full max-w-7xl mx-auto flex justify-end gap-3">
             { !isAnalyzed ? (
                 <Button 
                    size="lg" 
                    onClick={handleAnalyze} 
                    disabled={isProcessing || passages.length === 0}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-none min-w-[200px]"
                 >
                    {isProcessing ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 
                            AI 분석 중... ({passages.length}개)
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-4 h-4 mr-2" /> 
                            AI 분석 및 메타데이터 생성
                        </>
                    )}
                 </Button>
             ) : (
                 <Button 
                    size="lg" 
                    onClick={handleSaveAll} 
                    disabled={isProcessing}
                    className="bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 shadow-lg min-w-[200px]"
                 >
                    {isProcessing ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> 
                            저장 중...
                        </>
                    ) : (
                        <>
                            <CheckCircle2 className="w-4 h-4 mr-2" /> 
                            최종 확인 및 저장
                        </>
                    )}
                 </Button>
             )}
        </div>
      </div>

      {/* Back Confirmation Dialog */}
      <AlertDialog open={showBackConfirm} onOpenChange={setShowBackConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>이전 단계로 돌아가기</AlertDialogTitle>
            <AlertDialogDescription>
               {isAnalyzed 
                 ? "분석된 메타데이터가 사라집니다. 다시 분석 단계로 돌아가시겠습니까?"
                 : "이미지 재확인하러 돌아가시겠습니까?"
               }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
                setShowBackConfirm(false);
                if (isAnalyzed) setIsAnalyzed(false); // Go back to raw edit
                else onBack(); // Go back to image
            }}>
                확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
