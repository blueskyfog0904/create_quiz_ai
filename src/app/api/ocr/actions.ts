'use server';

import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@/lib/supabase/server";
import { getAIModelSettings } from "@/app/api/admin/settings/actions";
import {
  normalizeOcrPassageText,
  normalizeVisualCropPassages,
} from "@/lib/ocr/response-normalization";
import {
  getErrorStatusCode,
  isRetryableGeminiError,
  withGeminiRetry,
} from "@/lib/ocr/gemini-retry";

// Initialize Google AI
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function extractTextFromFile(formData: FormData) {
  const files = formData.getAll("files") as File[];
  
  if (!files || files.length === 0) {
    throw new Error("No files provided");
  }

  // Debug logging
  console.log(`[OCR] Starting batch processing for ${files.length} files`);

  const tempFilePaths: string[] = [];
  const uploadResults: Array<{
    file: {
      uri: string
      mimeType: string
      name: string
      state: FileState
    }
  }> = [];

  try {
    // 1. Save and Upload all files
    for (const file of files) {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const tempPath = join(tmpdir(), `upload-${Date.now()}-${file.name}`);
        await writeFile(tempPath, buffer);
        tempFilePaths.push(tempPath);
        console.log(`[OCR] Saved temporary file: ${tempPath}`);

        const uploadResult = await fileManager.uploadFile(tempPath, {
          mimeType: file.type,
          displayName: file.name,
        });
        uploadResults.push(uploadResult);
        console.log(`[OCR] Uploaded to Google AI: ${uploadResult.file.uri}`);
    }

    // 2. Wait for processing to complete for ALL files
    console.log("[OCR] Waiting for files to process...");
    for (const result of uploadResults) {
        let fileState = result.file.state;
        while (fileState === FileState.PROCESSING) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const fileStatus = await fileManager.getFile(result.file.name);
            fileState = fileStatus.state;
        }
        if (fileState === FileState.FAILED) {
            throw new Error(`File processing failed: ${result.file.name}`);
        }
    }
    console.log("[OCR] All files processed and ready.");

    // 3. Generate content with dynamic model
    const { modelName } = await getAIModelSettings();
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
    
  const mode = (formData.get("mode") as string) || 'visual';
  console.log(`[OCR] Processing mode: ${mode}`);

  // ... (Upload logic is same) ...

    // Fetch dynamic prompt based on MODE
    const promptKey = mode === 'auto' ? 'ocr_auto_extraction' : 'ocr_pdf_extraction';
    
    const supabase = await createClient();
    const { data: promptData } = await supabase
      .from('system_prompts')
      .select('content') // Correct column name from admin/prompts/actions.ts
      .eq('key', promptKey) // Correct column name from admin/prompts/actions.ts
      .single();

    // Fallback prompts
    const visualPrompt = `
      You are an expert OCR assistant for English education materials.
      Each provided image is already cropped to a user-selected passage region.
      
      YOUR TASK:
      1. Extract only the English passage text visible in each cropped image.
      2. Do not invent, merge, or continue text that is not visible in the crop.
      3. Preserve the reading order within each crop.
      4. If the passage contains an underlined blank or missing-word line, preserve it in the output as _____ exactly where it appears.
      5. Do not omit blanks/underlines just because they are not alphabetic text.
      6. If numbered answer choices are visible, preserve them in order and prefer the format (1), (2), (3), ...
      7. Return a JSON object: { "passages": ["text1", "text2"] }
    `;

    const autoPrompt = `
      You are an expert OCR assistant for Korean English education materials.

      YOUR TASK:
      Analyze the provided image(s) and extract **ONLY valid English passages** suitable for creating test questions.

      **CRITICAL EXTRACTION RULES:**
      1. **Minimum Length**: A valid passage must be **at least 3 lines long**. Ignore anything shorter (e.g., 1-2 line slogans, simple headers, short dialogue snippets).
      2. **Context**: Extract texts that look like reading passages, articles, stories, or dialogues used in exams.
      3. **Ignore**:
         - Short headers/footers (e.g., "Lesson 1", "No Hat, No Play").
         - Question numbers or instructions (e.g., "03 What does...", "Answer the question").
         - Standalone multiple-choice answer blocks such as 5-choice options, answer lists, 보기, 선지 묶음, or boxes that contain only numbered/circled choices.
         - Text blocks whose primary content is answer options rather than a readable English passage.
         - Korean explanations or definitions mixed in the text.
         - Isolated UI elements or button texts.
      4. **Smart Merge & Split**:
         - Merge text split across columns or pages if it forms a single continuous story/article.
         - Separate distinct passages (e.g., Passage 1 vs Passage 2).
      5. If a passage includes an underlined blank or missing-word line, preserve that blank as _____ in the extracted text.
      6. If the extracted passage contains numbered answer choices, preserve them and prefer the format (1), (2), (3), ...
      7. Extract only the passage/question stem when it is meaningful by itself, and exclude detached choice-only panels.

      **Output Format**:
      Return a JSON object: { "passages": ["Valid passage 1...", "Valid passage 2..."] }
    `;

    const prompt = promptData?.content || (mode === 'auto' ? autoPrompt : visualPrompt);

    console.log(`[OCR] Sending batch request to Gemini (${modelName})...`);
    
    const parsePassagesFromResponse = (text: string): { success: true; passages: string[] } | { success: false; error: string } => {
      const cleanText = text.replace(/```json\n|\n```/g, '').trim();
      
      const jsonResponse = JSON.parse(cleanText);
      console.log("[OCR] Parsed Object keys:", Object.keys(jsonResponse));

      if (!jsonResponse.passages || !Array.isArray(jsonResponse.passages)) {
         console.warn("[OCR] Response missing 'passages' array. Raw parsed:", jsonResponse);
         if (jsonResponse.content) {
             return { success: true, passages: [jsonResponse.content] };
         }
         if (Array.isArray(jsonResponse)) {
             return { success: true, passages: jsonResponse };
         }
         return { success: true, passages: [cleanText] };
      }

      const passages = jsonResponse.passages
        .map((passage: unknown) => typeof passage === 'string' ? normalizeOcrPassageText(passage) : '')
        .filter(Boolean);

      return { success: true, passages };
    }

    const runGenerateContent = async (requestParts: Parameters<typeof model.generateContent>[0]) => withGeminiRetry(
      () => model.generateContent(requestParts),
      {
        maxAttempts: 3,
        onRetry: (attempt, delayMs, error) => {
          console.warn('[OCR] Retrying Gemini request', {
            mode,
            modelName,
            attempt,
            delayMs,
            status: getErrorStatusCode(error),
            fileCount: files.length,
          });
        },
      }
    );

    if (mode === 'visual') {
      const normalizedVisualPassages: string[] = []

      for (const uploadResult of uploadResults) {
        const requestParts = [
          {
            fileData: {
              mimeType: uploadResult.file.mimeType,
              fileUri: uploadResult.file.uri,
            },
          },
          { text: prompt },
        ]

        const result = await runGenerateContent(requestParts)
        const response = await result.response
        const text = response.text()
        console.log(`[OCR] Raw visual crop AI Response: ${text.substring(0, 500)}...`)

        try {
          const parsed = parsePassagesFromResponse(text)
          if (!parsed.success) {
            return { success: false, error: parsed.error }
          }

          normalizedVisualPassages.push(...normalizeVisualCropPassages(parsed.passages))
        } catch (parseError) {
          console.error("[OCR] JSON Parse Error:", parseError);
          console.error("[OCR] Text causing error:", text);
          return { success: false, error: "AI responded but failed to parse JSON." };
        }
      }

      return { success: true, data: { passages: normalizedVisualPassages } };
    }

    // Construct the request parts: All images + Prompt
    const requestParts = [
        ...uploadResults.map(r => ({
            fileData: {
                mimeType: r.file.mimeType,
                fileUri: r.file.uri
            }
        })),
        { text: prompt }
    ];

    const result = await runGenerateContent(requestParts);

    const response = await result.response;
    const text = response.text();
    console.log(`[OCR] Raw AI Response: ${text.substring(0, 500)}...`); 
    
    try {
      const parsed = parsePassagesFromResponse(text)
      if (!parsed.success) {
        return { success: false, error: parsed.error }
      }

      return { success: true, data: { passages: parsed.passages } };
    } catch (parseError) {
      console.error("[OCR] JSON Parse Error:", parseError);
      console.error("[OCR] Text causing error:", text);
      return { success: false, error: "AI responded but failed to parse JSON." };
    }

  } catch (error: unknown) {
    console.error("[OCR] Critical Error:", error);

    if (isRetryableGeminiError(error)) {
      return {
        success: false,
        error: 'AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요.',
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  } finally {
    // Cleanup
    try {
      for (const path of tempFilePaths) {
          await unlink(path).catch(() => {});
      }
      console.log(`[OCR] Cleaned up ${tempFilePaths.length} local temp files`);
      
      for (const result of uploadResults) {
          await fileManager.deleteFile(result.file.name).catch(() => {});
      }
      console.log(`[OCR] Cleaned up ${uploadResults.length} Google AI files`);
    } catch (cleanupError) {
      console.error("[OCR] Cleanup warning:", cleanupError);
    }
  }
}
