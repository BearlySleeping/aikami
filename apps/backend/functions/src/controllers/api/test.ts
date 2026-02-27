import { getUserData } from '@aikami/backend/database/user.ts';
import { googleAI } from '@genkit-ai/googleai';
import { onRequest } from 'firebase-functions/https';
import { genkit } from 'genkit/beta';

const ai = genkit({
  plugins: [googleAI()], // set the GOOGLE_API_KEY env variable
  model: googleAI.model('gemini-2.0-flash'),
});

export const test = onRequest(async (request, response) => {
  try {
    console.log('Request body:', request.body); // Good for debugging
    const user = await getUserData('ZVl2HZcI2kfrh5keT76FXOVlYpE3');

    // --- Your placeholders ---

    // 1. The 'system' prompt (the AI's instructions)
    const system = 'You are a helpful assistant. Keep your answers brief.';

    // 3. The 'prompt' (the new user message from the request)
    // Assumes your POST request sends JSON like: { "prompt": "Hello there!" }
    const prompt = request.body.prompt || 'Tell me a short fact.';

    // --- End placeholders ---

    // These lines will now work
    const chat = ai.chat({ system });
    const chatResponse = await chat.send({ prompt });

    response.send({
      chatResponse,
      user,
    });
  } catch (error) {
    console.error(error);
    response.status(500).send(error);
  }
});
