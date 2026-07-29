---
name: agent-delegator
description: >-
  Delegate a bounded, already-designed implementation task from the current Claude session to Codex
  via the agent-delegator CLI (Evidence Bundle → Brief → approval → workspace-write implementation).
  Use when the user says "Codex に委譲", "agent-delegator で", "delegate this implementation to
  Codex", or when a designed change should be implemented by Codex while this session keeps design,
  approval, and integration ownership. Requires the agent-delegator CLI and the Codex CLI.
---

# agent-delegator operator

この skill を使うセッションは設計・承認・統合のオーナーであり、実装だけを Codex に委譲する。
コマンド仕様の正は `agent-delegator --help` とパッケージ同梱の README。

## 適用判断

委譲するのは「設計判断がこの会話で済んでいる、境界の定まった実装タスク」だけ。

- 向く: 複数ファイルの機械的変更、仕様確定済みの機能実装、テスト修正ループを伴う bounded な変更
- 向かない: 設計そのもの、ごく小さな編集（オーバーヘッド負け）、commit/push/デプロイを含む作業。
  委譲 run は外部状態を変更しない — commit 以降は必ずこのセッションがレビュー後に行う

## 前提チェック

`agent-delegator --version` と `codex --version` が通ること。CLI が無ければ
`bun add --global @whatasoda/agent-delegator@alpha`（Bun >= 1.3.0 必須）。

## 標準運転手順

ターゲットリポジトリの root で実行する。transcript は現セッションのプロセスツリーから自動解決
されるため、文脈の貼り付けや要約は不要。

1. **compile**（Codex read-only。数分かかるため必ず shell の background 実行で完了通知を待つ。
   ポーリングしない）:
   `agent-delegator compile --objective="<実装内容>" --task-type=<type> --complexity=<size> --tags=<a,b>`
   長大セッションで上限に当たったら `--max-transcript-input-bytes` / `--max-source-bytes`。
2. **Brief レビュー**（Claude の責務）: run dir の `brief.md` を読み、MUST / scope / acceptance が
   会話の決定と一致するか、citation が主張を支えるかを確認。source coverage は
   `evidence-bundle.json` の一覧と exclusions で確認する。
3. 修正が必要なら **`brief.json` を編集**（`brief.md` の編集は approve 時に破棄される）→
   `agent-delegator revalidate --run <id>`（Codex 再課金なしの完全再検証・決定的修復）。
4. **approve**: `agent-delegator approve --run <id>`
   - unresolved を残して進む場合のみ `--allow-unresolved`（理由をユーザーに示す）
   - compile 後にコミットが挟まった場合は、新 base で Brief を再確認してから `--allow-base-change`
5. **implement**（Codex workspace-write。background 実行で完了通知を待つ）:
   `agent-delegator implement --run <id>`
   別セッション・別ターミナルから待つ場合は `agent-delegator wait --run <id>`。
6. **結果処理**: run dir の `result.json` を読む。
   - `completed` → 自分で diff をレビューし、Brief の verification を実行してから統合する
   - `needs-decision` → focused question に1つだけ答える:
     `agent-delegator resume --run <id> --message="<決定と理由>"`（background）。
     回答が MUST / scope / 受入条件を変えるなら resume せず Brief 編集 → revalidate → 再 approve
   - `blocked` → 運用障害（権限・環境）を解消してから resume で状況を伝える
7. **evaluate**（毎 run）: `examples/evaluation-input.json` の形式で正直に記録:
   `agent-delegator evaluate --run <id> --evaluation=<file>`
   横断集計は `agent-delegator report --format=markdown`（controller_cost の gate_rejections が
   0 であることが健全性の目安）。全リポジトリ・全 worktree を跨いだ集計は
   `agent-delegator report --all --format=markdown`（run 作成時にマシンレベル registry へ自動登録
   される。消えた worktree の runs dir は unavailable として表示される）。

## 失敗と回復

| 状況 | 回復 |
| --- | --- |
| compile が citation/schema 検証で failed | `revalidate --run <id>`（brief.json を seed → 手修正 → 再検証。Codex 再実行不要） |
| compile がそれ以外で failed | `compile --run <id> --retry` |
| implement / resume が failed | worktree を確認してから `implement --run <id> --retry`。部分 diff を理解した場合のみ `--allow-worktree-change` |
| resume の Codex thread 喪失 | `implement --run <id> --retry`（approved Brief から新セッションで再実装） |
| active のまま固着（PID 再利用等） | Codex プロセスの残存がないことを確認して `status --run <id> --force-fail` |

## 規律

- `--allow-*` は毎回理由を明示して使い、習慣化しない（ゲート拒否は observation の
  `gate_rejections` に記録され、報告に出る）。
- Codex stderr は `attempts/*/stderr.log` に保存済み。デバッグ時のみ
  `AGENT_DELEGATOR_STREAM_CODEX_STDERR=1` でライブ表示。
- run ディレクトリ（`.agent-delegator/runs`）は transcript スナップショットを含む機微データ。
  公開・共有しない。
- モデル選択は `AGENT_DELEGATOR_BRIEF_MODEL` / `AGENT_DELEGATOR_IMPLEMENT_MODEL`（未指定は
  Codex デフォルト）。
