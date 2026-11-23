<script lang="ts">
	import { enhance, withPasswordKeys } from '#lib/forms.ts';
	import FormAlert from '#lib/components/FormAlert.svelte';
	import PasswordInput from '#lib/components/PasswordInput.svelte';
	import PasswordSubmit from '#lib/components/PasswordSubmit.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if !data.invitation}
	<div class="card auth-card">
		<div class="auth-head">
			<h1>招待リンクが無効です</h1>
			<p>招待リンクが無効か、期限切れです。管理者に再発行を依頼してください。</p>
		</div>
	</div>
{:else}
	<div class="card auth-card">
		<div class="auth-head">
			<h1>招待を受ける</h1>
			<p>
				{#each data.invitation.projectNames as name (name)}「{name}」{/each}{#if data.invitation.projectNames.length > 0}に{/if}{data
					.invitation.roleLabel}として招待されています
			</p>
		</div>
		<form
			method="POST"
			use:enhance={withPasswordKeys({
				email: data.invitation.email,
				fields: [{ name: 'password' }]
			})}
			class="auth-form"
		>
			{#if form?.message}<FormAlert message={form.message} />{/if}
			<div class="field">
				<label class="label" for="email">メールアドレス</label>
				<input class="input" id="email" type="email" readonly value={data.invitation.email} />
			</div>
			<div class="field">
				<label class="label" for="name">名前</label>
				<!-- value= だとハイドレーションで値を入れ直し、スクリプトの読み込み前に直した名前が戻る -->
				<input
					class="input"
					id="name"
					name="name"
					required
					maxlength={50}
					defaultValue={data.invitation.name ?? ''}
				/>
			</div>
			<div class="field">
				<label class="label" for="password">パスワード</label>
				<PasswordInput
					id="password"
					name="password"
					autocomplete="new-password"
					required
					minlength={10}
					maxlength={128}
					aria-describedby="password-hint"
				/>
				<p class="hint" id="password-hint">10文字以上</p>
			</div>
			<PasswordSubmit>登録する</PasswordSubmit>
		</form>
	</div>
{/if}
