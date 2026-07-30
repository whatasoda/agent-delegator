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

semantic discovery、Windows 対応、Codex 以外の implementer。`DESIGN_AND_ROADMAP.md` の「Later」
項目は本サイクルの対象外。

※ 当初は public release / plugin 化も非ゴールだったが、2026-07-27 のオーナー判断（public 前提・
MIT ライセンス）により Phase D としてスコープに追加した。実際の registry publish・push は
オーナー明示トリガーのみで行う。

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
- [x] P2-3: resume thread 喪失時に approved Brief から実装をやり直せる経路。
  `implement --retry` が failed resume からも新セッションで再実装できる。worktree 照合は
  「最後に approve/checkpoint した状態」基準になり、クリーンな失敗後はフラグ不要。
  （2026-07-27 done）
- [x] P2-4: stale な active state の強制回復（PID 再利用対策を含む）。
  `status --force-fail` が PID 再利用で生存に見える stuck run を明示的に failed へ変換し、
  retry 経路を開く。（2026-07-27 done）
- [x] P2-5: タイムアウトの SIGKILL エスカレーションと孤児 Codex プロセスの残留対策。
  timeout / SIGINT / SIGTERM / SIGHUP（ターミナルクローズ）を process group へ転送し、猶予後に
  SIGKILL。exit 後に stdio が塞がっても bounded wait で必ず復帰。（2026-07-27 done）

### Phase 3 — トークン経済（従目的）

- [x] P3-1: Codex stderr パススルーの抑止/要約（`stderr.log` への保存は維持）。
  既定でライブ転送を停止（`AGENT_DELEGATOR_STREAM_CODEX_STDERR=1` でオプトイン）、失敗
  メッセージが `stderr.log` を指す。（2026-07-27 done）
- [x] P3-2: `report` に委譲元コストの代理指標を追加。run ごとの `controller_cost`
  （tracked_invocations / gate_rejections / codex_failures / review_surface_bytes）と
  report summary の合計・Markdown 表示。ゲート誤発火（完了判定 i）が run 単位で計測可能に。
  stdout バイトの直接計測は費用対効果が低く review-surface バイトで代替。（2026-07-27 done）
- [x] P3-3: 長時間実行の見張りコスト削減。`wait --run <id>` が run の settle まで in-process で
  ブロック（stale controller 回復込み）。README の運用ガイダンスを「ポーリング」から
  「background 実行＋完了通知 / wait」へ更新。（2026-07-27 done）

### Phase 4 — 実利用の仕上げ（中優先の摩擦）

- [x] P4-1: redaction の実用化。fine-grained PAT / Slack / JWT / AWS key id / URL 認証 / Basic を
  追加、引用符値を末尾まで redact、bare 型注釈（`password: string` 等）は保持。（2026-07-27 done）
- [x] P4-2: セッションディレクトリ名エンコードの Claude Code 実装準拠（非英数字→`-`）。
  （2026-07-27 done）
- [x] P4-3: collection の全損性緩和。glob 展開・optional ソースのバイナリ/サイズ超過は exclusion
  記録（明示 required ファイルは従来どおり fatal）。クイックパスに `--max-source-bytes` /
  `--max-transcript-input-bytes` を追加し、上限エラーが対処法を案内。（2026-07-27 done）
- [x] P4-4: 実装成功後の checkpoint 失敗で成功が破棄される問題の分離。有効な result と status を
  保持し、capture エラーをイベント・CLI 出力に記録。stale fingerprint により次回実行は
  `--allow-worktree-change` を要求（保守的なまま）。（2026-07-27 done）
- [x] P4-5: CLI 基本 UX。全コマンドで `--help`（exit 0）、`--version` 追加、run 不在は
  「Run not found」で案内、`--context` の相対パス基準を他オプションと同じ shell cwd に統一、
  usage に未記載オプションを補完。（2026-07-27 done）

### Phase D — public 配布（2026-07-27 スコープ追加）

- [x] D-1: MIT ライセンス切替と public-alpha パッケージメタデータ（LICENSE、`license: MIT`、
  `publishConfig: { access: public, tag: alpha }`、README の互換性表明）。（2026-07-27 done）
- [x] D-2: node 互換 bin ラッパ（Bun 不在時に導線つきで即死、npm/npx ユーザーの意味不明な失敗を
  排除）。package-smoke が同梱と導線メッセージを検証。（2026-07-27 done）
- [x] D-3: owner トリガーの npm alpha release workflow（Trusted Publishing / provenance、
  リリースゲート組込み）と DISTRIBUTION.md / DESIGN_AND_ROADMAP §8 の方針改訂。
  （2026-07-27 done）
