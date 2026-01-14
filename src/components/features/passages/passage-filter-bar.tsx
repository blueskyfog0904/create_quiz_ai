'use client';

import * as React from 'react';
import { Search, Bookmark, CalendarIcon, LayoutList, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { TagInput } from './tag-input';

interface PassageFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  isBookmarked: boolean;
  onBookmarkChange: (checked: boolean) => void;
  dateRange: { from?: Date; to?: Date };
  onDateRangeChange: (range: { from?: Date; to?: Date } | undefined) => void;
  viewMode: 'list' | 'timeline';
  onViewModeChange: (mode: 'list' | 'timeline') => void;
  // Source filters
  sourceType: string;
  onSourceTypeChange: (value: string) => void;
  source1: string;
  onSource1Change: (value: string) => void;
  source2: string;
  onSource2Change: (value: string) => void;
  source3: string;
  onSource3Change: (value: string) => void;
  source4: string;
  onSource4Change: (value: string) => void;
  sourceConfigs: Array<{
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
  }>;
}

export function PassageFilterBar({
  search,
  onSearchChange,
  tags,
  onTagsChange,
  isBookmarked,
  onBookmarkChange,
  dateRange,
  onDateRangeChange,
  viewMode,
  onViewModeChange,
  sourceType,
  onSourceTypeChange,
  source1,
  onSource1Change,
  source2,
  onSource2Change,
  source3,
  onSource3Change,
  source4,
  onSource4Change,
  sourceConfigs,
}: PassageFilterBarProps) {
  const [fromOpen, setFromOpen] = React.useState(false);
  const [toOpen, setToOpen] = React.useState(false);
  
  /* Single masked input state for dates (YYYY.MM.DD format) */
  const [fromInput, setFromInput] = React.useState("");
  const [toInput, setToInput] = React.useState("");

  const fromInputRef = React.useRef<HTMLInputElement>(null);
  const toInputRef = React.useRef<HTMLInputElement>(null);

  // Sync entries from props when they change externally (e.g. from calendar selection)
  React.useEffect(() => {
    if (dateRange?.from) {
      setFromInput(format(dateRange.from, "yyyy.MM.dd"));
    } else {
      setFromInput("");
    }
  }, [dateRange?.from]);

  React.useEffect(() => {
    if (dateRange?.to) {
      setToInput(format(dateRange.to, "yyyy.MM.dd"));
    } else {
      setToInput("");
    }
  }, [dateRange?.to]);

  // Format input with dots and handle cursor position
  const formatDateInput = (value: string): string => {
    const digits = value.replace(/[^0-9]/g, "");
    let formatted = "";
    for (let i = 0; i < digits.length && i < 8; i++) {
      if (i === 4 || i === 6) formatted += ".";
      formatted += digits[i];
    }
    return formatted;
  };

  // Parse formatted input to Date
  const parseDate = (formatted: string): Date | undefined => {
    const digits = formatted.replace(/[^0-9]/g, "");
    if (digits.length === 8) {
      const y = parseInt(digits.substring(0, 4));
      const m = parseInt(digits.substring(4, 6)) - 1;
      const d = parseInt(digits.substring(6, 8));
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime()) && date.getFullYear() === y && date.getMonth() === m && date.getDate() === d) {
        return date;
      }
    }
    return undefined;
  };

  const handleDateInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'from' | 'to'
  ) => {
    const input = e.target;
    const oldValue = type === 'from' ? fromInput : toInput;
    const newRaw = input.value;
    
    // Format the new value
    const formatted = formatDateInput(newRaw);
    
    if (type === 'from') {
      setFromInput(formatted);
      // Try to parse and update
      const date = parseDate(formatted);
      if (date) {
        onDateRangeChange({ ...dateRange, from: date });
      } else if (formatted === "") {
        onDateRangeChange({ ...dateRange, from: undefined });
      }
    } else {
      setToInput(formatted);
      const date = parseDate(formatted);
      if (date) {
        onDateRangeChange({ ...dateRange, to: date });
      } else if (formatted === "") {
        onDateRangeChange({ ...dateRange, to: undefined });
      }
    }
  };

  const handleDateInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    type: 'from' | 'to'
  ) => {
    const input = e.currentTarget;
    const cursorPos = input.selectionStart || 0;
    const value = type === 'from' ? fromInput : toInput;
    
    if (e.key === 'Backspace') {
      // If cursor is right after a dot, skip the dot and delete the character before
      if (cursorPos > 0 && (cursorPos === 5 || cursorPos === 8)) {
        e.preventDefault();
        const newValue = value.slice(0, cursorPos - 2) + value.slice(cursorPos - 1);
        const formatted = formatDateInput(newValue);
        if (type === 'from') {
          setFromInput(formatted);
          if (formatted === "") {
            onDateRangeChange({ ...dateRange, from: undefined });
          }
        } else {
          setToInput(formatted);
          if (formatted === "") {
            onDateRangeChange({ ...dateRange, to: undefined });
          }
        }
        // Set cursor position after state update
        setTimeout(() => {
          input.setSelectionRange(cursorPos - 2, cursorPos - 2);
        }, 0);
      }
    }
  };

  const handleBlur = (type: 'from' | 'to') => {
    const value = type === 'from' ? fromInput : toInput;
    const date = parseDate(value);
    
    if (date) {
      // Valid date - sync with props
      if (type === 'from') {
        setFromInput(format(date, "yyyy.MM.dd"));
      } else {
        setToInput(format(date, "yyyy.MM.dd"));
      }
    } else if (value === "") {
      // Empty - keep it empty, update props
      if (type === 'from') {
        onDateRangeChange({ ...dateRange, from: undefined });
      } else {
        onDateRangeChange({ ...dateRange, to: undefined });
      }
    } else {
      // Invalid partial input - revert to props
      if (type === 'from') {
        if (dateRange?.from) {
          setFromInput(format(dateRange.from, "yyyy.MM.dd"));
        } else {
          setFromInput("");
        }
      } else {
        if (dateRange?.to) {
          setToInput(format(dateRange.to, "yyyy.MM.dd"));
        } else {
          setToInput("");
        }
      }
    }
  };

  const resetDate = (type: 'from' | 'to' | 'all') => {
    if (type === 'from' || type === 'all') {
      setFromInput("");
      onDateRangeChange({ ...dateRange, from: undefined });
    }
    if (type === 'to' || type === 'all') {
      setToInput("");
      onDateRangeChange({ ...dateRange, to: undefined });
    }
  };

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex-1 w-full md:w-auto relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input 
            placeholder="지문 검색 (내용, 제목)" 
            className="pl-9 w-full" 
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-lg border">
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onViewModeChange('list')}
            className="h-8 gap-2"
          >
            <LayoutList className="w-4 h-4" /> <span className="hidden sm:inline">테이블</span>
          </Button>
          <Button
            variant={viewMode === 'timeline' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onViewModeChange('timeline')}
            className="h-8 gap-2"
          >
            <Clock className="w-4 h-4" /> <span className="hidden sm:inline">타임라인</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Bookmark Filter */}
        <Toggle 
            pressed={isBookmarked} 
            onPressedChange={onBookmarkChange}
            variant="outline"
            aria-label="Toggle boookmark filter"
            className="h-9 w-9 p-0 data-[state=on]:bg-yellow-50 data-[state=on]:text-yellow-600 data-[state=on]:border-yellow-200"
        >
            <Bookmark className={cn("w-4 h-4", isBookmarked && "fill-current")} />
        </Toggle>

        {/* Date Range Picker */}
        {/* Date Range Picker Split */}
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">기간:</span>
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <Popover open={fromOpen} onOpenChange={setFromOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className="h-9 w-9 p-0 bg-transparent"
                            >
                                <CalendarIcon className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                mode="single"
                                selected={dateRange?.from}
                                onSelect={(date: Date | undefined) => {
                                    onDateRangeChange({ ...dateRange, from: date });
                                    setFromOpen(false);
                                }}
                                initialFocus
                                locale={ko}
                            />
                            <div className="p-2 pt-0 flex justify-end">
                              <button 
                                type="button"
                                onClick={() => { resetDate('from'); setFromOpen(false); }}
                                className="text-sm text-sky-600 font-medium hover:text-sky-700"
                              >
                                초기화
                              </button>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Input
                      ref={fromInputRef}
                      className="w-[100px] h-9 text-center px-2"
                      placeholder="YYYY.MM.DD"
                      value={fromInput}
                      onChange={(e) => handleDateInputChange(e, 'from')}
                      onKeyDown={(e) => handleDateInputKeyDown(e, 'from')}
                      onBlur={() => handleBlur('from')}
                      maxLength={10}
                    />
                </div>

                <span className="text-sm text-muted-foreground">~</span>

                <div className="flex items-center gap-1">
                    <Popover open={toOpen} onOpenChange={setToOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className="h-9 w-9 p-0 bg-transparent"
                            >
                                <CalendarIcon className="h-4 w-4" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                mode="single"
                                selected={dateRange?.to}
                                onSelect={(date: Date | undefined) => {
                                    onDateRangeChange({ ...dateRange, to: date });
                                    setToOpen(false);
                                }}
                                initialFocus
                                locale={ko}
                                disabled={(date: Date) => dateRange?.from ? date < dateRange.from : false}
                            />
                            <div className="p-2 pt-0 flex justify-end">
                              <button 
                                type="button"
                                onClick={() => { resetDate('to'); setToOpen(false); }}
                                className="text-sm text-sky-600 font-medium hover:text-sky-700"
                              >
                                초기화
                              </button>
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Input
                      ref={toInputRef}
                      className="w-[100px] h-9 text-center px-2"
                      placeholder="YYYY.MM.DD"
                      value={toInput}
                      onChange={(e) => handleDateInputChange(e, 'to')}
                      onKeyDown={(e) => handleDateInputKeyDown(e, 'to')}
                      onBlur={() => handleBlur('to')}
                      maxLength={10}
                    />
                </div>
            </div>
        </div>

        {/* Tag Filter */}
        <div className="flex-1 min-w-[200px]">
             <TagInput 
                value={tags} 
                onChange={onTagsChange} 
                placeholder="태그: "
            />
        </div>
      </div>

      {/* Source Filters Section */}
      <div className="flex flex-wrap items-end gap-2 p-3 bg-indigo-50/80 rounded-lg border border-indigo-100">
        {/* Source Type Filter */}
        <div className="min-w-[120px]">
          <label className="text-xs font-medium text-indigo-900 mb-1 block">출처 종류</label>
          {sourceConfigs.length > 0 ? (
            <Select 
              value={sourceType || 'all'} 
              onValueChange={(value) => onSourceTypeChange(value === 'all' ? '' : value)}
            >
              <SelectTrigger className="h-9 text-sm bg-white border-indigo-200">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {sourceConfigs.map((config) => (
                  <SelectItem key={config.id} value={config.type_name}>
                    {config.type_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="예: 모의고사"
              value={sourceType}
              onChange={(e) => onSourceTypeChange(e.target.value)}
              className="h-9 text-sm bg-white border-indigo-200"
            />
          )}
        </div>

        {/* Dynamic Source Filters based on selected source type */}
        {(() => {
          const activeConfig = sourceConfigs.find(c => c.type_name === sourceType);
          if (!activeConfig) return null;
          
          return (
            <>
              {/* Source 1 */}
              {activeConfig.source_1_label && (
                <div className="min-w-[100px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeConfig.source_1_label}
                  </label>
                  {activeConfig.source_1_options && activeConfig.source_1_options.length > 0 ? (
                    <Select value={source1 || 'all'} onValueChange={(v) => onSource1Change(v === 'all' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm bg-white border-indigo-200">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {activeConfig.source_1_options.map((opt, i) => (
                          <SelectItem key={i} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={source1}
                      onChange={(e) => onSource1Change(e.target.value)}
                      className="h-9 text-sm bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 2 */}
              {activeConfig.source_2_label && (
                <div className="min-w-[100px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeConfig.source_2_label}
                  </label>
                  {activeConfig.source_2_options && activeConfig.source_2_options.length > 0 ? (
                    <Select value={source2 || 'all'} onValueChange={(v) => onSource2Change(v === 'all' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm bg-white border-indigo-200">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {activeConfig.source_2_options.map((opt, i) => (
                          <SelectItem key={i} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={source2}
                      onChange={(e) => onSource2Change(e.target.value)}
                      className="h-9 text-sm bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 3 */}
              {activeConfig.source_3_label && (
                <div className="min-w-[100px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeConfig.source_3_label}
                  </label>
                  {activeConfig.source_3_options && activeConfig.source_3_options.length > 0 ? (
                    <Select value={source3 || 'all'} onValueChange={(v) => onSource3Change(v === 'all' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm bg-white border-indigo-200">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {activeConfig.source_3_options.map((opt, i) => (
                          <SelectItem key={i} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={source3}
                      onChange={(e) => onSource3Change(e.target.value)}
                      className="h-9 text-sm bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}

              {/* Source 4 */}
              {activeConfig.source_4_label && (
                <div className="min-w-[100px]">
                  <label className="text-xs font-medium text-indigo-900 mb-1 block">
                    {activeConfig.source_4_label}
                  </label>
                  {activeConfig.source_4_options && activeConfig.source_4_options.length > 0 ? (
                    <Select value={source4 || 'all'} onValueChange={(v) => onSource4Change(v === 'all' ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm bg-white border-indigo-200">
                        <SelectValue placeholder="전체" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        {activeConfig.source_4_options.map((opt, i) => (
                          <SelectItem key={i} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="직접 입력"
                      value={source4}
                      onChange={(e) => onSource4Change(e.target.value)}
                      className="h-9 text-sm bg-white border-indigo-200"
                    />
                  )}
                </div>
              )}
            </>
          );
        })()}

        {/* Source Filters Reset Button */}
        <div className="flex items-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100"
            onClick={() => {
              onSourceTypeChange('');
              onSource1Change('');
              onSource2Change('');
              onSource3Change('');
              onSource4Change('');
            }}
          >
            초기화
          </Button>
        </div>
      </div>
    </div>
  );
}
