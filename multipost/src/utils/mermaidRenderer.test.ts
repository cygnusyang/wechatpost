import { renderMermaidToBuffer } from './mermaidRenderer';

// Mock canvas to avoid canvas rendering in tests
jest.mock('canvas', () => ({
  createCanvas: jest.fn(() => ({
    getContext: jest.fn(() => ({
      fillStyle: '',
      fillRect: jest.fn(),
    })),
    toBuffer: jest.fn(() => Buffer.from('')),
  })),
}));

describe('mermaidRenderer', () => {
  const mockRender = jest.spyOn(require('mermaid').default, 'render');

  beforeEach(() => {
    jest.clearAllMocks();
    mockRender.mockImplementation(() =>
      Promise.resolve({ svg: '<svg viewBox="0 0 100 100"></svg>' })
    );
  });

  afterAll(() => {
    mockRender.mockRestore();
  });

  it('should render mermaid code to buffer', async () => {
    const code = `graph TD
    A[Start] --> B[End]`;

    const buffer = await renderMermaidToBuffer(code);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(require('mermaid').default.initialize).toHaveBeenCalled();
  });

  it('should use default dimensions when viewBox not found', async () => {
    mockRender.mockImplementation(() =>
      Promise.resolve({ svg: '<svg></svg>' })
    );

    const code = `graph TD\nA[Start] --> B[End]`;

    const buffer = await renderMermaidToBuffer(code);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('should use default dimensions when viewBox has invalid parts', async () => {
    mockRender.mockImplementation(() =>
      Promise.resolve({ svg: '<svg viewBox="invalid"></svg>' })
    );

    const code = `graph TD\nA[Start] --> B[End]`;

    const buffer = await renderMermaidToBuffer(code);
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it('should throw error when mermaid render fails', async () => {
    mockRender.mockImplementation(() =>
      Promise.reject(new Error('Invalid mermaid syntax'))
    );

    const code = 'invalid syntax';

    await expect(renderMermaidToBuffer(code)).rejects.toThrow('Invalid mermaid syntax');
  });
});
