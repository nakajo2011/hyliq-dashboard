# Hyliq Dashboard

Hyperliquid からエクスポートした取引 CSV（Perpetuals）を取り込み、損益を可視化・確定申告用に JPY 換算するための個人用 Web アプリ。

## 構成

- **フロント**: React + Vite + TypeScript (`client/`)
- **バックエンド**: PocketBase (Docker 1 コンテナ)
- **DB**: PocketBase 内蔵 SQLite (`pb_data/`、Git 除外)
- **スキーマ管理**: `pb_migrations/` 配下の JS マイグレーション

```
hyliq_dashboard/
├── docker-compose.yml      # PocketBase 起動定義
├── pb_migrations/          # コレクション定義 (Git 管理)
├── pb_data/                # 永続データ (gitignore)
├── client/                 # React アプリ
└── sample_csv/             # サンプル CSV
```

## セットアップ

### 1. PocketBase 起動

ホスト側 (Docker が動く環境) で:

```sh
docker compose up -d
```

- 管理画面: <http://localhost:8090/_/>
- 初回アクセスで管理者ユーザーを作成
- `pb_migrations/` 配下の migration が自動適用され、コレクションが作成されます

### 2. クライアント起動

```sh
cd client
cp .env.example .env   # 必要に応じて編集
npm install
npm run dev
```

- 開発サーバー: <http://localhost:5173/>
- 起動するとトップ画面で PocketBase へのヘルスチェックとコレクションの存在確認が走ります

### 開発時のチェック

```sh
cd client
npm test            # lint + 単体テスト (61 件)
npm run check       # lint + 型チェック (tsc) + 単体テスト の全部
npm run test:integration   # 実 PocketBase に対する統合テスト
npm run lint        # ESLint のみ
```

## コレクション

| 名前 | 用途 |
|---|---|
| `accounts` | アカウントアドレス管理 |
| `trades` | Perp 取引履歴 (Open/Close Long/Short) |
| `fundings` | ファンディング履歴 |
| `transfers` | 入出金履歴 |
| `fx_rates` | USD/JPY レートキャッシュ |

各データ系コレクションは `hash` フィールドに UNIQUE 制約を持ち、CSV 再アップロード時の重複登録を防ぎます。

## 開発フェーズ

- [x] Phase 1: 環境構築 (Docker / Vite / PocketBase スキーマ / SDK 接続)
- [ ] Phase 2: CSV 取り込み (papaparse、アップロード画面、重複検出)
- [ ] Phase 3: ダッシュボード可視化
- [ ] Phase 4: JPY 換算 確定申告レポート
- [ ] Phase 5: FX API 連携・UI 磨き込み
