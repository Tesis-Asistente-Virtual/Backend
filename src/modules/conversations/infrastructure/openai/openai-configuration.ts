export interface OpenAiEnvironmentSettings {
  readonly openAiApiKey?: string;
  readonly openAiModel?: string;
  readonly openAiTimeoutMs: number;
  readonly openAiMaxOutputTokens: number;
  readonly openAiMaxContextMessages: number;
  readonly openAiMaxContextCharacters: number;
}

export interface OpenAiConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
  readonly maxContextMessages: number;
  readonly maxContextCharacters: number;
}

export class OpenAiConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'OpenAiConfigurationError'; }
}

export function resolveOpenAiConfiguration(settings: OpenAiEnvironmentSettings): OpenAiConfiguration {
  const apiKey = settings.openAiApiKey?.trim();
  const model = settings.openAiModel?.trim();
  if (!apiKey) throw new OpenAiConfigurationError('OPENAI_API_KEY is required to use the OpenAI adapter');
  if (!model) throw new OpenAiConfigurationError('OPENAI_MODEL is required to use the OpenAI adapter');
  return {
    apiKey,
    model,
    timeoutMs: settings.openAiTimeoutMs,
    maxOutputTokens: settings.openAiMaxOutputTokens,
    maxContextMessages: settings.openAiMaxContextMessages,
    maxContextCharacters: settings.openAiMaxContextCharacters,
  };
}
