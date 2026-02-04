import Link from 'next/link';
import { 
  BookOpen, 
  Settings, 
  FileText, 
  Sparkles, 
  Bot 
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AdminPassagesPage() {
  return (
    <div className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">영어지문 관리</h1>
        <p className="text-muted-foreground mt-2">
          지문 생성/업로드 기능 및 관련 AI 프롬프트를 관리합니다.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/admin/passages/prompts">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-orange-500" />
                프롬프트 관리
              </CardTitle>
              <CardDescription>
                OCR 및 AI 지문 생성에 사용되는 시스템 프롬프트를 수정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>OCR 텍스트 추출 프롬프트</li>
                <li>AI 지문 생성 프롬프트</li>
              </ul>
            </CardContent>
          </Card>
        </Link>
        
        <Link href="/admin/passages/models">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-500" />
                AI 모델 설정
              </CardTitle>
              <CardDescription>
                Gemini 모델 버전 및 파라미터를 설정합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                현재 전역으로 사용되는 AI 모델 버전을 변경합니다. (예: Gemini 2.0 Flash)
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
