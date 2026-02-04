'use server';

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@/lib/supabase/server";
import { getSystemSettings, getAIModelSettings } from "@/app/api/admin/settings/actions";

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface GeneratePassagesInput {
  difficultyId: string;
  count: number;
  mainCategory: string;
  subCategory: string;
  isRandom: boolean;
}

export interface GeneratedPassage {
  title_en: string;
  title_ko: string;
  content: string;
  content_translation: string;
}

export async function generatePassages(input: GeneratePassagesInput): Promise<{ success: boolean; data?: GeneratedPassage[]; error?: string }> {
  try {
    const supabase = await createClient();
    
    // 1. Fetch Configuration & System Prompt
    const [settings, promptData] = await Promise.all([
      getSystemSettings(),
      supabase.from('system_prompts').select('content').eq('key', 'ai_passage_generation').single()
    ]);

    // Resolve difficulty value
    let difficultyValue = "high school level"; // fallback
    if (settings?.value.difficultyLevels) {
      const found = settings.value.difficultyLevels.find(l => l.id === input.difficultyId);
      if (found) difficultyValue = found.promptValue;
    } else if (settings?.value.difficulty) {
       // Legacy Fallback
       const key = input.difficultyId === 'high' ? 'high' : 'middle';
       difficultyValue = settings.value.difficulty[key] || "high school level";
    }

    // Resolve System Prompt
    let systemPromptTemplate = promptData.data?.content || 
      'Generate a reading passage suitable for a {difficulty} level Korean high school English exam.';

    // 2. Prepare Final Prompt
    // Replace variables
    let finalSystemPrompt = systemPromptTemplate
      .replace('{difficulty}', difficultyValue)
      .replace('{mainCategory}', input.isRandom ? 'Random Academic Topic' : input.mainCategory)
      .replace('{subCategory}', input.isRandom ? 'any specific subtopic' : input.subCategory);

    // Add instructions for JSON array and count
    const userPrompt = `
      Generate ${input.count} distinct reading passage(s).
      
      Return the result as a STRICT JSON ARRAY of objects. Each object must have:
      {
        "title_en": "English Title",
        "title_ko": "Korean Title",
        "content": "The English passage text (approx 150-200 words)",
        "content_translation": "Korean translation of the passage"
      }

      Do not use markdown code blocks. Return only validity JSON array.
    `;

    // 3. Call Gemini
    const { modelName } = await getAIModelSettings();
    const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
            responseMimeType: "application/json"
        }
    });

    const result = await model.generateContent([
        { text: finalSystemPrompt },
        { text: userPrompt }
    ]);

    const responseText = result.response.text();
    console.log('[AI Generation] Raw response length:', responseText.length);

    // 4. Parse Response
    let parsedData: GeneratedPassage[];
    try {
        parsedData = JSON.parse(responseText);
        if (!Array.isArray(parsedData)) {
            // Handle if single object returned
            parsedData = [parsedData];
        }
    } catch (e) {
        console.error('[AI Generation] JSON Parse Error:', e);
        return { success: false, error: 'AI response was not valid JSON' };
    }

    return { success: true, data: parsedData };

  } catch (error: any) {
    console.error('[AI Generation] Error:', error);
    return { success: false, error: error.message || 'Unknown error occurred' };
  }
}
