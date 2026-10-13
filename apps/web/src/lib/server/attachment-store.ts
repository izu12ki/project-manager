/** R2Bucket のうちアプリが使う部分。本番は env.BUCKET をそのまま渡す。 */
export interface AttachmentStore {
	put(
		key: string,
		value: Blob,
		options: { httpMetadata: { contentType: string } }
	): Promise<unknown>;
	get(key: string): Promise<{ body: ReadableStream } | null>;
	delete(keys: string | string[]): Promise<void>;
}

/** テスト用。objects で保存内容を確認できる。 */
export function createMemoryStore(): AttachmentStore & { objects: Map<string, Blob> } {
	const objects = new Map<string, Blob>();
	return {
		objects,
		put: async (key, value) => {
			objects.set(key, value);
			return null;
		},
		get: async (key) => {
			const blob = objects.get(key);
			return blob ? { body: blob.stream() } : null;
		},
		delete: async (keys) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k);
		}
	};
}
