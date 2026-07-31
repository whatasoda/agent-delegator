---
name: agent-delegator
description: >-
  Delegate bounded implementation, autonomous improvement, repository-policy verification, or read-only repository research from the current Claude session
  to Codex via the agent-delegator CLI. Use when the user says "Codex に委譲", "Codex に調査を任せる",
  "agent-delegator で", or asks to trial an interactive Claude-to-Codex workflow. Requires the
  agent-delegator CLI and the Codex CLI.
---

# agent-delegator operator

この skill を使うセッションは設計・承認・統合のオーナーであり、実装または read-only 調査を Codex に委譲する。
コマンド仕様の正は `agent-delegator --help` とパッケージ同梱の README。

## 適用判断

委譲するのは「設計判断がこの会話で済んでいる、境界の定まった実装タスク」だけ。

- 向く: 複数ファイルの機械的変更、仕様確定済みの機能実装、テスト修正ループを伴う bounded な変更
- 向かない: 設計そのもの、ごく小さな編集（オーバーヘッド負け）、push/PR/デプロイを含む作業。
  Codex process はGit metadataや外部状態を変更しない。local commitだけは、専用branch/worktreeとclean
  approvalを確認したownerが`--commit=on-success`を明示した場合にcontrollerへ任せられる

## 前提チェック

`agent-delegator --version` が `0.1.0-alpha.9` を返すことを確認してから
`agent-delegator doctor --json` を実行する。CLI が無い、または別バージョンなら
`bun add --global @whatasoda/agent-delegator@0.1.0-alpha.9`（Bun >= 1.3.0 必須）で、この
operator が検証済みの CLI に揃える。`doctor` が失敗した状態で委譲を開始しない。
`doctor` の `codex_authentication.authenticated` も確認し、falseなら選択したhome/storeでloginを整える。

## パターン選択

- 仕様確定済みの実装は下記の標準運転手順を使う。Evidence Bundle → Brief → approval は省略しない。
- 原因・選択肢・影響範囲の調査は `research` を使う。Codex は read-only で、実装権限を持たない。
- 同じ調査 thread と論点を詰める場合だけ `follow-up` を使う。最初の follow-up 以降は run が
  `interactive` として観測される。
- 大きめの refactor など、Claude 側で goal / MUST / scope / acceptance を決めた後に同一 thread で
  複数回の自己レビューと改善を任せる場合は `loop` を使う。Brief review と approval は標準手順と同じ。
- 完成済み実装の smoke / verification を対象 repository の規約に沿って選ばせる場合は `verify` を使う。
- 親セッション終了後も継続すべき長時間処理だけ `--detach` を使う。比較的終わりが見える処理は前景の
  まま親にぶら下げる。`process` は端末非依存、`herdr` は専用タブを残したい場合に選ぶ。
- 比較 trial では `--variant=<label>` を付ける。後から `report` の pattern/variant 内訳と
  `history --pattern/--variant` で追える。

## 調査・対話手順

1. `agent-delegator research --objective="<調査目的。実装しないことも明記>" --task-type=investigation --complexity=<size> --variant=<label>`
2. `research.json` の finding と basis、uncertainties を Claude が検証する。
3. 追加の絞り込みが必要なら `agent-delegator follow-up --run <id> --message="<質問>"`。
4. `examples/research-evaluation-input.json` を基に `evaluate` を記録する。Brief/implementation は
   `not-applicable`、`ratings.research_quality` は根拠性・有用性・scope 遵守を評価する。

## 標準運転手順

ターゲットリポジトリの root で実行する。transcript は現セッションのプロセスツリーから自動解決
されるため、文脈の貼り付けや要約は不要。

1. **compile**（Codex read-only）:
   `agent-delegator compile --objective="<実装内容>" --task-type=<type> --complexity=<size> --tags=<a,b>`
   長大セッションで上限に当たったら `--max-transcript-input-bytes` / `--max-source-bytes`。
2. **Brief レビュー**（Claude の責務）: run dir の `brief.md` を読み、MUST / scope / acceptance が
   会話の決定と一致するか、citation が主張を支えるかを確認。source coverage は
   `evidence-bundle.json` の一覧と exclusions で確認する。
3. 修正が必要なら **`brief.json` を編集**（`brief.md` は表示用で、差分があると approve は拒否する）→
   `agent-delegator revalidate --run <id>`（Codex 再課金なしの完全再検証・決定的修復）。
4. **approve**: `agent-delegator approve --run <id>`
   - unresolved を残して進む場合のみ `--allow-unresolved`（理由をユーザーに示す）
   - compile 後にコミットが挟まった場合は、新 base で Brief を再確認してから `--allow-base-change`
