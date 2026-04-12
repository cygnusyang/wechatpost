const MarkdownIt = require('markdown-it');
const md = new MarkdownIt({
  breaks: true,
  linkify: true,
});

// 测试代码块解析
const testCases = [
  '```typescript\nfunction hello() {\n  console.log("Hello");\n  return "World";\n}\n```',
  '```\nfunction test() {\n  return 123;\n}\n```',
  '`inline code`'
];

console.log('=== MarkdownIt 代码块解析测试 ===\n');

testCases.forEach((testCode, index) => {
  console.log(`--- 测试 ${index + 1} ---\n`);
  
  const html = md.render(testCode);
  console.log('原始 Markdown:');
  console.log(testCode);
  console.log('\n');
  
  console.log('解析后的 HTML:');
  console.log(html);
  console.log('\n');
  
  // 检查代码块内容
  const codeBlocks = [];
  const preMatch = html.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
  if (preMatch) {
    const codeContent = preMatch[1];
    console.log('代码块内容:');
    console.log(codeContent);
    console.log('\n');
    
    console.log('字符统计:');
    console.log('代码长度:', codeContent.length);
    console.log('包含换行符:', codeContent.includes('\n'));
    console.log('包含<br>:', codeContent.includes('<br'));
    
    // 显示详细的字符信息
    console.log('\n字符详情:');
    for (let i = 0; i < codeContent.length; i++) {
      const char = codeContent[i];
      const charCode = char.charCodeAt(0);
      let description = char;
      
      if (char === '\n') {
        description = '\\n';
      } else if (char === '\r') {
        description = '\\r';
      } else if (char === '\t') {
        description = '\\t';
      } else if (char === ' ') {
        description = ' ';
      }
      
      process.stdout.write(`[${i}]: ${charCode} (${description}) `);
      if ((i + 1) % 10 === 0) {
        console.log();
      }
    }
  }
  
  console.log('\n');
});
