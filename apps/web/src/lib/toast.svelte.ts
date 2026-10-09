import { untrack } from 'svelte';

export type Toast = { id: number; message: string; type: 'success' | 'error' };

let nextId = 0;

export const toasts = $state<Toast[]>([]);

function push(message: string, type: Toast['type']) {
	const id = ++nextId;
	// $effect 内から呼ばれても toasts を依存に含めない（含めると表示のたびに再実行される）
	untrack(() => toasts.push({ id, message, type }));
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, 3500);
}

export const toast = {
	success: (message: string) => push(message, 'success'),
	error: (message: string) => push(message, 'error')
};
