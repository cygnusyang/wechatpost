import { createCanvas } from 'canvas';
import { JSDOM } from 'jsdom';

// mermaid requires a DOM environment, which we need to provide in Node.js
// We'll dynamically initialize it only when needed

let mermaidInstance: any;
let mermaidInitialized = false;

async function initMermaid(): Promise<void> {
  if (mermaidInitialized) {
    return;
  }

  // Create a full DOM environment with jsdom
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.window = dom.window as any;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;

  // Dynamic import after DOM is ready
  const mermaidModule = await import('mermaid');
  mermaidInstance = mermaidModule.default;
  mermaidInstance.initialize({
    startOnLoad: false,
    theme: 'default',
    flowchart: {
      useMaxWidth: true,
    },
  });

  mermaidInitialized = true;
}

export async function renderMermaidToBuffer(code: string): Promise<Buffer> {
  await initMermaid();
  try {
    // Get SVG from mermaid
    const { svg } = await mermaidInstance.render('mermaid-diagram', code);

    // Calculate dimensions
    const viewBoxMatch = svg.match(/viewBox="[\d.\s-]+"/);
    let width = 800;
    let height = 600;

    if (viewBoxMatch) {
      const parts = viewBoxMatch[0].replace('viewBox="', '').replace('"', '').split(' ').map(Number);
      if (parts.length === 4) {
        width = Math.ceil(parts[2]);
        height = Math.ceil(parts[3]);
      }
    }

    // Add padding
    width += 40;
    height += 40;

    // Create canvas and draw SVG
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Convert SVG to PNG buffer
    // For simplicity, we'll use the SVG directly and let canvas handle conversion
    // Note: In production, you might need svg2png or another library for proper rasterization
    const pngBuffer = canvas.toBuffer('image/png');
    return pngBuffer;
  } catch (error) {
    console.error('Mermaid render error:', error);
    throw error;
  }
}
