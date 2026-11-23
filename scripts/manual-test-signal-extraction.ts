/** @deprecated Replaced by the explicitly gated, synthetic-only OpenAI check. */
process.stdout.write(JSON.stringify({
  operation: 'manual_signal_extraction_check',
  status: 'disabled',
  reason: 'use_the_synthetic_only_openai_check',
  command: 'npm run ai:check:synthetic -- --run-synthetic-openai-check --confirm-synthetic-only',
}) + '\n');
