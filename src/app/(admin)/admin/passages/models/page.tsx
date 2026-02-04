import { getAIModelSettings, getAvailableAIModels } from '@/app/api/admin/settings/actions';
import AIModelSettings from './model-settings';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

// Force dynamic since settings change
export const dynamic = 'force-dynamic';

export default async function AIModelSettingsPage() {
  const [settings, availableModels] = await Promise.all([
    getAIModelSettings(),
    getAvailableAIModels()
  ]);

  return (
    <div className="space-y-8 p-8">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/admin/passages" className="hover:text-foreground">영어지문 관리</Link>
          <ChevronRight className="w-4 h-4" />
          <span>AI 모델 설정</span>
        </div>
        
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI 모델 설정</h1>
          <p className="text-muted-foreground mt-2">
            시스템 전반에서 사용되는 Google Gemini 모델을 선택합니다.
          </p>
        </div>
      </div>

      <div className="max-w-3xl">
        <AIModelSettings initialSettings={settings} availableModels={availableModels} />
      </div>
    </div>
  );
}
