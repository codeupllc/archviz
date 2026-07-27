export type HclValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'traversal'; path: string[] }
  | { kind: 'list'; values: HclValue[] }
  | { kind: 'null' }
  | { kind: 'raw'; code: string };

export interface HclAttribute {
  name: string;
  value: HclValue;
}

export interface HclBlock {
  blockType: string;
  labels: string[];
  attributes: HclAttribute[];
  blocks: HclBlock[];
  comment?: string;
}

export interface FilePlan {
  files: { path: string; blocks: HclBlock[] }[];
}

export function stringValue(value: string): HclValue {
  return { kind: 'string', value };
}

export function numberValue(value: number): HclValue {
  return { kind: 'number', value };
}

export function boolValue(value: boolean): HclValue {
  return { kind: 'boolean', value };
}

export function traversal(...path: string[]): HclValue {
  return { kind: 'traversal', path };
}

export function listValue(values: HclValue[]): HclValue {
  return { kind: 'list', values };
}

export function nullValue(): HclValue {
  return { kind: 'null' };
}

export function rawValue(code: string): HclValue {
  return { kind: 'raw', code };
}
