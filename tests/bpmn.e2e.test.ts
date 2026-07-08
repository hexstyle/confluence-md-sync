/**
 * Real BPMN → PNG conversion through headless Chromium.
 * Requires the optional peer dep: npm i --no-save bpmn-to-image
 * Run with: BPMN_E2E=1 npm test
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertBpmnFolder } from '../src/bpmn/convert.js';
import { fileSha256 } from '../src/attachments/hash.js';

const MINIMAL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    id="defs" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="proc" isExecutable="false">
    <bpmn:startEvent id="start" name="Начало"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="d1">
    <bpmndi:BPMNPlane id="p1" bpmnElement="proc">
      <bpmndi:BPMNShape id="s1" bpmnElement="start">
        <dc:Bounds x="100" y="100" width="36" height="36"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe.skipIf(!process.env.BPMN_E2E)('convertBpmnFolder (e2e)', () => {
  it('converts bpmn to png and writes src-sha256 sidecar', async () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'bpmn-src-'));
    const outDir = mkdtempSync(join(tmpdir(), 'bpmn-out-'));
    writeFileSync(join(srcDir, 'flow.bpmn'), MINIMAL_BPMN);

    const converted = await convertBpmnFolder({ srcDir, outDir });

    expect(converted).toHaveLength(1);
    const png = join(outDir, 'flow.png');
    expect(converted[0].output).toBe(png);
    expect(statSync(png).size).toBeGreaterThan(1000);
    // PNG magic bytes
    expect(readFileSync(png).subarray(1, 4).toString()).toBe('PNG');
    // sidecar contains sha256 of the SOURCE bpmn
    expect(readFileSync(png + '.src-sha256', 'utf-8').trim()).toBe(
      fileSha256(join(srcDir, 'flow.bpmn')),
    );
  }, 120_000);
});
