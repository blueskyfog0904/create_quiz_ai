import { getSystemPrompts } from '@/app/api/admin/prompts/actions';
import { getSystemSettings } from '@/app/api/admin/settings/actions';
import PromptEditor from './prompt-editor';
import SettingsEditor from './settings-editor';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage() {
  const [prompts, settings] = await Promise.all([
    getSystemPrompts(),
    getSystemSettings()
  ]);

  return (
    <div className="space-y-8 p-8">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/passages" className="hover:text-foreground">영어지문 관리</Link>
          <ChevronRight className="w-4 h-4" />
          <span>프롬프트 관리</span>
        </div>
        
        <div>
          <h1 className="text-3xl font-bold tracking-tight">시스템 프롬프트 관리</h1>
          <p className="text-muted-foreground mt-2">
            OCR 및 AI 생성에 사용되는 프롬프트를 실시간으로 수정합니다.
          </p>
        </div>
      </div>

      <PromptEditor initialPrompts={prompts} />
      <SettingsEditor initialSettings={settings} />
    </div>
  );
}
