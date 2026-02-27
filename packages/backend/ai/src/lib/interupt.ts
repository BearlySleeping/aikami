// api/route.ts

import { googleAI } from '@genkit-ai/googleai';
import { z } from 'genkit';
// this example requires beta features
import { genkit } from 'genkit/beta';

const ai = genkit({
  plugins: [googleAI()], // set the GOOGLE_API_KEY env variable
  model: googleAI.model('gemini-2.0-flash'),
});

import genkitEndpoint from './endpoint.ts';

export const QuestionSchema = z.object({
  question: z.string().describe('the text question to display to the user'),
  choices: z.array(z.string()).describe('choices for a multiple choice question'),
  allowMultiple: z
    .boolean()
    .optional()
    .describe('when true, allows the user to select multiple options'),
  allowCustom: z
    .boolean()
    .optional()
    .describe('when true, allows the user to write-in their own answer'),
});
export type Question = z.infer<typeof QuestionSchema>;

export const AnswerSchema = z.object({
  answer: z.union([z.array(z.string()), z.string()]),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const DEFAULT_SYSTEM_MESSAGE =
  "You are a trivia game host. The user will provide a subject and you will begin quizzing them. For each question, introduce the question with some fun flavor text, then use the askQuestion tool to ask the question. When they answer a question, tell them whether they're right or wrong then introduce the next question.";

const askQuestion = ai.defineInterrupt({
  name: 'askQuestion',
  description:
    "Use this to directly ask the user a question. The user will see a custom form with the options. The response of this function call will be the user's answer.",
  inputSchema: QuestionSchema,
  outputSchema: AnswerSchema,
});

export const POST = genkitEndpoint(({ system, messages, prompt, resume }) => {
  const chat = ai.chat({
    system: system || DEFAULT_SYSTEM_MESSAGE,
    tools: [askQuestion],
    messages,
  });
  return chat.sendStream({ prompt, resume });
});
