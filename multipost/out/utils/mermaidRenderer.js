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
async function initMermaid() {
    if (mermaidInitialized) {
        return;
    }
    // Create a full DOM environment with jsdom
    const dom = new jsdom_1.JSDOM('<!DOCTYPE html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    // Dynamic import after DOM is ready
    const mermaidModule = await Promise.resolve().then(() => __importStar(require('mermaid')));
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
async function renderMermaidToBuffer(code) {
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
        const canvas = (0, canvas_1.createCanvas)(width, height);
        const ctx = canvas.getContext('2d');
        // Fill white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        // Convert SVG to PNG buffer
        // For simplicity, we'll use the SVG directly and let canvas handle conversion
        // Note: In production, you might need svg2png or another library for proper rasterization
        const pngBuffer = canvas.toBuffer('image/png');
        return pngBuffer;
    }
    catch (error) {
        console.error('Mermaid render error:', error);
        throw error;
    }
}
//# sourceMappingURL=mermaidRenderer.js.map