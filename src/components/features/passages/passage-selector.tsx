'use client';

import React, { useState, useRef, useCallback } from 'react';
import { AIPassageGenerator } from './ai-generator';
import { 
  PenTool, 
  UploadCloud, 
  Camera, 
  X,
  ChevronRight,
  Sparkles,
  Loader2,
  Plus
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { enrichPassage, type PassageAnalysis } from '@/app/api/passages/actions';
import { OCRResultView } from './ocr-result-view';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { type WorkspaceSubject } from '@/lib/workspace-subject';
import { resolvePassageWorkspaceSubject } from './workspace-subject';

const OCRPreviewStage = dynamic(
  () => import('./ocr-preview-stage').then((mod) => mod.OCRPreviewStage),
  { 
    ssr: false,
    loading: () => <div className="flex h-[80vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  }
);

type Mode = 'direct' | 'direct-result' | 'upload' | 'library' | 'ai' | 'ocr-result' | 'ocr-preview' | null;

interface PassageSelectorProps {
  workspaceSubject?: WorkspaceSubject;
}

export function PassageSelector({ workspaceSubject }: PassageSelectorProps) {
  const pathname = usePathname();
  const activeWorkspaceSubject = resolvePassageWorkspaceSubject(pathname, workspaceSubject);
  const [mode, setMode] = useState<Mode>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast.error('이미지 또는 PDF 파일만 지원합니다.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('파일 크기는 10MB를 초과할 수 없습니다.');
      return;
    }

    setSelectedFile(file);
    setMode('ocr-preview');
  }, []);

  // OCR & File State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ocrPassages, setOcrPassages] = useState<string[]>([]);

  // Direct input multi-passage state
  interface DirectPassage {
    id: string;
    content: string;
  }
  const [directPassages, setDirectPassages] = useState<DirectPassage[]>([{ id: crypto.randomUUID(), content: '' }]);

  const handleDirectPassageChange = (id: string, value: string) => {
    setDirectPassages(prev => prev.map(p => p.id === id ? { ...p, content: value } : p));
  };

  const handleRemoveDirectPassage = (id: string) => {
    setDirectPassages(prev => prev.filter(p => p.id !== id));
  };

  const handleAddDirectPassage = () => {
    setDirectPassages(prev => [...prev, { id: crypto.randomUUID(), content: '' }]);
  };

  // Analysis State
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [showProgressModal, setShowProgressModal] = useState(false);
  const isCancelledRef = useRef(false);

  const handleCancelAnalysis = useCallback(() => {
    if (confirm('분석을 중단하시겠습니까?')) {
        isCancelledRef.current = true;
        setShowProgressModal(false);
        setIsSubmitting(false);
        toast.info('분석이 취소되었습니다.');
    }
  }, []);

  const handleDirectAnalyze = async () => {
    const validPassages = directPassages.filter(p => p.content.trim());
    if (validPassages.length === 0) {
      toast.error('분석할 지문이 없습니다.');
      return;
    }

    setIsSubmitting(true);
    setShowProgressModal(true);
    setAnalysisProgress({ current: 0, total: validPassages.length });
    isCancelledRef.current = false;

    try {
      const results: PassageAnalysis[] = [];

      // Process sequentially
      for (let i = 0; i < validPassages.length; i++) {
        if (isCancelledRef.current) break;

        try {
          // Process single passage
          const result = await enrichPassage(validPassages[i].content);
          
          // Adjust result to match the original index structure expected by logic
          // Note: enrichPassage returns index 0 since it's a single batch. 
          // We map it to the index in the validPassages array or directPassages array.
          // Since OCRResultView mapping looks for original_index, let's use the index from validPassages for simplicity
          // or ideally mapping back to directPassages ID if OCRResultView supported ID mapping.
          // OCRResultView maps by index. Let's use 'i' as original_index for the ResultView context.
          
          results.push({
            ...result,
            original_index: i // Override index
          });
        } catch (error) {
           console.error(`Passage ${i + 1} analysis failed`, error);
        }

        setAnalysisProgress(prev => ({ ...prev, current: i + 1 }));
      }
      
      if (!isCancelledRef.current) {
          // Store analyzed results and switch to result view
          setAnalyzedPassages(results);
          setMode('direct-result');
          toast.success('AI 분석이 완료되었습니다.');
      }
    } catch (error) {
      console.error(error);
      toast.error('AI 분석 중 오류가 발생했습니다.');
    } finally {
      if (!isCancelledRef.current) {
        setIsSubmitting(false);
        setShowProgressModal(false);
      }
    }
  };

  // State for analyzed passages from direct input
  const [analyzedPassages, setAnalyzedPassages] = useState<PassageAnalysis[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      toast.error('파일 크기는 10MB 이하여야 합니다.');
      return;
    }

    setSelectedFile(file);
    setMode('ocr-preview');
    
    // Reset input to allow re-selecting same file if needed in future, 
    // but here we move to preview stage so it's fine.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-6 space-y-8 animate-in fade-in duration-500 relative">
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

      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-500 dark:from-white dark:to-gray-400">
          지문 관리 및 추가
        </h1>
        <p className="text-muted-foreground">
          새로운 영어 지문을 생성하거나 기존 라이브러리에서 선택하세요.
        </p>
      </div>

      {mode === null ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Option 1: Direct Input */}
          <SelectionCard
            icon={<PenTool className="w-8 h-8" />}
            title="직접 입력"
            description="텍스트를 직접 입력하거나 붙여넣어 지문을 생성합니다."
            onClick={() => setMode('direct')}
            gradient="from-blue-500/10 to-indigo-500/10"
            borderColor="hover:border-blue-500/50"
          />

          {/* Option 2: Upload / OCR */}
          <SelectionCard
            icon={<Camera className="w-8 h-8" />}
            title="스캔 및 업로드"
            description="PDF나 사진을 업로드하여 OCR로 텍스트를 추출합니다."
            onClick={() => setMode('upload')}
            gradient="from-emerald-500/10 to-teal-500/10"
            borderColor="hover:border-emerald-500/50"
          />


        </div>
      ) : (
        <div className="relative animate-in slide-in-from-bottom-4 duration-300">
          <Button 
            variant="ghost" 
            className="mb-4 pl-0 hover:pl-2 transition-all gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => setMode(null)}
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            메인 메뉴로 돌아가기
          </Button>

          <Card className="border shadow-lg bg-card/50 backdrop-blur-sm overflow-hidden min-h-[600px]">
             {/* Dynamic Content Area */}
             <div className="p-0 h-full">
               {mode === 'direct' && (
                 <div className="p-6 space-y-6">
                   <div className="flex items-center gap-2 mb-6">
                     <span className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                       <PenTool className="w-5 h-5" />
                     </span>
                     <h2 className="text-xl font-semibold">지문 직접 입력</h2>
                   </div>

                   {/* Multi-passage input similar to OCR result view */}
                   <div className="space-y-6">
                     {directPassages.map((passage, index) => (
                       <div key={passage.id} className="relative">
                         <Label className="mb-2 block text-muted-foreground font-medium">지문 {index + 1}</Label>
                         <div className="relative">
                           <Textarea
                             value={passage.content}
                             onChange={(e) => handleDirectPassageChange(passage.id, e.target.value)}
                             className="min-h-[150px] resize-none pr-10 text-base leading-relaxed bg-muted/30"
                             placeholder="영어 지문을 입력하거나 붙여넣으세요..."
                           />
                           {directPassages.length > 1 && (
                             <Button
                               variant="ghost"
                               size="icon"
                               className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 hover:bg-red-50"
                               onClick={() => handleRemoveDirectPassage(passage.id)}
                             >
                               <X className="w-4 h-4" />
                             </Button>
                           )}
                         </div>
                       </div>
                     ))}

                     <Button 
                       variant="outline" 
                       onClick={handleAddDirectPassage} 
                       className="w-full py-8 border-dashed gap-2 text-muted-foreground hover:text-primary"
                     >
                       <Plus className="w-4 h-4" /> 지문 추가 (Add Empty)
                     </Button>
                   </div>

                   {/* Action Button */}
                   <div className="flex justify-end pt-4 border-t">
                     <Button 
                       size="lg"
                       onClick={handleDirectAnalyze}
                       disabled={isSubmitting || directPassages.every(p => !p.content.trim())}
                       className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200 dark:shadow-none min-w-[200px]"
                     >
                       {isSubmitting ? (
                         <>
                           <Loader2 className="w-4 h-4 animate-spin mr-2" />
                           처리 중...
                         </>
                       ) : (
                         <>
                           <Sparkles className="w-4 h-4 mr-2" />
                           AI 분석 및 메타데이터 생성
                         </>
                       )}
                     </Button>
                   </div>
                 </div>
               )}

               {mode === 'direct-result' && (
                 <div className="p-6">
                   <OCRResultView 
                     initialPassages={directPassages.map(p => p.content).filter(c => c.trim())}
                     preAnalyzedData={analyzedPassages}
                     workspaceSubject={activeWorkspaceSubject}
                     onBack={() => setMode('direct')}
                     onClose={() => setMode(null)}
                     onComplete={() => {
                       setMode(null);
                       setDirectPassages([{ id: crypto.randomUUID(), content: '' }]);
                       setAnalyzedPassages([]);
                       window.location.reload();
                     }}
                   />
                 </div>
               )}



               {mode === 'upload' && (
                 <div 
                    className={cn(
                      "p-12 flex flex-col items-center justify-center min-h-[600px] text-center space-y-8 animate-in fade-in transition-colors border-2 border-transparent rounded-3xl",
                      isDragging && "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10 border-dashed"
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                 >
                    <div className={cn(
                      "w-24 h-24 rounded-full flex items-center justify-center mb-4 ring-8 transition-all duration-300",
                      isDragging 
                        ? "bg-emerald-200 ring-emerald-100 scale-110" 
                        : "bg-emerald-100 dark:bg-emerald-900/30 ring-emerald-50 dark:ring-emerald-900/10"
                    )}>
                      {isUploading ? (
                        <Loader2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400 animate-spin" />
                      ) : (
                        <UploadCloud className={cn(
                          "w-12 h-12 text-emerald-600 dark:text-emerald-400 transition-transform duration-300",
                          isDragging && "scale-110 -translate-y-1"
                        )} />
                      )}
                    </div>
                    
                    <div className="space-y-4 max-w-md mx-auto pointer-events-none">
                      <h2 className="text-2xl font-bold">
                        {isDragging ? "파일을 여기에 놓으세요" : "이미지 또는 PDF 업로드"}
                      </h2>
                      <p className="text-muted-foreground leading-relaxed">
                        파일을 업로드하면 내용을 미리보고<br/>
                        원하는 영역만 선택하여 텍스트를 추출할 수 있습니다.
                      </p>
                    </div>

                    <div className="flex flex-col gap-4 w-full max-w-sm">
                      <input 
                        type="file" 
                        accept="image/*,application/pdf"
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                      />
                      <Button 
                        size="lg" 
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition-all"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                         파일 선택하기
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        또는 파일을 여기에 끌어다 놓으세요 (최대 10MB)
                      </p>
                    </div>
                 </div>
               )}

               {mode === 'ocr-preview' && selectedFile && (
                 <div className="h-full">
                    <OCRPreviewStage
                      file={selectedFile}
                      onBack={() => {
                        setSelectedFile(null);
                        setMode('upload');
                      }}
                      onExtractionComplete={(passages) => {
                        setOcrPassages(passages);
                        setMode('ocr-result');
                      }}
                    />
                 </div>
               )}

               {mode === 'ocr-result' && (
                 <div className="p-6">
                   <OCRResultView 
                      initialPassages={ocrPassages}
                      workspaceSubject={activeWorkspaceSubject}
                      onBack={() => setMode('ocr-preview')}
                      onClose={() => setMode(null)}
                      onComplete={() => {
                        setMode(null);
                        setOcrPassages([]);
                        window.location.reload(); // Quick refresh to show new files in list
                      }}
                   />
                 </div>
               )}

               {mode === 'ai' && (
                 <AIPassageGenerator 
                   onBack={() => setMode(null)} 
                   onPassagesGenerated={() => {}} 
                 />
               )}
             </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function SelectionCard({ 
  icon, 
  title, 
  description, 
  onClick,
  gradient,
  borderColor
}: { 
  icon: React.ReactNode, 
  title: string, 
  description: string, 
  onClick: () => void,
  gradient: string,
  borderColor: string
}) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card p-6 transition-all duration-300 hover:shadow-lg cursor-pointer flex flex-col h-full min-h-[200px]",
        borderColor
      )}
    >
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br",
        gradient
      )} />
      
      <div className="relative z-10 flex flex-col h-full">
        <div className="mb-6 p-4 w-fit rounded-xl bg-muted group-hover:bg-background/80 transition-colors shadow-sm">
          {icon}
        </div>
        <h3 className="text-xl font-bold mb-3">{title}</h3>
        <p className="text-sm text-muted-foreground group-hover:text-foreground/90 transition-colors leading-relaxed">
          {description}
        </p>
        
        <div className="mt-auto pt-8 flex items-center font-medium text-muted-foreground group-hover:text-primary transition-colors">
          시작하기 <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </div>
  );
}
