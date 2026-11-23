import { describe, expect, it } from 'vitest';
import { isConversationalDemoHttpTestEnabled } from '../integration/conversational-demo-test-mode.js';

describe('conversational demo HTTP test mode', () => {
  it('enables only on the explicit true flag', () => {
    expect(isConversationalDemoHttpTestEnabled('true')).toBe(true);
    expect(isConversationalDemoHttpTestEnabled('false')).toBe(false);
    expect(isConversationalDemoHttpTestEnabled(undefined)).toBe(false);
    expect(isConversationalDemoHttpTestEnabled('1')).toBe(false);
  });
});