5. **implement**（Codex workspace-write）:
   `agent-delegator implement --run <id>`。timeout は small なら既定 1800 秒、medium は概ね
   `--timeout-seconds=3600`、large refactor は `--timeout-seconds=7200` を開始目安にし、Brief の
   verification 規模に合わせて明示する。
   networkが必要なローカルproxyや依存取得だけ、ユーザーの意図とBrief境界を確認して
   `--network-access=enabled` を付ける。確実に遮断するtrialは`disabled`、未指定はCodex設定を継承し
   prompt上はunknownになる。network許可はdeploy等の外部mutationを許可しない。
   repository外のbrowser state/log directoryが必要なら、内容と他sessionへの影響をレビューして
   `--writable-root=<absolute-path>`を必要最小限だけ繰り返す。home全体やrepositoryの親は指定しない。
   workspace-writeでは実行不能で、ユーザーがhost境界を外す責任を明示的に引き受けた場合だけ
   `--sandbox=danger-full-access --allow-danger-full-access --sandbox-reason="<必要な理由>"`を使う。
   profileの`codex.implement/verify.requested_sandbox`は理由を再利用できるrequestであってgrantではない。
   compile/researchには使わず、network/writable-root指定と併用しない。次のresume/verifyには暗黙継承
   されないため、必要性を再評価して毎回owner grantを明示する。
   UI検証ではowner側でterminal非依存の明示名browser sessionを先に起動し、
   `--ui-session=<name>`を渡す。Codexにはrepository既定の接続手順でその名前だけを使わせる。
   sessionを交換するresume/loop/verifyでは新しい名前を明示し、handoffを外す場合は`none`を渡す。
   別セッション・別ターミナルから待つ場合は `agent-delegator wait --run <id>`。
   長時間の bounded 改善を任せる場合は、implement の代わりに
   `agent-delegator loop --run <id> --max-turns=<n> --max-minutes=<n>`。approved run では初回実装も
   行い、completed run では改善 turn から再開する。各 turn で approval / HEAD / worktree が再検証される。
   local commitまで任せる場合だけ、approval前にworktreeがcleanで専用branchにいることとGit identityを
   確認し、`--commit=on-success`を付ける。Codexではなくcontrollerがschema-validなcompleted/improved
   checkpointだけを1 commitにする。`--commit-message`は全turn共通overrideなので必要時だけ使う。
   作成SHAは`state.json`とattemptの`commit.json`でレビューする。このoptionはpush/tag/branch作成/PR/
   merge/rebase/amend/release/deployを許可しない。`--allow-base-change`とは併用せず新baseを再approveする。
6. **結果処理**: run dir の `result.json` を読む。
   - `completed` → 自分で diff をレビューし、必要なら
     `agent-delegator verify --run <id>` で repository 規約と Brief に基づく独立 smoke を委譲する。
     `verification.json` の command / basis / status を確認し、最終統合判断は自分で行う
     controller commit modeならdiffに加えて全`controllerCommits[].sha`をレビューし、push等は別途ownerが行う
   - `needs-decision` → focused question に1つだけ答える:
     `agent-delegator resume --run <id> --message="<決定と理由>"`（background）。
     回答が MUST / scope / 受入条件を変えるなら resume せず Brief 編集 → revalidate → 再 approve
   - `blocked` → 運用障害（権限・環境）を解消してから resume で状況を伝える
   - `loop` の `converged` / turn limit / time limit → `iteration.json` と最終 diff を自分でレビューする。
     `needs-decision` / `blocked` は通常の `resume` で扱える。limit 到達は完成の自己証明ではない
7. **evaluate**（毎 run）: `examples/evaluation-input.json` の形式で正直に記録:
   `agent-delegator evaluate --run <id> --evaluation=<file>`
   横断集計は `agent-delegator report --format=markdown`（controller_cost の gate_rejections が
   0 であることが健全性の目安）。全リポジトリ・全 worktree を跨いだ集計は
   `agent-delegator report --all --format=markdown`（run 作成時にマシンレベル registry へ自動登録
   される。消えた worktree の runs dir は unavailable として表示される）。
   最小状態履歴は `agent-delegator history` で任意のローカルディレクトリから確認できる。
   `post_implementation_iteration_failures` はinitial implementation failureと分けて評価する。
   implementationとverifyのnetwork/root policyは別に記録される。権限を広げたrunはroot別breakdownも
   確認する。UI session handoffは現在値だけでなくrun中に宣言した全sessionのbreakdownを確認する。

