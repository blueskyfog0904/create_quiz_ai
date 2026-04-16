'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { 
  X, 
  Check, 
  ChevronLeft, 
  ChevronRight, 
  Loader2,
  ZoomIn,
  ZoomOut,
  MousePointer2,
  Highlighter,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { extractTextFromFile } from '@/app/api/ocr/actions';
import {
  buildOrderedCropRects,
  type SelectionRect,
} from '@/lib/ocr/selection-crop';

// Setup PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface OCRPreviewStageProps {
  file: File;
  onBack: () => void;
  onExtractionComplete: (passages: string[]) => void;
}

type Selection = SelectionRect

type Tool = 'box' | 'highlighter';

export function OCRPreviewStage({ file, onBack, onExtractionComplete }: OCRPreviewStageProps) {
  const [fileType] = useState<'image' | 'pdf'>(file.type.includes('pdf') ? 'pdf' : 'image');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);
  
  const [tool, setTool] = useState<Tool>('box');
  const [selections, setSelections] = useState<Selection[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentSelection, setCurrentSelection] = useState<Selection | null>(null);
  
  // Highlighter State
  const [currentStroke, setCurrentStroke] = useState<{x: number, y: number}[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingLabel, setProcessingLabel] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (fileType === 'image') {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, fileType]);

  // Handle PDF Load Success
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  // Convert mouse event to relative coordinates
  // Adjusted for scale
  const getRelativeCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    };
  }, [scale]);

  const drawHighlight = (points: {x: number, y: number}[]) => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // We can clear continuously or just add to it. 
    // Since we want to show the current stroke being drawn, clearing and redrawing is safer to avoid artifacts if we were handling history, 
    // but here we just append. But to be clean:
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    // Smooth curve
    for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.4)'; // Yellow transparent
    ctx.lineWidth = 20; // Thick highlighter
    ctx.stroke();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.selection-remove-btn')) return;

    setIsDrawing(true);
    const coords = getRelativeCoords(e);
    setStartPos(coords);

    if (tool === 'box') {
        setCurrentSelection({
            id: 'current',
            x: coords.x,
            y: coords.y,
            width: 0,
            height: 0
        });
    } else {
        // Highlighter start
        setCurrentStroke([coords]);
        // Resize canvas to match container content size if not already set specifically
        // But container size changes with scale. 
        // We really want the canvas to match the 'unscaled' content coordinate space, 
        // but visually it is scaled via CSS transform on the container.
        // Wait, the canvas is INSIDE the scaled container. So its width/height should be the natural content size.
        // For Image: naturalWidth/Height. For PDF: 800 (as set in Page prop) x AspectRatio.
        
        // Simpler approach: Just ensure canvas internal resolution matches the offsetWidth/Height of the container content.
        // Since the container is scaled by CSS transform, checking its offsetWidth gives the unscaled size?
        // Let's check.
        if (containerRef.current && canvasRef.current) {
            // Because of transform: scale, getBoundingClientRect returns scaled size.
            // offsetWidth returns unscaled size if transform is on parent? No, on element itself.
            // Actually, best to rely on the source content size.
            
            let w = 0, h = 0;
            if (fileType === 'pdf') {
                // We set width={800} on Page
                w = 800; // Approximate or exact based on Page render
                // We can try to grab it from the DOM
                 const pdfCanvas = containerRef.current.querySelector('.react-pdf__Page__canvas');
                 if(pdfCanvas) {
                    w = pdfCanvas.clientWidth;
                    h = pdfCanvas.clientHeight;
                 }
            } else if (imageRef.current) {
                w = imageRef.current.naturalWidth; // Or offsetWidth if styled
                // If we use standard <img>, offsetWidth might be constrained by max-width.
                // But in our css: max-w-none. So offsetWidth should be image width.
                 w = imageRef.current.offsetWidth;
                 h = imageRef.current.offsetHeight;
            }

            // Sync canvas size if zero
            if (canvasRef.current.width === 0 && w > 0) {
                 canvasRef.current.width = w;
                 canvasRef.current.height = h;
            }
        }
    }
  };

  // State Refs for Event Handlers (to avoid stale closures in window listeners)
  const isDrawingRef = useRef(isDrawing);
  const toolRef = useRef(tool);
  const startPosRef = useRef(startPos);
  const currentSelectionRef = useRef(currentSelection);
  const currentStrokeRef = useRef(currentStroke);
  
  // Sync Refs with State
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { startPosRef.current = startPos; }, [startPos]);
  useEffect(() => { currentSelectionRef.current = currentSelection; }, [currentSelection]);
  useEffect(() => { currentStrokeRef.current = currentStroke; }, [currentStroke]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    // Use Refs to get fresh state without re-binding listeners
    if (!isDrawingRef.current || !containerRef.current) return;
    const coords = getRelativeCoords(e);
    
    // Clamp coordinates
    const rect = containerRef.current.getBoundingClientRect();
    const contentWidth = rect.width / scale;
    const contentHeight = rect.height / scale;

    const clampedX = Math.max(0, Math.min(coords.x, contentWidth));
    const clampedY = Math.max(0, Math.min(coords.y, contentHeight));

    if (toolRef.current === 'box') {
        const start = startPosRef.current;
        const width = clampedX - start.x;
        const height = clampedY - start.y;

        const newSelection = {
            id: 'current',
            x: width > 0 ? start.x : clampedX,
            y: height > 0 ? start.y : clampedY,
            width: Math.abs(width),
            height: Math.abs(height)
        };
        
        setCurrentSelection(newSelection);
        // Sync ref immediately for next move event within same frame (optional but safe)
        currentSelectionRef.current = newSelection;

    } else {
        // Highlighter move
        const prevStroke = currentStrokeRef.current;
        const newStroke = [...prevStroke, { x: clampedX, y: clampedY }];
        
        setCurrentStroke(newStroke);
        currentStrokeRef.current = newStroke; // Sync ref
        
        drawHighlight(newStroke);
    }
  }, [getRelativeCoords, scale]);

  const handleMouseUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    setIsDrawing(false);
    isDrawingRef.current = false; // Immediate sync

    if (toolRef.current === 'box') {
        const cur = currentSelectionRef.current;
        if (cur && cur.width > 5 && cur.height > 5) {
            setSelections(prev => [...prev, { ...cur, id: crypto.randomUUID() }]);
        }
        setCurrentSelection(null);
        currentSelectionRef.current = null;
    } else {
        // Highlighter end
        const stroke = currentStrokeRef.current;
        if (stroke.length > 2) {
            // Calculate bounding box
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            stroke.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
            
            // Add padding
            minX = Math.max(0, minX - 10);
            minY = Math.max(0, minY - 10);
            maxX = maxX + 10;
            maxY = maxY + 10;

            const width = maxX - minX;
            const height = maxY - minY;

            if (width > 10 && height > 10) {
                 setSelections(prev => [...prev, {
                     id: crypto.randomUUID(),
                     x: minX,
                     y: minY,
                     width,
                     height
                 }]);
            }
        }
        setCurrentStroke([]);
        currentStrokeRef.current = [];
        
        // Clear canvas
        const canvas = canvasRef.current;
        if(canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
    }
  }, []);

  // Global event listeners for drawing outside bounds
  useEffect(() => {
    if (!isDrawing) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleMouseMove(e);
    };

    const handleWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, isDrawing]);

  const removeSelection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelections(selections.filter(s => s.id !== id));
  };
 
  // ... cropSelection and handleExtraction remain mostly same ...
  // [Lines 150-221 are skipped here - assume they are kept or we need to ensure they exist if replacing whole file]
  // Wait, I am replacing the whole file content block by block, or just the top part? 
  // The 'Instruction' says "OCRPreviewStage 컴포넌트를 대폭 수정합니다.", so I should replace effectively the whole render part or careful chunk.
  // Given the complexity of adding canvas + tool state + imports, replacing the file (or large chunk) is safer.
  // I will include the cropSelection/handleExtraction logic below.

  const resolveSourceElement = (): HTMLCanvasElement | HTMLImageElement | null => {
    if (!containerRef.current) return null

    if (fileType === 'pdf') {
      return containerRef.current.querySelector('.react-pdf__Page__canvas') as HTMLCanvasElement | null
    }

    return imageRef.current
  }

  const getIntrinsicSize = (sourceElement: HTMLCanvasElement | HTMLImageElement) => {
    if (sourceElement instanceof HTMLCanvasElement) {
      return {
        width: sourceElement.width,
        height: sourceElement.height,
      }
    }

    return {
      width: sourceElement.naturalWidth,
      height: sourceElement.naturalHeight,
    }
  }

  const buildWholeImageBlob = async (): Promise<Blob | null> => {
    const sourceElement = resolveSourceElement()
    if (!sourceElement) return null

    const intrinsicSize = getIntrinsicSize(sourceElement)
    const canvas = document.createElement('canvas')
    canvas.width = intrinsicSize.width
    canvas.height = intrinsicSize.height
    const ctx = canvas.getContext('2d')

    if (!ctx) return null

    ctx.drawImage(sourceElement, 0, 0, intrinsicSize.width, intrinsicSize.height)

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95)
    })
  }

  const buildSelectionCropBlobs = async (padding = 12): Promise<Blob[]> => {
    const sourceElement = resolveSourceElement()
    if (!sourceElement) {
      throw new Error('선택 영역의 원본 이미지를 찾을 수 없습니다.')
    }

    const intrinsicSize = getIntrinsicSize(sourceElement)
    const visualSize = {
      width: sourceElement.clientWidth,
      height: sourceElement.clientHeight,
    }

    const cropRects = buildOrderedCropRects(selections, visualSize, intrinsicSize, padding)
    const blobs = await Promise.all(cropRects.map(async (rect) => {
      const canvas = document.createElement('canvas')
      canvas.width = rect.width
      canvas.height = rect.height
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('선택 영역 crop canvas를 만들 수 없습니다.')
      }

      ctx.drawImage(
        sourceElement,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height
      )

      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('선택 영역 crop 이미지 생성에 실패했습니다.'))
            return
          }

          resolve(blob)
        }, 'image/jpeg', 0.95)
      })
    }))

    if (blobs.length !== selections.length) {
      throw new Error('선택 영역 crop 생성 수가 일치하지 않습니다.')
    }

    return blobs
  }

  const handleExtraction = async (mode: 'visual' | 'auto') => {
    // Validation for visual mode
    if (mode === 'visual' && selections.length === 0) {
      toast.error('추출할 영역을 선택해주세요.');
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(10);
    setProcessingLabel(mode === 'auto' ? '전체 문서를 추출할 준비를 하고 있습니다...' : '선택한 영역을 추출할 준비를 하고 있습니다...');
    
    try {
      const formData = new FormData();
      let validFiles: Blob[] = []

      if (mode === 'visual') {
        validFiles = await buildSelectionCropBlobs()
      } else if (fileType === 'pdf') {
        validFiles = [file]
      } else {
        const wholeImageBlob = await buildWholeImageBlob()
        validFiles = wholeImageBlob ? [wholeImageBlob] : []
      }

      if (validFiles.length === 0) {
        toast.error('이미지 처리에 실패했습니다.');
        setIsProcessing(false);
        return;
      }

      setProcessingProgress(40);
      setProcessingLabel(mode === 'auto' ? 'OCR 요청 파일을 준비하고 있습니다...' : '선택 영역 OCR 이미지를 준비하고 있습니다...');

      validFiles.forEach((blob, index) => {
        const fileName = mode === 'visual'
          ? `selection-${index + 1}.jpg`
          : fileType === 'pdf'
            ? file.name
            : 'source_image.jpg'

        formData.append('files', blob, fileName)
      })
      formData.append('mode', mode); // Add mode parameter

      // 3. Send Request
      setProcessingProgress(60); 
      setProcessingLabel(mode === 'auto' ? 'AI가 전체 문서의 지문을 분석하고 있습니다...' : 'AI가 선택 영역의 지문을 분석하고 있습니다...');
      const message = mode === 'auto' ? '전체 이미지를 분석 중입니다...' : '선택된 영역을 분석 중입니다...';
      toast.info(message);
      
      const result = await extractTextFromFile(formData);
      setProcessingProgress(90);
      setProcessingLabel('추출 결과를 정리하고 있습니다...');

      if (result.success && result.data && result.data.passages) {
        toast.success(`${result.data.passages.length}개의 지문이 추출되었습니다.`);
        onExtractionComplete(result.data.passages);
      } else {
        console.error('OCR Batch Failed:', result);
        toast.error(result.error || '텍스트 추출에 실패했습니다.');
      }

    } catch (error: unknown) {
      console.error('Extraction flow error:', error);
      const message = error instanceof Error ? error.message : '선택 영역 추출 중 오류가 발생했습니다.';
      toast.error(`오류 발생: ${message}`);
    } finally {
      setIsProcessing(false);
      setProcessingProgress(0);
      setProcessingLabel('');
    }
  };

  // ... (render) ...



  return (
    <div className="relative flex flex-col h-[80vh] bg-card rounded-lg overflow-hidden border">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <div className="flex items-center gap-4">
           <Button variant="ghost" size="icon" onClick={onBack}>
             <ChevronLeft className="w-5 h-5" />
           </Button>
           
           <div className="flex items-center border rounded-lg bg-background p-1">
             <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as Tool)}>
                <ToggleGroupItem value="box" className="gap-2" aria-label="Box Selection">
                   <MousePointer2 className="w-4 h-4" />
                   <span className="text-xs font-medium">박스 선택</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="highlighter" className="gap-2" aria-label="Highlighter">
                   <Highlighter className="w-4 h-4" />
                   <span className="text-xs font-medium">영역 그리기</span>
                </ToggleGroupItem>
             </ToggleGroup>
           </div>
           
           <div className="h-6 w-px bg-border mx-2" />
           
           <p className="text-xs text-muted-foreground hidden md:block">
             {tool === 'box' ? '마우스로 드래그하여 박스를 그리세요.' : '텍스트 위를 형광펜으로 칠하듯 그리세요.'}
           </p>
        </div>

        <div className="flex items-center gap-2">
           <div className="flex items-center bg-background border rounded-md px-2 py-1 mr-4">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScale(s => Math.max(0.5, s - 0.1))}>
                <ZoomOut className="w-3 h-3" />
              </Button>
              <span className="text-xs font-mono w-12 text-center">{Math.round(scale * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScale(s => Math.min(3, s + 0.1))}>
                <ZoomIn className="w-3 h-3" />
              </Button>
           </div>
           
           <Button 
             variant="outline"
             onClick={() => handleExtraction('auto')}
             disabled={isProcessing}
             className="gap-2 border-primary/20 hover:bg-primary/5 text-primary"
           >
             <Sparkles className="w-4 h-4" />
             전체 영역 자동 추출
           </Button>

           <Button 
             onClick={() => handleExtraction('visual')} 
             disabled={selections.length === 0 || isProcessing}
             className="min-w-[140px]"
           >
             {isProcessing ? (
               <span className="flex items-center gap-2">
                 <Loader2 className="animate-spin w-4 h-4" />
                 {processingProgress}%
               </span>
             ) : (
               <span className="flex items-center gap-2">
                 <Check className="w-4 h-4" />
                 선택 영역 추출 ({selections.length})
               </span>
             )}
           </Button>
        </div>
      </div>

      {/* Main Content (Scrollable) */}
      <div className="flex-1 overflow-auto bg-gray-100/50 dark:bg-gray-900/50 p-8 relative flex justify-center">
        
        {/* Render Stage Container */}
        <div 
           ref={containerRef}
           className={cn(
             "relative shadow-xl bg-white select-none box-content",
             tool === 'box' ? "cursor-crosshair" : "cursor-text" // Highlight cursor suggestion
           )}
           style={{ 
             width: 'fit-content', 
             height: 'fit-content',
             transform: `scale(${scale})`,
             transformOrigin: 'top center',
             transition: 'transform 0.1s ease-out'
           }}
           onMouseDown={handleMouseDown}

           // Prevent default drag behavior
           onDragStart={(e) => e.preventDefault()}
        >
           {/* File Content */}
           {fileType === 'pdf' ? (
             <Document
               file={file}
               onLoadSuccess={onDocumentLoadSuccess}
               loading={<div className="flex items-center justify-center w-[600px] h-[800px] text-muted-foreground">PDF 로딩 중...</div>}
               error={<div className="text-red-500 p-8">PDF를 불러올 수 없습니다.</div>}
             >
               <Page 
                 pageNumber={pageNumber} 
                 renderTextLayer={false} 
                 renderAnnotationLayer={false}
                 width={800} 
                 className="shadow-sm"
                 inputRef={pdfPageRef}
               />
             </Document>
           ) : (
             <img 
               ref={imageRef}
               src={imageUrl!} 
               alt="Preview" 
               className="max-w-none block" 
               draggable={false}
             />
           )}
           
           {/* Highlighter Canvas Layer */}
           <canvas
             ref={canvasRef}
             className="absolute inset-0 pointer-events-none z-10"
             // Size will be set by JS based on content size
           />

           {/* Selections Overlay */}
           {selections.map((sel) => (
             <div
               key={sel.id}
               className="absolute border-2 border-primary bg-primary/10 group z-20"
               style={{
                 left: sel.x,
                 top: sel.y,
                 width: sel.width,
                 height: sel.height,
               }}
             >
               <div className="absolute -top-3 -right-3 hidden group-hover:flex">
                 <Button 
                   variant="destructive" 
                   size="icon" 
                   className="h-6 w-6 rounded-full shadow-md selection-remove-btn"
                   onClick={(e) => removeSelection(sel.id, e)}
                 >
                   <X className="w-3 h-3" />
                 </Button>
               </div>
               <div className="absolute top-1 left-1 bg-primary text-primary-foreground text-[10px] px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                 {Math.round(sel.width)} x {Math.round(sel.height)}
               </div>
             </div>
           ))}

           {/* Current Drawing Selection (Box) */}
           {isDrawing && tool === 'box' && currentSelection && (
             <div
               className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none z-20"
               style={{
                 left: currentSelection.x,
                 top: currentSelection.y,
                 width: currentSelection.width,
                 height: currentSelection.height,
               }}
             />
           )}
        </div>
      </div>

      {/* Footer Controls */}
      {fileType === 'pdf' && numPages > 1 && (
        <div className="p-4 border-t bg-muted/30 flex justify-center items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
                setSelections([]);
                setPageNumber(p => Math.max(1, p - 1));
            }}
            disabled={pageNumber <= 1}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> 이전 페이지
          </Button>
          <span className="text-sm font-medium">
            Page {pageNumber} of {numPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
                setSelections([]);
                setPageNumber(p => Math.min(numPages, p + 1));
            }}
            disabled={pageNumber >= numPages}
          >
            다음 페이지 <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {isProcessing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border bg-white/95 p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
              <div>
                <p className="text-base font-semibold text-gray-900">OCR 추출 진행 중</p>
                <p className="text-sm text-muted-foreground">잠시만 기다려주세요. 창을 닫거나 새로고침하지 마세요.</p>
              </div>
            </div>

            <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${processingProgress}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{processingLabel || 'AI가 지문을 추출하고 있습니다...'}</span>
              <span className="font-medium text-primary">{processingProgress}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
