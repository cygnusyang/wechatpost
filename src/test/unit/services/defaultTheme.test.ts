import { defaultWechatTheme } from 'src/services/defaultTheme';

describe('defaultWechatTheme', () => {
  it('should export the default theme CSS', () => {
    expect(defaultWechatTheme).toBeDefined();
    expect(typeof defaultWechatTheme).toBe('string');
    expect(defaultWechatTheme.length).toBeGreaterThan(0);
    expect(defaultWechatTheme).toContain('body');
    expect(defaultWechatTheme).toContain('Headings');
  });
});
