<script lang="ts">
	import { Paperclip, Pencil, Trash2 } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { formatBytes } from '$lib/attachment-rules';
	import { uploadable } from '$lib/attachment-upload';
	import { autosize } from '$lib/autosize';
	import AttachButton from '$lib/components/AttachButton.svelte';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import MentionMenu from '$lib/components/MentionMenu.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PriorityPill from '$lib/components/PriorityPill.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import {
		PRIORITIES,
		PRIORITY_LABEL,
		STATUSES,
		STATUS_LABEL,
		colorFor,
		formatDateTime,
		milestoneLabel
	} from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import {
		getAttachments,
		getComments,
		getIssueDetail,
		postComment,
		readIssueNotifications,
		removeAttachment,
		removeComment,
		saveIssue,
		updateComment
	} from './issue.remote';
	import { page } from '$app/state';

	interface Props {
		projectKey: string;
		number: number;
		/** 'sheet' はタイムラインなどの横に出す 1 列表示。削除は詳細ページでだけ行う */
		variant?: 'page' | 'sheet';
		/** 属性の保存に成功したとき（呼び出し側の一覧を取り直すため） */
		onsaved?: () => void;
	}
	let { projectKey, number, variant = 'page', onsaved }: Props = $props();
	const ref = $derived({ key: projectKey, number });
	const me = $derived(page.data.user);
	// 同じページで別の課題に切り替えても入力が混ざらないよう、フォームは課題ごとに分ける
	const save = $derived(saveIssue.for(`${projectKey}-${number}`));
	const post = $derived(postComment.for(`${projectKey}-${number}`));
	// 開いた課題についての自分宛て未読を既読にする
	// コマンドの内部状態を依存に含めないよう、課題が変わったときだけ走らせる
	$effect(() => {
		const { key, number } = ref;
		untrack(() => void readIssueNotifications({ key, number }).catch(() => {}));
	});
	// 2つの query は同時に取得を始め、コメントの更新では課題側を取り直さない
	const detailQuery = $derived(getIssueDetail(ref));
	const commentsQuery = $derived(getComments(ref));
	const attachmentsQuery = $derived(getAttachments(ref));
	const detail = $derived(await detailQuery);
	const comments = $derived(await commentsQuery);
	const attachments = $derived(await attachmentsQuery);
	let commentInput = $state<HTMLTextAreaElement>();
	let descriptionInput = $state<HTMLTextAreaElement>();
	let editCommentInput = $state<HTMLTextAreaElement>();
	const mentionCandidates = $derived(
		detail.assignees.filter((u) => !u.disabled).map(({ id, name }) => ({ id, name }))
	);

	async function deleteAttachment(attachmentId: string) {
		try {
			await removeAttachment({ ...ref, attachmentId });
		} catch {
			failed();
		}
	}
	const issue = $derived(detail.issue);
	const perms = $derived(detail.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
	let editingComment = $state<string | null>(null);
	const attrFormId = $derived(`issue-attributes-${variant}`);

	async function deleteComment(commentId: string) {
		try {
			await removeComment({ ...ref, commentId });
		} catch {
			failed();
		}
	}

	const failed = () => toast.error('エラーが発生しました。時間をおいて再度お試しください');

	// 送信直後に自分のコメントを仮表示し、サーバーの結果で本物に置き換える
	type PendingComment = { id: number; body: string };
	let pendingComments = $state<PendingComment[]>([]);
	let nextPendingId = 0;

	const commentForm = $derived(
		post.enhance(async ({ element, submit }) => {
			const textarea = element.querySelector('textarea')!;
			const body = textarea.value.trim();
			const pending = { id: ++nextPendingId, body };
			pendingComments.push(pending);
			element.reset();
			let ok = false;
			try {
				ok = await submit();
			} catch {
				failed();
			} finally {
				pendingComments = pendingComments.filter((c) => c.id !== pending.id);
			}
			if (!ok && !textarea.value) {
				textarea.value = body;
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			}
		})
	);
</script>

{#snippet attributes()}
	<form
		id={attrFormId}
		class="card"
		style="padding: 20px"
		{...save.enhance(async ({ submit }) => {
			try {
				if (await submit()) {
					editing = false;
					toast.success('保存しました');
					onsaved?.();
				}
			} catch {
				failed();
			}
		})}
	>
		<input {...save.fields.key.as('hidden', ref.key)} />
		<input {...save.fields.number.as('hidden', ref.number)} />
		<h2 class="card-title">属性</h2>
		<div class="prop-list">
			<div class="prop-row">
				<label for="issue-status">ステータス</label>
				<select
					class="select"
					id="issue-status"
					{...save.fields.status.as('select', issue.status)}
					disabled={!perms.changeStatus}
				>
					{#each STATUSES as s (s)}
						<option value={s}>{STATUS_LABEL[s]}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-priority">優先度</label>
				<select
					class="select"
					id="issue-priority"
					{...save.fields.priority.as('select', issue.priority)}
					disabled={!perms.edit}
				>
					{#each PRIORITIES as p (p)}
						<option value={p}>{PRIORITY_LABEL[p]}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-assignee">担当者</label>
				<select
					class="select"
					id="issue-assignee"
					{...save.fields.assigneeId.as('select', issue.assigneeId ?? '')}
					disabled={!perms.assign}
				>
					<option value="">未割当</option>
					{#each detail.assignees as u (u.id)}
						<option value={u.id}>{u.disabled ? `${u.name}（無効）` : u.name}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-category">カテゴリー</label>
				<select
					class="select"
					id="issue-category"
					{...save.fields.categoryId.as('select', issue.categoryId ?? '')}
					disabled={!perms.edit}
				>
					<option value="">未設定</option>
					{#each detail.categories as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-milestone">マイルストーン</label>
				<select
					class="select"
					id="issue-milestone"
					{...save.fields.milestoneId.as('select', issue.milestoneId ?? '')}
					disabled={!perms.edit}
				>
					<option value="">未設定</option>
					{#each detail.milestones as m (m.id)}
						<option value={m.id}>{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-start">開始日</label>
				<input
					class="input"
					id="issue-start"
					{...save.fields.startDate.as('date', issue.startDate ?? '')}
					disabled={!perms.edit}
				/>
			</div>
			<div class="prop-row">
				<label for="issue-due">期限日</label>
				<input
					class="input"
					id="issue-due"
					{...save.fields.dueDate.as('date', issue.dueDate ?? '')}
					disabled={!perms.edit}
				/>
			</div>
		</div>
		{#if canSave || (perms.edit && !editing)}
			<div class="flex flex-wrap items-center gap-2">
				{#if canSave}<button type="submit" class="btn btn-primary">保存</button>{/if}
				{#if perms.edit && !editing}
					<button type="button" class="btn btn-outline btn-sm" onclick={() => (editing = true)}>
						<Pencil />タイトル・本文を編集
					</button>
				{/if}
			</div>
		{:else}
			<p class="hint">この課題の属性は変更できません</p>
		{/if}
	</form>
{/snippet}

<section class="detail" class:sheet={variant === 'sheet'}>
	<div class="grid min-w-0 gap-6">
		<header class="grid gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class="mono text-[13px] text-muted-foreground">{projectKey}-{issue.number}</span>
				<StatusPill status={issue.status} />
				<PriorityPill priority={issue.priority} />
			</div>
			<h1 class="page-title" style="font-size: 22px; text-wrap: pretty">{issue.title}</h1>
			<p class="m-0 text-[13px] text-muted-foreground">
				{issue.reporterName} が {formatDateTime(issue.createdAt)} に起票
			</p>
		</header>

		{#if variant === 'sheet'}{@render attributes()}{/if}

		{#each save.fields.allIssues() ?? [] as i (i.message)}<FormAlert message={i.message} />{/each}

		{#if editing}
			<!-- title/description は右列の属性フォーム(id=issue-attributes)に form 属性で紐づけ、編集中だけ送信される -->
			<div class="card">
				<div class="field">
					<label class="label" for="issue-title">タイトル</label>
					<input
						class="input"
						id="issue-title"
						{...save.fields.title.as('text', issue.title)}
						form={attrFormId}
						required
						maxlength={200}
					/>
				</div>
				<div class="field">
					<label class="label" for="issue-description">本文</label>
					<textarea
						class="textarea autosize"
						id="issue-description"
						{...save.fields.description.as('text', issue.description)}
						form={attrFormId}
						rows="10"
						bind:this={descriptionInput}
						{@attach autosize}
						{@attach uploadable(ref.key)}></textarea>
					<MentionMenu target={() => descriptionInput} candidates={mentionCandidates} />
					<div class="flex items-center gap-2">
						<p class="hint" style="flex: 1">
							Markdown
							が使えます。ファイルは貼り付け・ドロップでも添付できます。右の「保存」で反映されます。
						</p>
						<AttachButton projectKey={ref.key} target={() => descriptionInput} />
					</div>
				</div>
				<div>
					<button type="button" class="btn btn-outline btn-sm" onclick={() => (editing = false)}>
						編集をやめる
					</button>
				</div>
			</div>
		{:else}
			<div class="card body">
				{#if issue.description}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
					<div class="markdown">{@html issue.descriptionHtml}</div>
				{:else}
					<p class="m-0 text-muted-foreground">本文はありません</p>
				{/if}
			</div>
		{/if}

		{#if attachments.length > 0}
			<section class="card attachments" aria-label="添付ファイル">
				<h2 class="card-title">
					<Paperclip class="size-4" /> 添付ファイル数: {attachments.length}
				</h2>
				<ul>
					{#each attachments as a (a.id)}
						<li>
							<a
								href={a.url}
								target={a.isImage ? '_blank' : undefined}
								rel="noopener"
								download={a.isImage ? undefined : a.filename}>{a.filename}</a
							>
							<span class="text-xs text-muted-foreground"
								>{formatBytes(a.size)} · {a.uploaderName} · {formatDateTime(a.createdAt)}</span
							>
							{#if a.canDelete}
								<ConfirmAction
									onconfirm={() => deleteAttachment(a.id)}
									title="添付ファイルの削除"
									description={`「${a.filename}」を削除してよろしいですか？\n本文やコメントからも表示できなくなります。`}
									confirmLabel="添付ファイルを削除する"
									triggerClass="icon-btn danger-hover ml-auto"
									triggerLabel={`${a.filename} を削除`}
								>
									{#snippet trigger()}<Trash2 />{/snippet}
								</ConfirmAction>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="grid gap-4">
			<h2 class="m-0 text-base font-bold">
				コメント <span class="font-medium text-muted-foreground"
					>{comments.length + pendingComments.length}</span
				>
			</h2>
			{#if comments.length + pendingComments.length === 0}
				<p class="m-0 text-muted-foreground">まだコメントはありません</p>
			{/if}
			{#each comments as c (c.id)}
				<article class="comment" id={`comment-${c.id}`}>
					<span class="avatar" style:--c={colorFor(c.authorName)}>{c.authorName[0]}</span>
					<div class="grid min-w-0 gap-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{c.authorName}</span>
							<span class="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
							{#if c.canModify}
								<div class="ml-auto flex items-center">
									<button
										type="button"
										class="icon-btn"
										aria-label="コメントを編集"
										title="コメントを編集"
										aria-expanded={editingComment === c.id}
										onclick={() => (editingComment = editingComment === c.id ? null : c.id)}
									>
										<Pencil />
									</button>
									<ConfirmAction
										onconfirm={() => deleteComment(c.id)}
										title="コメントの削除"
										description="このコメントを削除してよろしいですか？&#10;この操作は元に戻せません。"
										confirmLabel="コメントを削除する"
										triggerClass="icon-btn danger-hover"
										triggerLabel="コメントを削除"
									>
										{#snippet trigger()}<Trash2 />{/snippet}
									</ConfirmAction>
								</div>
							{/if}
						</div>
						{#if editingComment === c.id}
							{@const edit = updateComment.for(c.id)}
							<form
								class="grid gap-2"
								{...edit.enhance(async ({ submit }) => {
									try {
										if (await submit()) editingComment = null;
									} catch {
										failed();
									}
								})}
							>
								{#each edit.fields.allIssues() ?? [] as i (i.message)}<FormAlert
										message={i.message}
									/>{/each}
								<input {...edit.fields.key.as('hidden', ref.key)} />
								<input {...edit.fields.number.as('hidden', ref.number)} />
								<input {...edit.fields.commentId.as('hidden', c.id)} />
								<textarea
									class="textarea autosize"
									{...edit.fields.body.as('text', c.body)}
									rows="4"
									required
									aria-label="コメントを編集"
									bind:this={editCommentInput}
									{@attach autosize}
									{@attach uploadable(ref.key)}></textarea>
								<MentionMenu target={() => editCommentInput} candidates={mentionCandidates} />
								<div class="flex justify-end gap-2">
									<button
										type="button"
										class="btn btn-outline btn-sm"
										onclick={() => (editingComment = null)}>キャンセル</button
									>
									<button type="submit" class="btn btn-primary btn-sm">更新</button>
								</div>
							</form>
						{:else}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
							<div class="markdown">{@html c.html}</div>
						{/if}
					</div>
				</article>
			{/each}
			{#each pendingComments as c (c.id)}
				<article class="comment pending" aria-busy="true">
					<span class="avatar" style:--c={colorFor(me?.name ?? '')}>{me?.name[0]}</span>
					<div class="grid min-w-0 gap-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{me?.name}</span>
							<span class="text-xs text-muted-foreground">送信中…</span>
						</div>
						<p class="pending-body">{c.body}</p>
					</div>
				</article>
			{/each}
			{#if perms.writable}
				<form {...commentForm} class="new-comment">
					<input {...post.fields.key.as('hidden', ref.key)} />
					<input {...post.fields.number.as('hidden', ref.number)} />
					<label class="label" for="new-comment">コメントを追加</label>
					{#each post.fields.allIssues() ?? [] as i (i.message)}<FormAlert
							message={i.message}
						/>{/each}
					<textarea
						class="textarea autosize"
						id="new-comment"
						{...post.fields.body.as('text')}
						rows="3"
						required
						bind:this={commentInput}
						{@attach autosize}
						{@attach uploadable(ref.key)}></textarea>
					<MentionMenu target={() => commentInput} candidates={mentionCandidates} />
					<div class="flex items-center justify-end gap-2">
						<AttachButton projectKey={ref.key} target={() => commentInput} />
						<button type="submit" class="btn btn-primary">コメントする</button>
					</div>
				</form>
			{/if}
		</section>
	</div>

	{#if variant === 'page'}
		<aside class="side">
			{@render attributes()}
			{#if perms.delete}
				<ConfirmAction
					action="?/delete"
					title="課題の削除"
					description="この課題を削除してよろしいですか？&#10;この操作は元に戻せません。"
					confirmLabel="課題を削除する"
					triggerClass="btn btn-danger w-full"
				>
					{#snippet trigger()}<Trash2 />課題を削除{/snippet}
				</ConfirmAction>
			{/if}
		</aside>
	{/if}
</section>

<style>
	.detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}
	.side {
		display: grid;
		gap: 16px;
	}
	@media (min-width: 1100px) {
		.detail:not(.sheet) {
			grid-template-columns: minmax(0, 1fr) 300px;
		}
		.side {
			position: sticky;
			top: 80px;
		}
	}
	.body {
		padding: 20px 24px;
	}
	@media (min-width: 560px) {
		.sheet .prop-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 20px;
		}
	}
	.comment {
		scroll-margin-top: 80px;
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: 12px;
	}
	.comment:target {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.comment :global(.danger-hover:hover) {
		color: var(--destructive);
	}
	.comment.pending {
		opacity: 0.6;
	}
	.pending-body {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.new-comment {
		display: grid;
		gap: 8px;
		padding-top: 20px;
		border-top: 1px solid var(--border);
	}
	.attachments ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.attachments li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		min-width: 0;
	}
	.attachments li a {
		overflow-wrap: anywhere;
	}
</style>
