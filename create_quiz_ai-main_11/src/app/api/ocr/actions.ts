'use server';

import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createClient } from "@/lib/supabase/server";

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
  const uploadResults: any[] = [];

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

    // 3. Generate content with Gemini 2.5 Flash
    // Switching to 2.5-flash as 2.0-flash returned quota limit 0 (access restricted).
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
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
      The user has provided an image where specific parts are **highlighted/boxed** and the rest is **dimmed/darkened**.
      
      YOUR TASK:
      1. Focus **STRICTLY** on the bright, highlighted areas.
      2. Extract **ONLY the English text** contained within these bright/boxed areas.
      3. **CRITICAL**: Ignore ALL text in the darkened/dimmed background. Even if you can read it, DO NOT extract it.
      4. If a sentence continues from a highlighted area into the dark background, **STOP** extracting at the boundary.
      5. If the highlighted areas cover parts of the same continuous passage, **MERGE them intelligently**.
      6. Return a JSON object: { "passages": ["text1", "text2"] }
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
         - Korean explanations or definitions mixed in the text.
         - Isolated UI elements or button texts.
      4. **Smart Merge & Split**:
         - Merge text split across columns or pages if it forms a single continuous story/article.
         - Separate distinct passages (e.g., Passage 1 vs Passage 2).

      **Output Format**:
      Return a JSON object: { "passages": ["Valid passage 1...", "Valid passage 2..."] }
    `;

    const prompt = promptData?.content || (mode === 'auto' ? autoPrompt : visualPrompt);

    console.log("[OCR] Sending batch request to Gemini (gemini-2.5-flash)...");
    
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

    const result = await model.generateContent(requestParts);

    const response = await result.response;
    const text = response.text();
    console.log(`[OCR] Raw AI Response: ${text.substring(0, 500)}...`); 
    
    try {
      const cleanText = text.replace(/```json\n|\n```/g, '').trim();
      const jsonResponse = JSON.parse(cleanText);
      console.log("[OCR] Parsed Object keys:", Object.keys(jsonResponse));

      if (!jsonResponse.passages || !Array.isArray(jsonResponse.passages)) {
         console.warn("[OCR] Response missing 'passages' array. Raw parsed:", jsonResponse);
         if (jsonResponse.content) {
             return { success: true, data: { passages: [jsonResponse.content] } };
         }
         if (Array.isArray(jsonResponse)) {
             return { success: true, data: { passages: jsonResponse } };
         }
         return { success: true, data: { passages: [cleanText] } };
      }

      return { success: true, data: jsonResponse };
    } catch (parseError) {
      console.error("[OCR] JSON Parse Error:", parseError);
      console.error("[OCR] Text causing error:", text);
      return { success: false, error: "AI responded but failed to parse JSON." };
    }

  } catch (error: any) {
    console.error("[OCR] Critical Error:", error);
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
