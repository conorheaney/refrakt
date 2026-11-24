import { validateWorld, type AuthoredWorld } from '../../src/content/authoredWorlds';

/** A world in the game folder; `modified`: when it was last saved (ms since 1970). */
export interface WorldFile { filename: string; revision: string; modified: number; world: AuthoredWorld }
export interface SavedFile { filename: string; revision: string; backup: string; complete: boolean }
const endpoint = new URL('../__world-files', document.baseURI);

async function request(body?: unknown): Promise<unknown> {
  const response = await fetch(endpoint, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => { throw new Error('Folder access is unavailable. Open the editor through npm run dev or npm run preview.'); });
  if (!response.ok) throw new Error(result.error ?? 'World folder request failed.');
  return result;
}

export async function listWorldFiles(): Promise<{ worlds: WorldFile[]; warnings: string[] }> {
  const result = await request() as { worlds: WorldFile[]; warnings: string[] };
  if (!Array.isArray(result.worlds) || !Array.isArray(result.warnings)) throw new Error('Folder access is unavailable. Open the editor through npm run dev or npm run preview.');
  return { ...result, worlds: result.worlds.map((entry) => ({ ...entry, world: validateWorld(entry.world) })) };
}

export async function saveWorldFile(world: AuthoredWorld, file: Pick<WorldFile, 'filename' | 'revision'> | null): Promise<SavedFile> {
  return await request({ filename: file?.filename ?? null, revision: file?.revision ?? null, world: validateWorld(world) }) as SavedFile;
}
