import { describe, expect, it } from 'vitest';
import { extractText } from './readable';

describe('extractText', () => {
  it('strips tags and scripts, keeps visible text', () => {
    const html = `
      <!DOCTYPE html><html><head><title>Ignored</title>
      <style>body{color:red}</style></head>
      <body>
        <nav>Home About</nav>
        <script>const x = 1;</script>
        <article><p>Haaland scored <b>twice</b> as City won 3&ndash;1.</p></article>
        <footer>Copyright</footer>
      </body>`;
    const text = extractText(html);
    expect(text).toContain('Haaland scored twice as City won 3–1.');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('const x');
    expect(text).not.toContain('Home About');
  });

  it('collapses whitespace and decodes entities', () => {
    expect(extractText('<p>a&nbsp;&amp;&nbsp;b</p>')).toBe('a & b');
  });
});
