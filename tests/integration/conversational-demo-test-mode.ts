export function isConversationalDemoHttpTestEnabled(value = process.env.DEMO_HTTP_TEST_MODE): boolean {
  return value === 'true';
}
