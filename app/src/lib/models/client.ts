import { Json } from '@generated/anki/generic_pb';
import { postProto } from '@generated/post';
export type Preferences = { endpoint: string; embedding: string; vision: string; matchSensitivity: number };
export type Model = { name: string; size: number | null; runtime: string; capabilities: string[]; capabilitiesKnown: boolean };
export type Job = { state: 'running' | 'cancelling' | 'cancelled' | 'complete' | 'failed'; model: string; status: string; completed: number; total: number };
export async function modelCall<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const result = await postProto('klausModels', new Json({ json: new TextEncoder().encode(JSON.stringify({ action, ...data })) }), Json, { alertOnError: false });
  return JSON.parse(new TextDecoder().decode(result.json)) as T;
}
export const capabilityLabel = (capability: string): string => ({ completion: 'Text', embedding: 'Card matching', vision: 'Images', tools: 'Tools', thinking: 'Reasoning' }[capability] ?? capability);
export function sizeLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'Size unavailable';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