- [x] D-4: 公開の実行 — オーナー操作。`0.1.0-alpha.1` を初回手動 publish し、Trusted Publisher
  （release.yml）と Publishing access（2FA 必須・トークン禁止）を設定済み。以降の publish は
  release workflow に一本化。npx/bunx 経由の install→launcher→CLI 実行を検証済み。
  なお npm は初回 publish で `latest` を必ず付与するため（撤回不可）、`latest` も当面 alpha 版を
  指す。安定版リリース時に自然に移行する。（2026-07-27 done）
- [x] D-5: public marketplace 化＋thin plugin（operator skill の配布）。repo 内 marketplace、独立
  plugin SemVer、core CLI exact compatibility、skill 同期検査、Claude strict validation、user-scope
  install/update smoke を整備。（2026-07-30 done）

### Phase 5 — 監査残件（小粒。trial で実害が出たものから拾う）

2026-07-27 の実利用調査で検出したが未修正の項目。優先度は trial での遭遇頻度で決める。

- [x] P5-1: monorepo 対応 — collect へ invoking cwd を明示的に渡し、latest fallback と
  `resolve-transcript --cwd` の解決基準を統一。サブディレクトリ fixture で固定。（2026-07-30 done）
- [x] P5-2: turn 番号の実用性 — isMeta / legacy sidechain を除外し、redacted preview を返す
  `resolve-transcript --turns` を追加。（2026-07-30 done）
- [x] P5-3: Codex preflight — `doctor` で版数/command/path を検査し、ENOENT を導線付きに変換、
  `AGENT_DELEGATOR_CODEX_COMMAND` を追加。malformed event は stderr に compatibility warning を残す。
  alpha 中は schema output を feature probe とし Codex 最小版を固定しない。（2026-07-30 done）
- [x] P5-4: `brief.md` の手編集を approve が無言破棄せず、canonical `brief.json` への移植と
  revalidate を案内して fail closed。（2026-07-30 done）
- [x] P5-5: forbidden-action lint の誤検知 — `deploy:check` 等のスクリプト名や 48 文字超の否定
  文脈で正当な Brief が落ちる。（2026-07-29 done: ws4 trial で `wrangler deploy --dry-run` が
  compile validation を誤発火させ Codex compile 1回分を破棄する実害を確認。--dry-run の否定扱いと
  スクリプト名サフィックス除外を修正・テスト固定。48 文字超の否定文脈は実害未観測のため据え置き）
- [x] P5-6: 観測の整合 — resume/follow-up retry ledger を冪等化し、最新 thread id を失敗時も保存。
  torn event tail の許容と atomic-write tmp cleanup を追加。（2026-07-30 done）
- [x] P5-7: 並行実行の安全性 — run lock、同一 checkout の workspace-write lock、stale PID 回復、
  exclusive mkdir による run 作成を追加。（2026-07-30 done）
- [x] P5-8: 大規模 worktree 耐性 — untracked diff を4並列に制限し、64 MiB Git 出力上限時に
  generated/large file の除外・退避を案内。（2026-07-30 done）
- [ ] P5-9: CLI 入力の厳密化 — 数値オプションの `parseInt` が末尾ゴミを黙認
  （`--timeout-seconds=60m` → 60 秒）、no-op の `--no-latest-fallback`、approve 系への `--cwd`、
  `--transcript`＋`--session-id` の整合検証、~~evaluate スキーマエラーへの許容値一覧表示~~。
  （2026-07-29: 許容値一覧表示のみ対応済み — trial 2 run で計4回の enum ミスを確認。あわせて
  evaluate 入力エラーが `controller_cost.gate_rejections` に混入して完了判定 i を汚す計測バグを
  修正し、gate_rejections は validation / integrity / repository-drift のみ数える）
  （2026-07-30: 数値末尾ゴミ、approve 系 `--cwd`、transcript/session 同時指定と Context Request
  併用を修正。後方互換の `--no-latest-fallback` 整理のみ残る）
- [x] P5-10: 環境エッジ — package root 自体が checkout root の場合だけ delegator fingerprint を
  取得し、$HOME/yadm 全走査を回避。legacy sidechain も turn から除外。（2026-07-30 done）
- [x] P5-11: ドキュメント整合 — README の operator 例をインストール版
  `agent-delegator` 形式へ統一。（2026-07-30 done）
- [ ] P5-12: 運用ポリシー — run ディレクトリの prune コマンド／retention 方針、CI への macOS
  runner 追加（検証済み表明と CI の乖離）、実 Codex を使う定期 acceptance の置き場所。
  （2026-07-30: 30/90日 retention baseline と削除前 evaluate/report/history 手順を文書化し、CI を
  ubuntu + macos-14 matrix 化。自動 prune と定期実 Codex acceptance は明示的な費用/削除方針待ち）
