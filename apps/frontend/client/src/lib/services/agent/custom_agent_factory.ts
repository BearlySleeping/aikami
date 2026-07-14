// apps/frontend/client/src/lib/services/agent/custom_agent_factory.ts
//
// Custom agent factory — converts registry definitions into
// pipeline-compatible AgentConfig objects and provides the dynamic
// agent executor.
//
// Contract: C-247 Custom Agent Creation

import type {
  AgentConfig,
  AgentPipelineContext,
  AgentRunResult,
  CustomAgentDefinition,
} from '$types/agent_types';

/**
 * Converts a CustomAgentDefinition from the registry into a standard
 * AgentConfig that the pipeline can execute natively.
 *
 * @param definition - Custom agent definition from the registry.
 * @returns A standard AgentConfig ready for pipeline execution.
 */
export const customAgentToConfig = (definition: CustomAgentDefinition): AgentConfig => {
  return {
    id: definition.id,
    name: definition.name,
    phase: definition.phase,
    systemPrompt: definition.promptTemplate,
    timeout: definition.timeout,
    enabled: definition.enabled,
    contextKey: definition.contextKey,
  };
};

/**
 * Executes a custom agent using the text generation service's
 * structural extraction with the user-defined schema and optional
 * connection override.
 *
 * @param options.config - Agent configuration (from customAgentToConfig).
 * @param options.context - Pipeline context.
 * @param options.definition - The full custom agent definition (for schema/connection).
 * @param options.aiResponse - The AI response text (for post-agents).
 * @param options.mockInput - Optional mock input for test runs.
 * @returns Agent run result.
 */
export const runCustomAgent = async ({
  config,
  context,
  definition,
  aiResponse,
  mockInput,
}: {
  config: AgentConfig;
  context: AgentPipelineContext;
  definition: CustomAgentDefinition;
  aiResponse?: string;
  mockInput?: string;
}): Promise<AgentRunResult> => {
  const start = performance.now();

  try {
    // Dynamically import services to avoid circular deps
    const [{ textGenerationService }, { resolveMacros }] = await Promise.all([
      import('$services'),
      import('@aikami/parser'),
    ]);

    // Determine the text to analyze
    const inputText = mockInput ?? aiResponse ?? context.userMessage;

    // Resolve macros in the prompt template
    let resolvedPrompt: string;
    try {
      resolvedPrompt = resolveMacros({
        template: definition.promptTemplate,
        context: {
          userMessage: context.userMessage,
          userName: context.userMessage,
        },
      });
      // Post-process: replace unresolved macro placeholders with original
      // so the LLM sees the raw macro name as a hint
      const UnknownPrefix = '\x00UNK:';
      const UnknownSuffix = '\x00';
      resolvedPrompt = resolvedPrompt.replace(
        new RegExp(`${UnknownPrefix}([^${UnknownSuffix}]+)${UnknownSuffix}`, 'g'),
        '{{$1}}',
      );
    } catch {
      // If macro resolution fails, use the raw template
      resolvedPrompt = definition.promptTemplate;
    }

    const systemPrompt = [
      'You are a background agent for a fantasy RPG.',
      definition.promptTemplate,
      '',
      'Text to analyze:',
      inputText.slice(0, 4000),
    ].join('\n');

    // Use extractStructure with the user-defined schema
    const result = await textGenerationService.extractStructure({
      schema: definition.outputSchema,
      schemaName: definition.name.replace(/\s+/g, '_'),
      prompt: systemPrompt,
      systemPrompt: resolvedPrompt,
      model: definition.connectionId,
    });

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: result,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agentId: config.id,
      phase: config.phase,
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - start),
    };
  }
};
