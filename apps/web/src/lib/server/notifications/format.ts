import { mentionsToPlain } from '$lib/mentions';

/** 通知・Webhook 用に Markdown をプレーンな 1 行にして max 文字で切る */
export function excerpt(markdown: string, max: number): string {
	const plain = mentionsToPlain(markdown)
		.replace(/```[^\n]*\n?/g, ' ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/gm, '')
		.replace(/(\*\*|__|~~|`)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const chars = Array.from(plain);
	return chars.length > max ? chars.slice(0, max).join('') + '…' : plain;
}
