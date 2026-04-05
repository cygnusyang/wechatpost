import { unified } from 'unified';
import parse from 'remark-parse';
import gfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { renderMermaidToBuffer } from './mermaidRenderer';
import { WeChatService } from '../services/WeChatService';

/**
 * Process markdown for upload to WeChat, including Mermaid diagram rendering
 */
export async function processMarkdownForUpload(
  markdown: string,
  weChatService: WeChatService
): Promise<{ html: string; errors: string[] }> {
  const errors: string[] = [];

  // Process mermaid blocks before unified processing
  const processedMarkdown = await processMermaidBlocks(markdown, weChatService, errors);

  const processor = unified()
    .use(parse)
    .use(gfm)
    .use(remarkRehype)
    .use(rehypeHighlight)
    .use(rehypeStringify);

  const file = await processor.process(processedMarkdown);
  const html = String(file);

  return { html, errors };
}

/**
 * Find and process all mermaid code blocks, render them and upload them
 */
async function processMermaidBlocks(
  markdown: string,
  weChatService: WeChatService,
  errors: string[]
): Promise<string> {
  // Find all mermaid code blocks
  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)\n```/g;
  let processed = markdown;
  let match: RegExpExecArray | null;

  while ((match = mermaidRegex.exec(markdown)) !== null) {
    const mermaidCode = match[1];

    try {
      const buffer = await renderMermaidToBuffer(mermaidCode);
      const result = await weChatService.uploadImage(buffer, `mermaid-${Date.now()}.png`);

      if (result.success && result.cdnUrl) {
        // Replace code block with image
        processed = processed.replace(match[0], `![Mermaid diagram](${result.cdnUrl})`);
      } else {
        errors.push(`Failed to upload Mermaid diagram: ${result.error}`);
      }
    } catch (error) {
      errors.push(`Failed to render Mermaid diagram: ${(error as Error).message}`);
    }
  }

  return processed;
}
