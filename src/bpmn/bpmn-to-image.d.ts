declare module 'bpmn-to-image' {
  export interface Conversion {
    input: string;
    outputs: string[];
  }
  export function convertAll(conversions: Conversion[]): Promise<void>;
}
