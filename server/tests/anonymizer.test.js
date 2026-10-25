// server/tests/anonymizer.test.js
import { describe, it, expect } from 'vitest';
import { anonymizeCounterparty } from '../src/utils/anonymizer.js';

describe('Модуль обезличивания данных (Anonymizer)', () => {
  it('должен корректно маскировать наименование и ИНН', () => {
    const result = anonymizeCounterparty('ООО ТехноПром', '7712345678');
    
    expect(result.name).toBe('ОО***');
    expect(result.inn).toBe('77******78');
  });
});