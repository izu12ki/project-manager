import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	/** 1 以上の整数（先頭ゼロなし） */
	int: (param) => (/^[1-9]\d*$/.test(param) ? Number(param) : undefined)
});
