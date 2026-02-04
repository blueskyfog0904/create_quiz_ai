require('dotenv').config({ path: '.env.local' });

async function listModels() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("No API key found in .env.local");
    return;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  
  try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.models) {
          console.log("Available Models:");
          data.models.forEach(m => console.log(`- ${m.name}`));
      } else {
          console.log("Response:", JSON.stringify(data, null, 2));
      }
  } catch (e) {
      console.error(e);
  }
}

listModels();
