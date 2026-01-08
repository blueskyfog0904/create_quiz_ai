const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config({ path: '.env.local' });

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Dummy init to check connection
    // There is no direct listModels on genAI instance in some SDK versions, needs ModelService.
    // Actually the SDK is GoogleGenerativeAI. 
    // Let's try to list models if creating one works or failure gives hints.
    
    console.log("Checking model availability...");
    // Just try generating with the target model to see if it errors
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent("Hello");
    console.log("gemini-2.5-flash is working: ", result.response.text());
  } catch (error) {
    console.error("Error checking gemini-2.5-flash:", error.message);
    
    try {
        console.log("Trying gemini-2.0-flash...");
        const model2 = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result2 = await model2.generateContent("Hello");
        console.log("gemini-2.0-flash is working: ", result2.response.text());
    } catch(e) {
        console.error("Error checking gemini-2.0-flash:", e.message);
    }

    try {
        console.log("Trying gemini-1.5-flash...");
        const model3 = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result3 = await model3.generateContent("Hello");
        console.log("gemini-1.5-flash is working: ", result3.response.text());
    } catch(e) {
        console.error("Error checking gemini-1.5-flash:", e.message);
    }
  }
}

listModels();
