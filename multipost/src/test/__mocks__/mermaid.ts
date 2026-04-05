export default {
  initialize: jest.fn(),
  render: jest.fn(() => Promise.resolve({ svg: '<svg viewBox="0 0 100 100"></svg>' })),
};
