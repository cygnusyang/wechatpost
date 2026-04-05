// Simple mock for unified
export function unified() {
  return {
    use: jest.fn().mockReturnThis(),
    process: jest.fn(async () => ({
      toString: () => '<html></html>',
    })),
  };
}

export default unified;
