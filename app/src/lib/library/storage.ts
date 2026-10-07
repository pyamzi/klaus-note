import { Json } from '@generated/anki/generic_pb';
import { LibraryFile } from '@generated/klaus_pb';
import { postProto } from '@generated/post';

export type LibraryEntry = { path: string; name: string; kind: 'folder' | 'pdf'; size: number; modified: number };
export type LibraryListing = { rootLabel: string; path: string; entries: LibraryEntry[] };
const encoder = new TextEncoder();
async function json<T>(method: string, value: unknown): Promise<T> {
  const result = await postProto(method, new Json({ json: encoder.encode(JSON.stringify(value)) }), Json, { alertOnError: false });
  return JSON.parse(new TextDecoder().decode(result.json));
}
export const listFolder = (path = '') => json<LibraryListing>('klausLibraryList', { path });
export const createFolder = (path: string, name: string) => json<{ path: string }>('klausLibraryFolder', { path, name });
export async function importPdf(path: string, file: File) {
  if (file.size > 128 * 1024 * 1024) throw new Error(`${file.name} exceeds the 128 MiB PDF limit.`);
  return postProto('klausLibraryImport', new LibraryFile({ path, name: file.name, data: new Uint8Array(await file.arrayBuffer()) }), LibraryFile, { alertOnError: false });
}
export async function readPdf(path: string, signal?: AbortSignal) {
  return (await postProto('klausLibraryRead', new LibraryFile({ path }), LibraryFile, { alertOnError: false, signal })).data;
}
