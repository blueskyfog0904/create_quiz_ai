// test-gemini.ts
// 사용법: npx tsx test-gemini.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// 직접 .env.local 파일을 파싱하여 환경변수 설정 (dotenv 의존성 없이 확실하게 로드)
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["'](.*)["']$/, '$1'); // 따옴표 제거
        process.env[key] = value;
      }
    });
    console.log('✅ .env.local loaded successfully');
  } else {
    console.warn('⚠️ .env.local not found');
  }
} catch (e) {
  console.error('❌ Failed to load .env.local', e);
}

const API_KEY = process.env.GEMINI_API_KEY;

console.log('----------------------------------------');
if (!API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY is missing in process.env');
  process.exit(1);
}

if (API_KEY === 'dummy' || API_KEY.length < 10) {
    console.error('❌ Error: GEMINI_API_KEY appears to be invalid (dummy or too short)');
    console.log('Current Key:', API_KEY);
    process.exit(1);
}

async function testGemini() {
  console.log('🚀 Testing Gemini API...');
  console.log(`🔑 API Key present: ${API_KEY.substring(0, 5)}...***********`);

  const genAI = new GoogleGenerativeAI(API_KEY);
  
  // 테스트할 모델 목록 (유효한 모델명 위주)
  const modelsToTest = ['gemini-pro', 'gemini-2.5-flash', 'gemini-2.5-pro'];

  for (const modelName of modelsToTest) {
    console.log(`\n----------------------------------------`);
    console.log(`🤖 Testing model: ${modelName}`);
    
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = "Explain 'AI' in 10 words.";

      console.log('📤 Sending request...');
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      console.log(`✅ Success! Response:`);
      console.log(text);
    } catch (error: any) {
      console.error(`❌ Failed with model ${modelName}:`);
      // 에러 메시지가 객체일 경우 처리
      console.error(error.message || JSON.stringify(error));
    }
  }
}

testGemini().catch(err => console.error('Fatal Error:', err));
