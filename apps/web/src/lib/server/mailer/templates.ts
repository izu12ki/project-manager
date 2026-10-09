export function invitationMail(p: {
	url: string;
	inviterName: string;
	projectName: string | null;
}) {
	const where = p.projectName ? `「${p.projectName}」` : 'Project Manager';
	const whereEn = p.projectName ? `"${p.projectName}"` : 'Project Manager';
	return {
		subject: `${where}に招待されました / You are invited to ${whereEn}`,
		text: [
			`${p.inviterName} さんから${where}に招待されました。`,
			'次のリンクを開き、名前とパスワードを設定してください（有効期限 7 日）。',
			p.url,
			'',
			'---',
			'',
			`${p.inviterName} invited you to ${whereEn}.`,
			'Open the link below to set your name and password (expires in 7 days).',
			p.url
		].join('\n')
	};
}

export function resetPasswordMail(p: { url: string }) {
	return {
		subject: 'パスワードの再設定 / Reset your password',
		text: [
			'次のリンクからパスワードを再設定してください（有効期限 1 時間）。',
			'心当たりがない場合はこのメールを無視してください。',
			p.url,
			'',
			'---',
			'',
			'Use the link below to reset your password (expires in 1 hour).',
			'If you did not request this, you can ignore this email.',
			p.url
		].join('\n')
	};
}
