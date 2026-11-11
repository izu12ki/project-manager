<script lang="ts">
	import {
		Calendar,
		CalendarClock,
		CircleCheck,
		CircleDot,
		Copy,
		CornerLeftUp,
		Flag,
		ListTree,
		Milestone,
		Paperclip,
		Pencil,
		Plus,
		Tag,
		Trash2,
		UsersRound,
		X
	} from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { formatBytes } from '#lib/attachment-rules.ts';
	import CommentReactions from '#lib/components/CommentReactions.svelte';
	import ConfirmAction from '#lib/components/ConfirmAction.svelte';
	import MarkdownEditor from '#lib/components/MarkdownEditor.svelte';
	import MultiSelect from '#lib/components/MultiSelect.svelte';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import PriorityPill from '#lib/components/PriorityPill.svelte';
	import ReactionPicker from '#lib/components/ReactionPicker.svelte';
	import StatusPill from '#lib/components/StatusPill.svelte';
	import {
		DONE_STATUS,
		ISSUE_CHANGE_FIELD_LABEL,
		PRIORITIES,
		PRIORITY_LABEL,
		RESOLUTIONS,
		RESOLUTION_LABEL,
		colorFor,
		formatDateTime,
		milestoneLabel
	} from '#lib/labels.ts';
	import { toggleReactionIn } from '#lib/reactions.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import {
		getAttachments,
		getChanges,
		getComments,
		getIssueDetail,
		postComment,
		reactToComment,
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
	// 同じページで別の課題に切り替えても入力が混ざらないよう、フォームは課題ごとに分ける。
	// 保存のたびにも作り直す。フォームは一度入力した項目の値を持ち続け、後でボードなどで
	// 変わっても表示が追いつかないため
	let saves = $state(0);
	const save = $derived(saveIssue.for(`${projectKey}-${number}-${saves}`));
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
	const changesQuery = $derived(getChanges(ref));
	const attachmentsQuery = $derived(getAttachments(ref));
	const detail = $derived(await detailQuery);
	const comments = $derived(await commentsQuery);
	const changes = $derived(await changesQuery);
	// コメントと編集履歴を時刻順に並べる
	const activity = $derived(
		[
			...comments.map((c) => ({ kind: 'comment' as const, id: c.id, at: c.createdAt, c })),
			...changes.map((h) => ({ kind: 'change' as const, id: h.id, at: h.createdAt, h }))
		].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
	);
	const attachments = $derived(await attachmentsQuery);
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
	/** 属性フォームの各項目の、表示中の課題での値（入力の初期値と、変えたかどうかの比較に使う） */
	const shown = $derived({
		title: issue.title,
		description: issue.description,
		typeId: issue.typeId ?? '',
		status: issue.status,
		resolution: issue.resolution ?? '',
		priority: issue.priority,
		parentNumber: issue.parent ? String(issue.parent.number) : '',
		milestoneId: issue.milestoneId ?? '',
		startDate: issue.startDate ?? '',
		dueDate: issue.dueDate ?? ''
	});
	const perms = $derived(detail.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
	/** 差分を開いている履歴（差分の計算は開いたときだけ行う） */
	const openDiffs = new SvelteSet<string>();
	let editingComment = $state<string | null>(null);
	const attrFormId = $derived(`issue-attributes-${variant}`);
	// チェックボックスを送る name（リモートフォームの配列フィールド）
	const assigneeName = $derived(save.fields.assigneeIds.as('checkbox', 'x').name);
	const categoryName = $derived(save.fields.categoryIds.as('checkbox', 'x').name);
	const issueHref = (n: number) => `/projects/${projectKey}/issues/${n}`;

	// 送るのは表示中の値から変えた項目だけにする。全項目を送ると、開いた後にタイムラインや
	// 他の人が変えた項目まで、画面に残っていた古い値で上書きしてしまう
	function dropUnchanged(e: FormDataEvent) {
		for (const field of Object.keys(shown) as (keyof typeof shown)[]) {
			const { name } = save.fields[field].as('text');
			if (e.formData.get(name) === shown[field]) e.formData.delete(name);
		}
		// 複数選択は、選んだ ID の集まりが変わっていなければ送らない
		for (const [name, current] of [
			[assigneeName, issue.assigneeIds],
			[categoryName, issue.categoryIds]
		] as const) {
			const ids = e.formData.getAll(name).filter(Boolean);
			if (ids.length === current.length && ids.every((id) => current.includes(id as string))) {
				e.formData.delete(name);
			}
		}
	}

	async function deleteComment(commentId: string) {
		try {
			await removeComment({ ...ref, commentId });
		} catch {
			failed();
		}
	}

	// 押したらすぐ表示を変え、サーバーの結果で置き換える
	async function react(commentId: string, emoji: string) {
		if (!me) return;
		const user = { id: me.id, name: me.name };
		try {
			await reactToComment({ ...ref, commentId, emoji }).updates(
				commentsQuery.withOverride((list) =>
					list.map((c) =>
						c.id === commentId ? { ...c, reactions: toggleReactionIn(c.reactions, emoji, user) } : c
					)
				)
			);
		} catch {
			failed();
		}
	}

	const failed = () => toast.error('エラーが発生しました。時間をおいて再度お試しください');

	async function copyIssueKey(e: MouseEvent) {
		const key = `${projectKey}-${issue.number}`;
		try {
			await navigator.clipboard.writeText(e.shiftKey ? `${key} ${issue.title}` : key);
			toast.success('コピーしました');
		} catch {
			toast.error('コピーできませんでした');
		}
	}

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
		onformdata={dropUnchanged}
		{...save.enhance(async ({ submit }) => {
			try {
				if (await submit()) {
					editing = false;
					saves++;
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
				<label for="issue-status"><CircleDot style="--c: var(--c-blue)" />ステータス</label>
				<select
					class="select"
					id="issue-status"
					{...save.fields.status.as('select', shown.status)}
					disabled={!perms.changeStatus}
				>
					{#each detail.statuses as s (s.key)}
						<option value={s.key}>{s.name}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-resolution"><CircleCheck style="--c: var(--c-green)" />完了理由</label>
				<select
					class="select"
					id="issue-resolution"
					{...save.fields.resolution.as('select', shown.resolution)}
					disabled={!perms.edit}
				>
					<option value="">未設定</option>
					{#each RESOLUTIONS as r (r)}
						<option value={r}>{RESOLUTION_LABEL[r]}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-priority"><Flag style="--c: var(--c-orange)" />優先度</label>
				<select
					class="select"
					id="issue-priority"
					{...save.fields.priority.as('select', shown.priority)}
					disabled={!perms.edit}
				>
					{#each PRIORITIES as p (p)}
						<option value={p}>{PRIORITY_LABEL[p]}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<span class="prop-label" id={`issue-assignee-${variant}-label`}
					><UsersRound style="--c: var(--c-pink)" />担当者</span
				>
				<div class="min-w-0">
					<!-- 全員外したときも送るための空の値（サービス側で除く） -->
					{#if perms.assign}<input type="hidden" name={assigneeName} value="" />{/if}
					<MultiSelect
						id={`issue-assignee-${variant}`}
						name={assigneeName}
						options={detail.assignees
							.filter((u) => !u.disabled || issue.assigneeIds.includes(u.id))
							.map((u) => ({ value: u.id, label: u.disabled ? `${u.name}（無効）` : u.name }))}
						selected={[...issue.assigneeIds]}
						placeholder="未割当"
						disabled={!perms.assign}
					/>
				</div>
			</div>
			<div class="prop-row">
				<label for={`issue-parent-${variant}`}
					><CornerLeftUp style="--c: var(--c-violet)" />親課題</label
				>
				<div class="min-w-0">
					<input
						class="input"
						id={`issue-parent-${variant}`}
						list={`issue-parent-${variant}-options`}
						inputmode="numeric"
						placeholder={detail.children.length > 0 ? '子課題があるため設定不可' : '課題番号'}
						{...save.fields.parentNumber.as('text', shown.parentNumber)}
						disabled={!perms.edit || detail.children.length > 0}
					/>
					<datalist id={`issue-parent-${variant}-options`}>
						{#each detail.parentCandidates as c (c.number)}
							<option value={String(c.number)}>{projectKey}-{c.number} {c.title}</option>
						{/each}
					</datalist>
				</div>
			</div>
			<div class="prop-row">
				<span class="prop-label" id={`issue-category-${variant}-label`}
					><Tag style="--c: var(--c-amber)" />カテゴリー</span
				>
				<div class="min-w-0">
					<!-- 全部外したときも送るための空の値（サービス側で除く） -->
					{#if perms.edit}<input type="hidden" name={categoryName} value="" />{/if}
					<MultiSelect
						id={`issue-category-${variant}`}
						name={categoryName}
						options={detail.categories.map((c) => ({ value: c.id, label: c.name }))}
						selected={[...issue.categoryIds]}
						placeholder="未設定"
						disabled={!perms.edit}
					/>
				</div>
			</div>
			<div class="prop-row">
				<label for="issue-milestone"><Milestone style="--c: var(--c-teal)" />マイルストーン</label>
				<select
					class="select"
					id="issue-milestone"
					{...save.fields.milestoneId.as('select', shown.milestoneId)}
					disabled={!perms.edit}
				>
					<option value="">未設定</option>
					{#each detail.milestones as m (m.id)}
						<option value={m.id}>{milestoneLabel(m)}{m.completedAt ? '（完了）' : ''}</option>
					{/each}
				</select>
			</div>
			<div class="prop-row">
				<label for="issue-start"><Calendar style="--c: var(--c-lime)" />開始日</label>
				<input
					class="input"
					id="issue-start"
					{...save.fields.startDate.as('date', shown.startDate)}
					disabled={!perms.edit}
				/>
			</div>
			<div class="prop-row">
				<label for="issue-due"><CalendarClock style="--c: var(--c-red)" />期限日</label>
				<input
					class="input"
					id="issue-due"
					{...save.fields.dueDate.as('date', shown.dueDate)}
					disabled={!perms.edit}
				/>
			</div>
		</div>
		{#if canSave || perms.edit}
			<div class="flex flex-wrap items-center gap-2">
				{#if canSave}<button type="submit" class="btn btn-primary">保存</button>{/if}
				{#if perms.edit}
					<!-- 同じ位置で「編集」と「編集をやめる」を切り替える -->
					<button
						type="button"
						class="btn btn-outline btn-sm"
						aria-pressed={editing}
						onclick={() => (editing = !editing)}
					>
						{#if editing}<X />編集をやめる{:else}<Pencil />タイトル・本文を編集{/if}
					</button>
				{/if}
			</div>
		{:else}
			<p class="hint">この課題の属性は変更できません</p>
		{/if}
	</form>
{/snippet}

<section class="detail" class:sheet={variant === 'sheet'}>
	<div class="grid min-w-0 grid-cols-1 gap-6">
		{#if issue.deletedAt}
			<div role="status" class="alert">
				<Trash2 />
				<div>
					この課題は {issue.deletedByName ?? '—'} が {formatDateTime(issue.deletedAt)} に削除しました（閲覧のみ）。
				</div>
			</div>
		{/if}
		<header class="grid gap-2">
			{#if issue.parent}
				<a href={issueHref(issue.parent.number)} class="parent-link">
					<CornerLeftUp size={14} class="shrink-0" />
					<span class="mono shrink-0">{projectKey}-{issue.parent.number}</span>
					<span class="truncate">{issue.parent.title}</span>
				</a>
			{/if}
			{#if detail.issueTypes.length > 0 || issue.typeId}
				<div class="flex items-center gap-2">
					<label for={`issue-type-${variant}`} class="text-[0.8125rem] text-muted-foreground"
						>種別</label
					>
					<!-- 属性フォームに form 属性で紐づける。タイトル・本文の編集中でなければ選んだ時点で保存する -->
					<select
						class="select type-select"
						id={`issue-type-${variant}`}
						{...save.fields.typeId.as('select', shown.typeId)}
						form={attrFormId}
						disabled={!perms.edit}
						onchange={(e) => {
							if (!editing) e.currentTarget.form?.requestSubmit();
						}}
					>
						{#if !issue.typeId}<option value="">未設定</option>{/if}
						{#each detail.issueTypes as t (t.id)}
							<option value={t.id}>{t.name}</option>
						{/each}
					</select>
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<span class="mono text-[0.8125rem] text-muted-foreground">{projectKey}-{issue.number}</span>
				<StatusPill status={issue.status} statuses={detail.statuses} />
				<PriorityPill priority={issue.priority} />
			</div>
			<div class="flex items-start gap-2">
				<h1 class="page-title" style="font-size: 1.375rem; text-wrap: pretty">{issue.title}</h1>
				<button
					type="button"
					class="btn btn-outline btn-sm mt-0.5 shrink-0"
					title="課題キーをクリップボードにコピーします。Shiftキーを押しながらクリックすると課題キーと件名をコピーします。"
					onclick={copyIssueKey}
				>
					<Copy />課題キーをコピー
				</button>
			</div>
			<p class="m-0 text-[0.8125rem] text-muted-foreground">
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
						{...save.fields.title.as('text', shown.title)}
						form={attrFormId}
						required
						maxlength={200}
					/>
				</div>
				<div class="field">
					<label class="label" for="issue-description">本文</label>
					<MarkdownEditor
						id="issue-description"
						{...save.fields.description.as('text', shown.description)}
						form={attrFormId}
						rows={10}
						label="本文"
						projectKey={ref.key}
						{mentionCandidates}
					/>
					<p class="hint">{variant === 'page' ? '右' : '上'}の「保存」で反映されます。</p>
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

		{#if !issue.parent && (detail.children.length > 0 || perms.writable)}
			<section class="card children" aria-label="子課題">
				<div class="flex items-center gap-2">
					<h2 class="card-title">
						<ListTree class="size-4" /> 子課題
						{#if detail.children.length > 0}
							<span class="text-[0.8125rem] font-normal text-muted-foreground"
								>{detail.children.filter((c) => c.status === DONE_STATUS).length} / {detail.children
									.length} 完了</span
							>
						{/if}
					</h2>
					{#if perms.writable}
						<a
							href={`/projects/${projectKey}/issues/new?parent=${issue.number}`}
							class="btn btn-outline btn-sm ml-auto"><Plus />子課題を追加</a
						>
					{/if}
				</div>
				{#if detail.children.length > 0}
					<ul>
						{#each detail.children as c (c.id)}
							<li>
								<a href={issueHref(c.number)} class="child-link">
									<span class="mono shrink-0 text-[0.8125rem] text-muted-foreground"
										>{projectKey}-{c.number}</span
									>
									<span class="min-w-0 truncate">{c.title}</span>
								</a>
								<span class="ml-auto flex shrink-0 items-center gap-2">
									{#if c.assignees.length > 0}
										<span class="max-w-40 truncate text-xs text-muted-foreground"
											>{c.assignees.map((u) => u.name).join('、')}</span
										>
									{/if}
									<StatusPill status={c.status} statuses={detail.statuses} />
								</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="m-0 text-[0.8125rem] text-muted-foreground">子課題はありません</p>
				{/if}
			</section>
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

		<section class="grid grid-cols-1 gap-4" aria-label="コメントと編集履歴">
			{#each activity as e (e.id)}
				{#if e.kind === 'change'}
					{@const h = e.h}
					<article class="change" id={`change-${h.id}`}>
						<span class="avatar" style:--c={colorFor(h.actorName)}>{h.actorName[0]}</span>
						<div class="grid min-w-0 grid-cols-1 gap-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">{h.actorName}</span>
								<span class="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
							</div>
							<ul class="change-list">
								{#each h.changes as ch (ch.field)}
									<li class:full={ch.field === 'description'}>
										{#if ch.field === 'description' && ch.from !== null && ch.to !== null}
											{@const before = ch.from}
											{@const after = ch.to}
											<details
												class="desc-diff"
												ontoggle={(e) =>
													e.currentTarget.open ? openDiffs.add(h.id) : openDiffs.delete(h.id)}
											>
												<summary>本文を変更しました（差分を表示）</summary>
												{#if openDiffs.has(h.id)}
													{#await import('#lib/components/DescriptionDiff.svelte') then { default: DescriptionDiff }}
														<DescriptionDiff {before} {after} />
													{/await}
												{/if}
											</details>
										{:else if ch.field === 'description'}
											<!-- 差分の保存を始める前の履歴 -->
											<span>本文を変更しました</span>
										{:else}
											<span class="change-field">{ISSUE_CHANGE_FIELD_LABEL[ch.field]}</span>
											<span class="change-value">{ch.from ?? '未設定'}</span>
											<span aria-label="から">→</span>
											<span class="change-value">{ch.to ?? '未設定'}</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					</article>
				{:else}
					{@const c = e.c}
					<article class="comment" id={`comment-${c.id}`}>
						<span class="avatar" style:--c={colorFor(c.authorName)}>{c.authorName[0]}</span>
						<div class="grid min-w-0 grid-cols-1 gap-1">
							<div class="flex items-center gap-2">
								<span class="font-medium">{c.authorName}</span>
								<span class="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
								<div class="ml-auto flex items-center">
									{#if perms.writable}
										<ReactionPicker
											align="end"
											selected={c.reactions
												.filter((g) => g.users.some((u) => u.id === me?.id))
												.map((g) => g.emoji)}
											onpick={(emoji) => react(c.id, emoji)}
										/>
									{/if}
									{#if c.canModify}
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
									{/if}
								</div>
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
									<MarkdownEditor
										{...edit.fields.body.as('text', c.body)}
										rows={4}
										required
										aria-label="コメントを編集"
										label="コメントを編集"
										projectKey={ref.key}
										{mentionCandidates}
									/>
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
							<CommentReactions
								id={`comment-${c.id}`}
								reactions={c.reactions}
								meId={me?.id}
								canReact={perms.writable}
								ontoggle={(emoji) => react(c.id, emoji)}
							/>
						</div>
					</article>
				{/if}
			{/each}
			{#each pendingComments as c (c.id)}
				<article class="comment pending" aria-busy="true">
					<span class="avatar" style:--c={colorFor(me?.name ?? '')}>{me?.name[0]}</span>
					<div class="grid min-w-0 grid-cols-1 gap-1">
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
					<MarkdownEditor
						id="new-comment"
						{...post.fields.body.as('text')}
						rows={3}
						required
						label="コメントを追加"
						projectKey={ref.key}
						{mentionCandidates}
					/>
					<div class="flex items-center justify-end gap-2">
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
					description="この課題を削除してよろしいですか？&#10;課題は一覧から消え、一覧の「削除した課題」から閲覧だけできます。"
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
	.type-select {
		width: auto;
		min-width: 140px;
	}
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
			grid-template-columns: minmax(0, 1fr) 18.75rem;
			column-gap: 40px;
		}
		.side {
			position: sticky;
			top: 80px;
		}
	}
	/* 大きい画面では本文と属性の間を広げ、画面幅を使い切る（+layout の .container も広がる） */
	@media (min-width: 1400px) {
		.detail:not(.sheet) {
			grid-template-columns: minmax(0, 1fr) 21.25rem;
			column-gap: 64px;
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
	.comment,
	.change {
		scroll-margin-top: 80px;
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: 12px;
	}
	.comment:target {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: var(--radius-sm);
	}
	.comment :global(.danger-hover:hover) {
		color: var(--destructive);
	}
	.change-list {
		display: grid;
		gap: 2px;
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: var(--muted);
		list-style: none;
		font-size: 0.8125rem;
	}
	.change-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 6px;
		min-width: 0;
	}
	.change-list li.full {
		display: block;
	}
	.change-field {
		color: var(--muted-foreground);
	}
	.desc-diff summary {
		width: fit-content;
		cursor: pointer;
	}
	.desc-diff[open] summary {
		margin-bottom: 6px;
	}
	.change-field::after {
		content: ':';
	}
	.change-value {
		overflow-wrap: anywhere;
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
	.parent-link {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		width: fit-content;
		max-width: 100%;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
	}
	.parent-link:hover {
		color: var(--foreground);
	}
	.children ul {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.children li {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		min-height: 40px;
		border-top: 1px solid var(--border);
	}
	.child-link {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
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
