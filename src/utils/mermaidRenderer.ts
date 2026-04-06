import { createCanvas } from 'canvas';
import { JSDOM } from 'jsdom';

// mermaid requires a DOM environment, which we need to provide in Node.js
// We'll dynamically initialize it only when needed

let mermaidInstance: any;
let mermaidInitialized = false;

function log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] [mermaid] ${message}`;
  if (level === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

async function initMermaid(): Promise<void> {
  if (mermaidInitialized) {
    log('Mermaid already initialized');
    return;
  }

  log('Starting mermaid initialization...');
  try {
    // Create a full DOM environment with jsdom
    log('Creating JSDOM environment...');
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window as any;
    global.document = dom.window.document;
    // 不直接设置 global.navigator，而是使用 Object.defineProperty 来避免只读属性错误
    Object.defineProperty(global, 'navigator', {
      value: dom.window.navigator,
      configurable: true,
      writable: true
    });
    log('JSDOM global objects set up');

    // Dynamic import after DOM is ready
    log('Dynamically importing mermaid module...');
    const mermaidModule = await import('mermaid');
    mermaidInstance = mermaidModule.default;
    const mermaidVersion = (mermaidModule as any).version || (mermaidModule.default as any)?.version || 'unknown';
    log(`Mermaid module imported: version ${mermaidVersion}`);

    mermaidInstance.initialize({
      startOnLoad: false,
      theme: 'default',
      flowchart: {
        useMaxWidth: true,
      },
    });
    log('Mermaid initialized successfully');

    mermaidInitialized = true;
  } catch (error) {
    log(`Mermaid initialization failed: ${(error as Error).message}`, 'error');
    if (error instanceof Error && error.stack) {
      log(`Stack: ${error.stack}`, 'error');
    }
    throw error;
  }
}

export async function renderMermaidToBuffer(code: string): Promise<Buffer> {
  log(`Rendering mermaid diagram, code length: ${code.length} characters`);
  await initMermaid();
  try {
    // Get SVG from mermaid
    log('Calling mermaid.render...');
    const { svg } = await mermaidInstance.render('mermaid-diagram', code);
    log(`Mermaid render complete, SVG length: ${svg.length} characters`);

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
    log(`Calculated dimensions: ${width}x${height}`);

    // Create canvas and draw SVG
    log(`Creating canvas: ${width}x${height}`);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Convert SVG to PNG buffer
    const pngBuffer = canvas.toBuffer('image/png');
    log(`PNG buffer generated: ${pngBuffer.length} bytes`);
    return pngBuffer;
  } catch (error) {
    log(`Mermaid render error: ${(error as Error).message}`, 'error');
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, 'error');
    }
    throw error;
  }
}
