import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  ChevronRight, 
  Shuffle,
  Loader2
} from 'lucide-react';
import { DifficultyLevel } from '@/app/api/admin/settings/actions';

interface AIPassageGeneratorProps {
  onBack: () => void;
  onPassagesGenerated: (passages: GeneratedPassage[]) => void;
}

export function AIPassageGenerator({ onBack, onPassagesGenerated }: AIPassageGeneratorProps) {
  const [difficulty, setDifficulty] = useState<string>(''); // Holds ID
  const [difficultyList, setDifficultyList] = useState<DifficultyLevel[]>([]);
  const [count, setCount] = useState('1');
  const [availableCounts, setAvailableCounts] = useState<number[]>([1, 3, 5, 10]);
  const [isRandomKeyword, setIsRandomKeyword] = useState(false);
  const [mainCategory, setMainCategory] = useState<MainCategory | ''>('');
  const [subCategory, setSubCategory] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    async function fetchSettings() {
      const settings = await getSystemSettings();
      if (settings?.value) {
        if (settings.value.counts) {
          setAvailableCounts(settings.value.counts);
        }
        if (settings.value.difficultyLevels && settings.value.difficultyLevels.length > 0) {
          setDifficultyList(settings.value.difficultyLevels);
          setDifficulty(settings.value.difficultyLevels[0].id); // Default to first
        }
      }
    }
    fetchSettings();
  }, []);

  const handleMainCategoryChange = (value: string) => {
    setMainCategory(value as MainCategory);
    setSubCategory(''); // Reset sub on main change
  };

  const handleGenerate = async () => {
    if (!isRandomKeyword && !mainCategory) {
      toast.error('대분과를 선택하거나 랜덤 키워드를 사용해주세요.');
      return;
    }

    if (!difficulty) {
        toast.error('난이도를 선택해주세요.');
        return;
    }

    setIsGenerating(true);
    
    try {
      const result = await generatePassages({
        difficultyId: difficulty, // Send ID
        count: parseInt(count),
        mainCategory: mainCategory as string,
        subCategory,
        isRandom: isRandomKeyword
      });

      if (result.success && result.data) {
        toast.success(`${result.data.length}개의 지문이 생성되었습니다.`);
        onPassagesGenerated(result.data);
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
       toast.error(`오류 발생: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="relative animate-in slide-in-from-bottom-4 duration-300 w-full max-w-4xl mx-auto">


      <Card className="border shadow-lg p-0 overflow-hidden bg-card">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between bg-muted/20">
           <h2 className="text-xl font-bold flex items-center gap-2">
             시험범위에 지문 추가하기
           </h2>
           <Button variant="ghost" size="icon" onClick={onBack}>
             <span className="sr-only">Close</span>
             <ChevronRight className="w-5 h-5 opacity-0" /> {/* Spacer */}
           </Button>
        </div>

        <div className="p-8 space-y-10">
          {/* Difficulty */}
          <div className="space-y-4">
            <Label className="text-lg font-semibold">난이도</Label>
            <RadioGroup 
              value={difficulty} 
              onValueChange={setDifficulty}
              className="flex gap-6 flex-wrap"
            >
              {difficultyList.length > 0 ? (
                difficultyList.map((level) => (
                  <div key={level.id} className="flex items-center space-x-2">
                    <RadioGroupItem value={level.id} id={level.id} className="w-5 h-5" />
                    <Label htmlFor={level.id} className="text-base cursor-pointer">{level.name}</Label>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">로딩 중이거나 설정된 난이도가 없습니다.</div>
              )}
            </RadioGroup>
          </div>

          {/* Count */}
          <div className="space-y-4">
            <Label className="text-lg font-semibold">생성할 지문 개수</Label>
            <RadioGroup 
              value={count} 
              onValueChange={setCount}
              className="flex gap-6 flex-wrap"
            >
              {availableCounts.map((num) => (
                <div key={num} className="flex items-center space-x-2">
                  <RadioGroupItem value={num.toString()} id={`count-${num}`} className="w-5 h-5" />
                  <Label htmlFor={`count-${num}`} className="text-base cursor-pointer">{num}개</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Keyword Selection */}
          <div className="space-y-4 p-6 border rounded-xl bg-muted/10">
            <div className="flex items-center justify-between mb-2">
               <Label className="text-lg font-semibold">키워드 선택</Label>
               <div className="flex items-center space-x-2">
                 <Checkbox 
                   id="random-keyword" 
                   checked={isRandomKeyword}
                   onCheckedChange={(c) => setIsRandomKeyword(c as boolean)}
                   className="w-5 h-5"
                 />
                 <Label htmlFor="random-keyword" className="text-base cursor-pointer flex items-center gap-1">
                   <Shuffle className="w-4 h-4" />
                   랜덤 키워드 사용
                 </Label>
               </div>
            </div>

            <div className={cn("space-y-4 transition-opacity", isRandomKeyword && "opacity-50 pointer-events-none")}>
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">대분과</Label>
                <Select value={mainCategory} onValueChange={handleMainCategoryChange} disabled={isRandomKeyword}>
                  <SelectTrigger className="w-full bg-background h-12 text-base">
                    <SelectValue placeholder="대분과를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {MAIN_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">소분과</Label>
                <Select value={subCategory} onValueChange={setSubCategory} disabled={isRandomKeyword || !mainCategory}>
                  <SelectTrigger className="w-full bg-background h-12 text-base">
                    <SelectValue placeholder={mainCategory ? "소분과를 선택하세요" : "대분과를 먼저 선택하세요"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {mainCategory && SUB_CATEGORIES[mainCategory]?.map((sub) => (
                      <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isRandomKeyword && !mainCategory && (
                    <p className="text-xs text-muted-foreground mt-1 px-1">
                        대분과를 먼저 선택하면 관련 소분과 목록이 표시됩니다.
                    </p>
                )}
                {!isRandomKeyword && mainCategory && (
                    <p className="text-xs text-muted-foreground mt-1 px-1">
                        소분과를 선택하거나 직접 입력할 수 있습니다. (현재 선택 전용)
                    </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t bg-muted/20 flex justify-end">
          <Button 
            size="lg" 
            className="bg-gray-400 hover:bg-gray-500 text-white min-w-[150px] text-lg font-normal"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="animate-spin w-5 h-5" />
                생성 중...
              </span>
            ) : (
               <div className="flex items-center gap-2">
                   <div className="border border-white/50 rounded p-0.5">
                       <Sparkles className="w-4 h-4" />
                   </div>
                   문제 내기
               </div>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