## 長時間実行とCodex領域

- `implement` / `loop` / `research --run` / `follow-up` / `verify`、および既存runの `compile` は
  `--detach --backend=process|herdr|auto` で監督ジョブ化できる。新規compileをdetachする場合は先に
  `collect` し、`compile --run <id> --detach` とする。
- `agent-delegator jobs --active` または `jobs --id <job-id>` でPID、run、ログ、終了状態を確認する。
  run自体の状態と中断回復は従来どおり `status` / `wait` を使う。
- `process` は親Claudeや端末が終了しても独立PIDで継続する既定backend。`herdr` は現在のHerdr
  workspaceに非フォーカスの専用tabを作る。Herdrを使っていない環境で暗黙に選ばない。
- run作成時に `--codex-home=isolated` を付けると設定・ログ・session履歴を専用のprivate領域へ分け、
  認証storeは既定で `keyring` にする。従来どおり全て共有する場合は `shared`（既定）、管理済みの
  絶対pathを使う場合はそのpathを指定する。`--codex-auth-store=auto|keyring|file|shared-file` で明示できる。
  既存loginがfileだけなら `shared-file` がauth.jsonだけをsymlinkする。認証をコピーしない。
  最初のCodex call後はresume互換性のため選択を変更しない。

## 失敗と回復

| 状況 | 回復 |
| --- | --- |
| compile が citation/schema 検証で failed | `revalidate --run <id>`（brief.json を seed → 手修正 → 再検証。Codex 再実行不要） |
| compile がそれ以外で failed | `compile --run <id> --retry` |
| implement / resume が failed | attempt の `checkpoint.json` / `worktree.patch` と実 worktree を確認してから `implement --run <id> --retry`。timeout/interrupt 後の部分 diff を理解した場合のみ `--allow-worktree-change` |
| loop iteration が failed | 同一 thread は `loop --run <id> --retry`、thread 喪失時は approved Brief から `implement --run <id> --retry` |
| resume の Codex thread 喪失 | `implement --run <id> --retry`（approved Brief から新セッションで再実装） |
| active のまま固着（PID 再利用等） | Codex プロセスの残存がないことを確認して `status --run <id> --force-fail` |
| inactive だが repository lock だけ残る | Codex プロセスの残存がないことを確認して `status --run <id> --force-unlock` |
| detached job が failed / lost | launcher/controllerの消失を含む。`jobs --id <job-id>` の stdout/stderr と `status --run <id>` を確認し、runの通常のretry手順を使う |
| verify が失敗 | `verificationFailure` と `attempts/verify/*` を確認する。実装runは completed のままなので、原因解消後に `verify` を再実行できる |

## 規律

- `--allow-*` は毎回理由を明示して使い、習慣化しない（ゲート拒否は observation の
  `gate_rejections` に記録され、報告に出る）。
- failed checkpointでは`lastWorktreeSha256`はtrusted baselineのまま、`observedWorktreeSha256`と
  changed-file count/patch bytesだけが進む。`--allow-worktree-change`時のstderr summaryを確認する。
- UI検証でChrome起動がsandboxに拒否されたら、sudo、`--no-sandbox`、proxy/daemon再起動を試さない。
  owner側で明示名のbrowser sessionを起動して`--ui-session=<name>`で宣言し、そのsessionだけへCodexを
  接続させる。宣言はliveness確認ではない。関連のないsession artifactを探索させない。
  長時間無人runはsessionがterminal終了後も残ることをowner側で確認してから`loop --detach`へ渡す。
  それでもworkspace-writeが阻害要因だと確認できた場合だけ、ユーザー責任の明示grantと監査理由を
  付けて`danger-full-access`を選ぶ。
- Codex stderr は `attempts/*/stderr.log` に保存済み。デバッグ時のみ
  `AGENT_DELEGATOR_STREAM_CODEX_STDERR=1` でライブ表示。
- Codex が標準名で見つからない環境は `AGENT_DELEGATOR_CODEX_COMMAND=/absolute/path/to/codex`。
- run ディレクトリ（`.agent-delegator/runs`）は transcript スナップショットを含む機微データ。
  公開・共有しない。
- モデル選択は `AGENT_DELEGATOR_BRIEF_MODEL` / `AGENT_DELEGATOR_IMPLEMENT_MODEL` /
  `AGENT_DELEGATOR_RESEARCH_MODEL` / `AGENT_DELEGATOR_VERIFICATION_MODEL`（未指定は
  Codex デフォルト）。
