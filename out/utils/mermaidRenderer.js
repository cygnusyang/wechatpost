"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMermaidToBuffer = renderMermaidToBuffer;
const canvas_1 = require("canvas");
const jsdom_1 = require("jsdom");
// mermaid requires a DOM environment, which we need to provide in Node.js
// We'll dynamically initialize it only when needed
let mermaidInstance;
let mermaidInitialized = false;
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [mermaid] ${message}`;
    if (level === 'error') {
        console.error(logMessage);
    }
    else {
        console.log(logMessage);
    }
}
async function initMermaid() {
    if (mermaidInitialized) {
        log('Mermaid already initialized');
        return;
    }
    log('Starting mermaid initialization...');
    try {
        // Create a full DOM environment with jsdom
        log('Creating JSDOM environment...');
        const dom = new jsdom_1.JSDOM('<!DOCTYPE html><html><body></body></html>');
        global.window = dom.window;
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
        const mermaidModule = await Promise.resolve().then(() => __importStar(require('mermaid')));
        mermaidInstance = mermaidModule.default;
        const mermaidVersion = mermaidModule.version || mermaidModule.default?.version || 'unknown';
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
    }
    catch (error) {
        log(`Mermaid initialization failed: ${error.message}`, 'error');
        if (error instanceof Error && error.stack) {
            log(`Stack: ${error.stack}`, 'error');
        }
        throw error;
    }
}
async function renderMermaidToBuffer(code) {
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
        const canvas = (0, canvas_1.createCanvas)(width, height);
        const ctx = canvas.getContext('2d');
        // Fill white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        // Convert SVG to PNG buffer
        const pngBuffer = canvas.toBuffer('image/png');
        log(`PNG buffer generated: ${pngBuffer.length} bytes`);
        return pngBuffer;
    }
    catch (error) {
        log(`Mermaid render error: ${error.message}`, 'error');
        if (error instanceof Error && error.stack) {
            log(`Stack trace: ${error.stack}`, 'error');
        }
        throw error;
    }
}
//# sourceMappingURL=mermaidRenderer.js.map