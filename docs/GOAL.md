# 実利用化ゴール

この文書は、agent-delegator を「検証済みプロトタイプ」から「実業務リポジトリでの常用ツール」へ
引き上げる改善サイクルのゴール定義である。2026-07-27 の実利用調査（3系統の並列レビュー＋実機
検証）とオーナーとの認識合わせで確定した。各イテレーションの採否・完了判定はこの文書を基準に
行い、更新は `DESIGN_AND_ROADMAP.md` §11 のルールに従う。

## Why（最終目的）

Claude-main セッションが設計とレビューだけにトークンを使い、境界の定まった実装タスクを
agent-delegator 経由で Codex に日常委譲できる状態を作る。Evidence Bundle → Brief → approval の
trust boundary は維持したまま、委譲元 Claude セッションのトークン消費を「レビュー専用セッション」
水準へ圧縮する。

## ゴール状態（What）

1. **ターゲットリポジトリで素通しで動く** — このリポジトリ以外の実リポジトリで、手作業の
   gitignore 追加や `--allow-worktree-change` の常用なしに、README のデフォルトフローが完走する。
2. **詰み状態ゼロ** — どの失敗モードにも「フル Codex 再実行」以外の決定的で安価な回復経路がある。
   対象: compile↔approve 間のコミット、citation 検証の全損、resume thread 喪失、stale な
   active state。
3. **委譲元トークンが計測可能かつ最小** — Claude 側コンテキストへの不要流入（Codex stderr ノイズ等）
   をなくし、往復ターン数・流入バイトの代理指標を `report` で観測できる。
4. **節約の実証** — 中規模の bounded 実装タスクで「直接実装 vs 委譲」の Claude 側コスト優位を
   実測で示せる。
5. 上記が自動テストと実タスク trial の両方で再現可能に検証されている。

## 合意済みの運用決定（2026-07-27）

| 論点 | 決定 |
| --- | --- |
| 主眼 | 実用性が主、トークン節約は従。まず詰まらず使えること、計測・削減はその上に積む |
| 検証の場 | 実業務リポジトリでの実タスク trial（対象リポジトリは trial 開始時に選定） |
| 改善ループの権限 | ローカル commit まで自律（Conventional Commits）。push / PR は都度確認 |
| 実 Codex 呼び出し | 課金ありの実呼び出しを自律ループに含めてよい |

## 不変条件

- Evidence Bundle → Brief → approval の trust boundary を弱めない。
- `CLAUDE.md` の Boundaries（citation / path-containment / integrity / retry / approval ガードの
  緩和禁止、`private: true` / `UNLICENSED` 維持、委譲 run による commit・push・PR・deploy 禁止）を守る。
- リリースゲート（typecheck / test / build / package:smoke）を常時グリーンに保つ。

## 非ゴール

public registry release / Claude plugin 化、semantic discovery、Windows 対応、Codex 以外の
implementer。`DESIGN_AND_ROADMAP.md` の「Later」項目は本サイクルの対象外。

## 完了判定

実業務リポジトリでの実タスク **3回連続**で次を満たしたらゴール到達とする（回数は運用実感で
更新可）。

1. ゲート誤発火（`--allow-*` を要求される不当な失敗）ゼロ。
2. 発生した失敗はすべて Codex フル再実行なしで回復できた。
3. Claude 側流入トークンの代理指標が観測でき、ベースライン（直接実装）比で削減が示せる。
4. 全リリースゲート通過を維持。

## 優先順位付きバックログ

2026-07-27 の調査結果から導出。各項目は「実装 → ゲート → commit」を1イテレーションとする。

### Phase 1 — ブロッカー（ターゲットリポジトリで使えない）

- [x] P1-1: run ディレクトリの自己無効化を解消する。runs ディレクトリ作成時に `.gitignore`（`*`）を
  書き、worktree fingerprint / checkpoint / `git status` から run 成果物を恒久的に除外する。
  README の「ignored by Git」記述を実装に一致させる。（2026-07-27 done）
- [x] P1-2: null-turn citation の XML エスケープ照合バグを修正する（decision event 引用に
  `&` `<` `>` が含まれると検証が絶対に通らない）。null-turn 照合を decision event の
  非エスケープ本文に限定し、turn 本文にしかない引用には該当 turn を診断で提示する。
  （2026-07-27 done）

### Phase 2 — 詰み解消（回復経路）

- [x] P2-1: compile↔approve 間の HEAD 変化に、run を作り直さない回復経路を与える。
  `approve --allow-base-change` が新しい base commit へ approval を再バインドする。
  （2026-07-27 done）
- [x] P2-2: Claude が手修正した `brief.json` を Codex 再実行なしで再検証・再 compiled 化する経路。
  `revalidate --run <id>` が raw compiler output からの seed・完全再検証・決定的 repair を行い、
  通れば `compiled` へ戻す。検証自体は一切緩めない。（2026-07-27 done）
- [ ] P2-3: resume thread 喪失時に approved Brief から実装をやり直せる経路。
- [ ] P2-4: stale な active state の強制回復（PID 再利用対策を含む）。
- [ ] P2-5: タイムアウトの SIGKILL エスカレーションと孤児 Codex プロセスの残留対策。

### Phase 3 — トークン経済（従目的）

- [ ] P3-1: Codex stderr パススルーの抑止/要約（`stderr.log` への保存は維持）。
- [ ] P3-2: `report` に委譲元コストの代理指標（コマンド実行回数・stdout バイト・リトライ起因往復数）を追加。
- [ ] P3-3: 長時間実行の見張りコスト削減（完了まで待つ実行モード等）。

### Phase 4 — 実利用の仕上げ（中優先の摩擦）

- [ ] P4-1: redaction の実用化（`github_pat_` / `xoxb-` / JWT / AKIA / URL 埋め込み認証の追加、
  型定義誤検知の抑制）。
- [ ] P4-2: セッションディレクトリ名エンコードの Claude Code 実装準拠（`.` `_` → `-`）。
- [ ] P4-3: collection の全損性緩和（optional ソースのバイナリ/サイズ超過は exclusion 記録に、
  クイックパスからの limits 指定手段）。
- [ ] P4-4: 実装成功後の checkpoint 失敗で成功が破棄される問題の分離。
- [ ] P4-5: CLI 基本 UX（`--help` / `--version`、run 不在時のエラー、相対パス基準の統一）。

### Trial — 実業務リポジトリ検証

- [ ] T-1: Phase 1〜2 完了後、対象リポジトリを選定し実タスク trial を開始する（開始時にオーナーと
  対象を確認）。
- [ ] T-2: trial 3回連続で完了判定を満たすまで、発生した摩擦をバックログへ還流する。

## 変更履歴

- 2026-07-27: 初版。実利用調査の結果とオーナー合意（主眼・検証の場・権限・課金）を反映。
