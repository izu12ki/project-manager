import { json } from '@sveltejs/kit';
import { MAX_ATTACHMENT_BYTES, TOO_LARGE_MESSAGE } from '$lib/attachment-rules';
import { appContext } from '$lib/server/context';
import { AppError } from '$lib/server/errors';
import { runCommand } from '$lib/server/remote-helpers';
import { uploadAttachment } from '$lib/server/services/attachments';
import type { RequestHandler } from './$types';

// multipart の境界やヘッダの分の余裕
const MULTIPART_OVERHEAD = 64 * 1024;

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const ctx = appContext(locals);
	// runCommand: 権限・存在エラーは 404、それ以外はメッセージ付きの HTTP エラー
	return runCommand(async () => {
		const length = Number(request.headers.get('content-length') ?? 0);
		if (length > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD) {
			throw new AppError('validation', TOO_LARGE_MESSAGE);
		}
		const file = (await request.formData()).get('file');
		if (!(file instanceof File)) throw new AppError('validation', 'ファイルを選択してください');
		return json(await uploadAttachment(ctx, params.key, file), { status: 201 });
	});
};
