import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode } from '../src/code-highlighting.ts';

test('requested languages and common aliases highlight syntax without changing code', () => {
  const cases = [
    ['docker', 'FROM python:3.12\nRUN echo "hello"'],
    ['Dockerfile', 'FROM nginx:alpine'],
    ['bash', '# comment\nexport NAME="value"\necho "$NAME"'],
    ['sh', 'echo "hello"'],
    ['python', 'def greet(name):\n    print("hello", name)'],
    ['nginx', 'server {\n    listen 80;\n    proxy_pass http://app:8080;\n}'],
    ['yaml', 'services:\n  app:\n    image: nginx'],
    ['json', '{"enabled": true}'],
  ];
  for (const [language, code] of cases) {
    const html = highlightCode(code, language);
    assert.match(html, /class="token /, language);
    const plain = html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(plain, code, language);
  }
});

test('unknown, empty and inherited property language names render literal HTML safely', () => {
  for (const language of ['unknown', '', 'text', '__proto__', 'constructor']) {
    const html = highlightCode('<script>alert("x")</script> & x', language);
    assert.ok(!html.includes('<script>'));
    assert.equal(html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'), '<script>alert("x")</script> & x');
  }
});