- [x] P5-13: compiler が workspace-write/no-network で実行可能な検証だけを委譲し、owner-only の
  deploy/upload/production check は implement/iterate が not-run + risk として返す規約を追加。
  （2026-07-30 done）
- [x] P5-14: run 履歴の横断確認と保全（2026-07-29 trial で顕在化）— `report` が1 runs-dir 単位の
  ため全 trial の集計が手作業になる。run 作成時にマシンレベル registry
  （`~/.agent-delegator/registry.jsonl`、`AGENT_DELEGATOR_REGISTRY_PATH` で上書き）へ best-effort
  追記し `report --all` で横断集計する。（2026-07-29 done: 既存 13 run はバックフィル済み、消えた
  runs dir は unavailable 表示。worktree 削除前の retention 手順は P5-12 側に残す）
- [x] P5-15: forbidden-action lint の preflight — collect 時に objective を同じ lint で検査して
  `policy-warnings.json` を残し、compile は課金前に停止。false positive は明示 review 後の
  `--acknowledge-policy-warning` で継続できるが、外部 action の権限にはならない。（2026-07-30 done）
- [x] P5-16: citation の paraphrase 全損時、50%以上の longest-contiguous overlap を持つ上位3 turn を
  診断候補として表示。候補は validation を通さず、手動修正のヒントに限定。（2026-07-29 done）
- [x] P5-17: codex-timeout の salvage 導線 — 既定 30 分 timeout が large タスクで不足（ws4 trial:
  worktree に完成 diff が残った状態で timeout 判定→run は failed のまま・当該呼び出しの usage
  telemetry も欠落）。失敗メッセージから worktree diff の生存と回収手順（diff レビュー /
  `implement --retry`）へ誘導し、SKILL.md に complexity に応じた `--timeout-seconds` 指針を書く。
  timeout/interrupt/dead-controller 回復時に attempt checkpoint を保存し、baseline は更新せず retry を
  fail closed。skill に complexity 別 timeout 目安も追加。（2026-07-30 done）
- [x] P5-18: salvage 後の終端状態 — state の失敗履歴は保持しつつ、accepted evaluation のある failed
  run を `salvaged_runs` として未回復 `failed_runs` から分離。（2026-07-30 done）
- [ ] P5-19: モデル・版数の観測欠落 — 全 trial run で `compilerModel` / `implementationModel` が
  null（report の model 内訳が常に unknown）。installed パッケージ実行では `delegatorRevision` も
  null（build 時に版数を埋め込む）。`status --observation` が objective 全文を state と observation で
  二重ダンプする観測面の肥大も削る。
  （2026-07-30: 未指定で実行した slot を `codex-default` として集計し、installed build は Git revision
  の代わりに artifact SHA prefix で cohort 化。status の重複削減のみ残る）

### Trial — 実業務リポジトリ検証

- [ ] T-1: Phase 1〜2 完了後、対象リポジトリを選定し実タスク trial を開始する（開始時にオーナーと
  対象を確認）。
- [ ] T-2: trial 3回連続で完了判定を満たすまで、発生した摩擦をバックログへ還流する。
  - 2026-07-29 レビュー（4 runs-dir・13 runs を退避のうえ集計。退避先
    `~/.agent-delegator/harvest/2026-07-29/`）: 実タスク相当は 4 run。
    dogfood CHANGELOG（2026-07-27）= 完了判定 4項目ともクリア。
    daifuku PR2b（2026-07-28）= ゲート誤発火1（P5-5 → 修正済み）・フル再実行なし回復○・
    トークン観測 50%（timeout で implement 分欠落 → P5-17）。
    dinii 2 run = summary のみ確認（completed 2 / collection failed 1、evaluate 未記録 1）。
    中身のレビューは業務 config セッションで行う。**連続クリアは 0/3 からリスタート**。

## 変更履歴

- 2026-07-27: 初版。実利用調査の結果とオーナー合意（主眼・検証の場・権限・課金）を反映。
- 2026-07-27: オーナー判断により public 配布（MIT・npm alpha・marketplace/plugin）を Phase D として
  スコープ追加。非ゴールから public release / plugin 化を除外。
- 2026-07-29: 4 runs-dir・13 runs の trial レビュー。P5-5 修正・P5-9 の許容値表示＋gate_rejections
  計測修正。所見から P5-15〜P5-19 を起票、P5-14 の痛みを確認。T-2 の連続クリアは 0/3 から。
