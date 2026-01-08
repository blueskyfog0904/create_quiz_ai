'use client';

import * as React from 'react';
import { X, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getAllTags } from '@/app/api/passages/actions';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ value = [], onChange, placeholder = "태그 추가..." }: TagInputProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const [availableTags, setAvailableTags] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Load available tags for autocomplete
    getAllTags().then(tags => setAvailableTags(tags)).catch(console.error);
  }, []);

  // Filter tags based on input
  const filteredTags = React.useMemo(() => {
    if (!inputValue.trim()) {
      return availableTags.filter(t => !value.includes(t));
    }
    return availableTags.filter(t => 
      !value.includes(t) && t.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [inputValue, availableTags, value]);

  const handleSelect = (tag: string) => {
    if (!value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInputValue('');
    setOpen(false);
  };

  const handleRemove = (tagToRemove: string) => {
    onChange(value.filter(tag => tag !== tagToRemove));
  };

  const handleCreate = () => {
    const trimmed = inputValue.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue('');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Ignore IME composition
      if (e.nativeEvent.isComposing) return;
      
      e.preventDefault();
      
      // If there's an exact match in filtered tags, select it
      const exactMatch = filteredTags.find(
        tag => tag.toLowerCase() === inputValue.trim().toLowerCase()
      );
      
      if (exactMatch) {
        handleSelect(exactMatch);
      } else if (inputValue.trim()) {
        // Create new tag
        handleCreate();
      }
    }
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {value.map(tag => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <div 
            role="button" 
            tabIndex={0}
            className="rounded-full hover:bg-secondary-foreground/20 p-0.5 cursor-pointer"
            onClick={(e) => { e.stopPropagation(); handleRemove(tag); }}
          >
            <X className="w-3 h-3" />
          </div>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 rounded-full border-dashed group-hover:border-solid">
            <Plus className="w-3 h-3" />
            Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-2" align="start">
          <div className="space-y-2">
            <Input
              ref={inputRef}
              placeholder={placeholder}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8"
              autoFocus
            />
            
            <div className="max-h-[150px] overflow-y-auto">
              {filteredTags.length > 0 ? (
                <div className="space-y-1">
                  {filteredTags.map(tag => (
                    <div
                      key={tag}
                      className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
                      onClick={() => handleSelect(tag)}
                      role="button"
                      tabIndex={0}
                    >
                      {tag}
                    </div>
                  ))}
                </div>
              ) : inputValue.trim() ? (
                <div 
                  className="px-2 py-1.5 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
                  onClick={handleCreate}
                  role="button"
                  tabIndex={0}
                >
                  <Plus className="w-3 h-3" />
                  "{inputValue}" 생성
                </div>
              ) : (
                <div className="py-2 text-center text-xs text-muted-foreground">
                  태그를 검색하거나 입력하세요
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
