import type { Attachment } from 'svelte/attachments';

/**
 * 入力に合わせて textarea の高さを伸縮させる（GitHub のコメント欄風）。
 * rows が最小の高さになり、CSS の max-height を超えるとスクロールに切り替わる。
 * value をコードから書き換えたときは input イベントを dispatch すると追従する。
 */
export const autosize: Attachment<HTMLTextAreaElement> = (el) => {
	const fit = () => {
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
	};
	// form.reset() は input を発火しないので、値が戻った後に測り直す
	const onReset = () => requestAnimationFrame(fit);
	const form = el.form;
	fit();
	el.addEventListener('input', fit);
	form?.addEventListener('reset', onReset);
	return () => {
		el.removeEventListener('input', fit);
		form?.removeEventListener('reset', onReset);
		el.style.height = '';
	};
};
