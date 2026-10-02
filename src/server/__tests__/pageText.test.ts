import { describe, expect, it } from 'vitest';
import { fetchPageText, htmlToText, isPrivateIp, recipeJsonLd } from '../pageText';

describe('страница по ссылке', () => {
  it('внутренние адреса — нельзя', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['85.159.231.149', '8.8.8.8', '2a00:1450::1']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('локальные и не-http ссылки отклоняются до запроса', async () => {
    await expect(fetchPageText('http://127.0.0.1:3100/task/api/state')).rejects.toThrow();
    await expect(fetchPageText('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(fetchPageText('не ссылка')).rejects.toThrow(/ссылку/);
  });
  it('HTML → текст, рецепт из JSON-LD', () => {
    expect(htmlToText('<p>Борщ&nbsp;<b>вкусный</b></p><script>alert(1)</script>')).toBe('Борщ вкусный');
    expect(recipeJsonLd('<script type="application/ld+json">{"@type":"Recipe","name":"Щи"}</script>')).toContain('Щи');
  });
});
