# Changesets

リリースノートとバージョンは [Changesets](https://github.com/changesets/changesets) で管理します。npm には公開せず、`web@x.y.z` の Git タグと GitHub Releases を作ります。

## 変更を加えたとき

利用者に影響する変更（機能追加・不具合修正・設定や手順の変更）には changeset を付けます。

```bash
pnpm changeset
```

対象パッケージは `web` を選びます。`docs` は対象外です。

- `patch`: 不具合修正、セキュリティ修正、小さな改善
- `minor`: 機能追加
- `major`: 既存の利用者が手順を変えないと動かなくなる変更

要約は利用者向けに書きます。セルフホストしている人が更新時に作業を要する場合は、要約の中で明記してください。

- DB マイグレーション（`pnpm db:migrate:remote`）が必要
- 新しい Cloudflare リソース（R2 バケットなど）やシークレットの作成が必要
- 環境変数の追加・変更が必要

リファクタリング、テスト、CI、ドキュメントだけの変更には不要です。Renovate による依存更新にも付けず、次のリリースに含めます。ただしセキュリティ修正を含む依存更新には `patch` の changeset を付けてすぐにリリースします。

## リリースの流れ

1. changeset を含む PR が `main` にマージされると、`Release` ワークフローが「Version Packages」PR を作成・更新します。
2. その PR をマージすると、`web@x.y.z` タグと GitHub Release が作成されます。
