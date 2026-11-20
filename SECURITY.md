# セキュリティポリシー

## 修正の対象

修正は最新のリリース（[GitHub Releases](https://github.com/izu12ki/project-manager/releases) の最も新しい `web@x.y.z`）にだけ入れます。古いリリースへのバックポートはしません。セルフホストしている場合は、[アップデート手順](https://project-manager-docs.hirano-i.workers.dev/guides/update/)に沿って最新のリリースへ更新してください。

修正を含むリリースは、リリースノートと [Security Advisories](https://github.com/izu12ki/project-manager/security/advisories) で知らせます。リポジトリの Watch を「Custom」にして「Releases」と「Security alerts」を選ぶと、通知を受け取れます。

## 脆弱性の報告

**公開の Issue・Pull Request・コメントには書かないでください。**

GitHub の非公開の報告機能を使ってください。

1. リポジトリの [Security タブ](https://github.com/izu12ki/project-manager/security) を開く
2. 「Report a vulnerability」を押す（[直接開く](https://github.com/izu12ki/project-manager/security/advisories/new)）
3. 次の内容を書いて送る

- 影響を受けるバージョン（リリースタグかコミット）
- 再現手順（リクエストの例や、必要なユーザーの権限・ロール）
- 影響。誰が、何をできてしまうか（例: ゲストが参加していないプロジェクトの課題を読める）
- 分かれば、原因や修正案

報告と調査は非公開のまま進めます。修正をリリースした後に Advisory を公開します。希望があれば、Advisory に報告者としてお名前を載せます。

## 対応の流れ

1. 報告を受け取ったら、Advisory 上で受け取ったことを返信します。
2. 再現して影響を確かめ、深刻度を決めます。
3. 修正し、patch リリースとしてすぐに出します。依存パッケージの脆弱性も、修正版への更新を同じように patch リリースとして出します。
4. Advisory を公開します。

個人で保守しているため、対応にかかる日数はお約束できません。進み具合は Advisory 上でお知らせします。

## 対象

対象は、このリポジトリのコードです。

- アプリ本体（`apps/web`）
- Claude Code 用の Skill（`skills/`）
- デプロイ手順など、ドキュメントの記載のうち安全でない設定を勧めているもの（`apps/docs`）

次のものは対象外です。それぞれの提供元に報告してください。

- Cloudflare・Turso・Slack などの外部サービスそのものの脆弱性
- 依存パッケージ（Better Auth など）の脆弱性。ただし、このアプリでの使い方に問題がある場合は対象です
- 個々の利用者のデプロイの設定ミス（シークレットの漏えいなど）

## 検証するときのお願い

脆弱性は、ご自身でデプロイした環境か、ローカルの開発環境（[ローカル開発](https://project-manager-docs.hirano-i.workers.dev/contributing/local-dev/)）で確かめてください。他人が運用している環境への攻撃、大量のリクエストやアカウント作成、他人のデータの閲覧・変更はしないでください。
