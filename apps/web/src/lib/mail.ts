/**
 * Cloudflare Email Sending は Workers の無料プランだと、Cloudflare アカウントで確認した宛先にしか送れない
 * （それ以外は E_RECIPIENT_PLAN_RESTRICTED で失敗する）。招待の画面やユーザーの取り込みの結果に出す
 */
export const MAIL_PLAN_RESTRICTED =
	'Cloudflare Email Sending は Workers の無料プランだと、Cloudflare アカウントに登録して確認したアドレス（Email Routing の Destination addresses）にしか送れません';
