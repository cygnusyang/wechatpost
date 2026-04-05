export const JSDOM = jest.fn(() => ({
  window: {},
  document: {
    createElement: jest.fn(),
  },
  navigator: {},
}));
