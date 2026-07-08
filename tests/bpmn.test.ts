import { describe, expect, it } from 'vitest';
import { bpmnOutputName, isBpmnFile } from '../src/bpmn/convert.js';
import { renameImagePlaceholders } from '../src/markdown/render.js';

describe('bpmn helpers', () => {
  it('detects bpmn files case-insensitively', () => {
    expect(isBpmnFile('docs/p1.bpmn')).toBe(true);
    expect(isBpmnFile('docs/P1.BPMN')).toBe(true);
    expect(isBpmnFile('docs/p1.png')).toBe(false);
  });

  it('maps output names per format', () => {
    expect(bpmnOutputName('docs/flow.bpmn')).toBe('flow.png');
    expect(bpmnOutputName('flow.bpmn', 'svg')).toBe('flow.svg');
  });
});

describe('renameImagePlaceholders', () => {
  it('renames only mapped image placeholders', () => {
    const md = '{{img:p1.bpmn}} {{img:other.png}} {{file:p1.bpmn}}';
    const out = renameImagePlaceholders(md, new Map([['p1.bpmn', 'p1.png']]));
    expect(out).toBe('{{img:p1.png}} {{img:other.png}} {{file:p1.bpmn}}');
  });

  it('is a no-op for empty map', () => {
    expect(renameImagePlaceholders('{{img:a.bpmn}}', new Map())).toBe('{{img:a.bpmn}}');
  });
});
