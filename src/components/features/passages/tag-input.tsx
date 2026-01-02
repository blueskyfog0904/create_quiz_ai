'use client';

import * as React from 'react';
import { X, Plus, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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

  React.useEffect(() => {
    // Load available tags for autocomplete
    getAllTags().then(tags => setAvailableTags(tags)).catch(console.error);
  }, []);

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
    if (inputValue.trim() && !value.includes(inputValue.trim())) {
      onChange([...value, inputValue.trim()]);
    }
    setInputValue('');
    setOpen(false);
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
        <PopoverContent className="p-0" align="start">
          <Command>
            <CommandInput 
              placeholder={placeholder} 
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                }
              }}
            />
            <CommandList className="max-h-[200px] overflow-y-auto">
                <CommandEmpty>
                    {inputValue ? (
                        <div className="p-2 text-sm text-center cursor-pointer hover:bg-accent rounded-sm flex items-center gap-2 justify-center" onClick={handleCreate}>
                            <Plus className="w-4 h-4" />
                            "{inputValue}" 생성
                        </div>
                    ) : (
                        <div className="py-2 text-center text-xs text-muted-foreground">태그를 검색하거나 입력하세요</div>
                    )}
                </CommandEmpty>
                <CommandGroup>
                    {availableTags.filter(t => !value.includes(t)).map(tag => (
                        <CommandItem key={tag} onSelect={() => handleSelect(tag)}>
                        {tag}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
