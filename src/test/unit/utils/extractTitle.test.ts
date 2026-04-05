import { extractTitle } from 'src/utils/extractTitle';

describe('extractTitle', () => {
  it('should extract title from first H1 heading', () => {
    const markdown = `# Hello World

This is some content.
`;
    const result = extractTitle(markdown);
    expect(result).toBe('Hello World');
  });

  it('should trim whitespace from title', () => {
    const markdown = `#   My Title   \n\nContent`;
    const result = extractTitle(markdown);
    expect(result).toBe('My Title');
  });

  it('should return null when no H1 heading exists', () => {
    const markdown = `## Second Level\n\nNo H1 here.`;
    const result = extractTitle(markdown);
    expect(result).toBeNull();
  });

  it('should find H1 at beginning of line with markdown content', () => {
    const markdown = `Some text before\n# Title Here\nSome text after`;
    const result = extractTitle(markdown);
    expect(result).toBe('Title Here');
  });
});
