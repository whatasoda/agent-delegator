# agent-delegator: design decisions and roadmap

この文書は、agent-delegator をなぜこの形にしたか、現在どこまで実装されているか、
最終的にどこへ向かうかを記録する。CLI の使い方は `README.md`、実際に確認された事実は
`CLAUDE_ACCEPTANCE_REPORT.md`、機械的な入出力契約は `schemas/` を正とする。

## 1. 問題設定

目標は、Claude Code を設計と統合のメインエージェント、Codex を実装エージェントとして
継続的に使えるようにすることにある。

単に「制約一覧を Codex に渡す」だけでは、制約が必要になった背景、検討した代替案、後から
上書きされた提案、未解決の判断が失われる。一方、すべての会話と repository を毎回そのまま
渡すと、無関係な話題、古い判断、instruction injection、token 消費によって品質が不安定になる。

したがって、次の両方を満たす必要がある。

- Claude が要求、設計、制約、その理由を十分に検討してから実装を委譲できる。
- 通常は一方向の handoff で進み、実装中に本当に判断が必要な場合だけ小さな往復ができる。

## 2. 役割分担

### Claude Code

- ユーザーとの要求整理、設計、優先順位付けを担当する。
- task に必要な evidence の範囲を選ぶ。
- Codex が生成した Implementation Brief を修正・承認する。
- `needs-decision` に回答し、最終 diff、検証、統合、ユーザーへの説明を所有する。

### compiler 用 Codex model slot

- 選択済み evidence から、すでに行われた判断を構造化する。
- accepted / rejected / superseded / proposed / unresolved を区別する。
- 設計者にはならず、根拠がない判断を補完しない。
- 安価な model を選ぶ想定だが、CLI は model slot を分離するだけで、自動的な価格/品質 routing は
  まだ行わない。未指定時は implementer と同じ Codex default になり得る。

### implementer 用 Codex model slot

- 承認済み Brief を task contract として実装する。
- repository の局所的な実装判断は行えるが、MUST や product decision を再設計しない。
- 判断が不足する場合は、編集を進めず `needs-decision` を返す。
- 高品質 model を選ぶ想定だが、実際の model は明示 flag、環境変数、Codex default の順で決まる。

### 開発作業の分類

| 作業 | 主担当 | handoff / escalation |
| --- | --- | --- |
| 要求、product behavior、architecture の検討 | Claude | 結論と背景を Evidence/Brief に残す |
| evidence の選択、approval、source coverage | Claude | 不足時は collect をやり直す |
| 現状調査と既決定事項の構造化 | read-only compiler | 不明点を unresolved にする |
| 境界が定まった実装、局所的な MAY 判断 | implementer | MUST/仕様衝突は `needs-decision` |
| 運用環境や権限等の障害 | Claude / 実行環境 | `blocked` として扱う |
| diff review、統合、commit/PR/release、ユーザー説明 | Claude | Codex は外部状態を変更しない |

複数の分類にまたがる task は、設計部分を Claude 側で終えてから実装部分だけを委譲する。

## 3. コミュニケーションモデル

標準経路は次のとおり。

```text
Claude の設計作業
  -> Context Request
  -> deterministic collect
  -> Evidence Bundle
  -> Codex compiler
  -> Claude review / approve
  -> Codex implementer
  -> completed
       or needs-decision -> Claude addendum -> same Codex session
       or blocked -> Claude が運用障害を解消/説明 -> same Codex session
```

大部分の通信は、明示的な artifact を介した一方向 handoff にする。小さい往復を完全になくすの
ではなく、`needs-decision` / `blocked` と同一 session の `resume` に限定して、判断の所在を明確にする。
Addendum は直前の focused question への回答だけである。MUST、scope、acceptance、product behavior を
変更する場合は Brief の編集・再compile・再approval、または新しい run が必要になる。

## 4. 決定済みの設計

### 4.1 transcript は起点だが、唯一の情報源ではない

Claude transcript は背景や意思決定の理由を含むため重要であり、現在 session を自動特定できる
ことにも価値がある。しかし、決定が複数 session、設計文書、issue、既存実装へ分散することを
前提に、共通の evidence source model の一種として扱う。

### 4.2 Claude が Context Request で範囲を選ぶ

現在は、Claude が transcript、turn range、repository file/glob、project-profile topic を明示する。
自動 discovery より先にこの境界を作ったのは、関連性の判断責任を Claude に残し、誤った自動
選択を見える形で修正できるようにするためである。

代償として、Stage 1 では source selection に手作業が残る。

### 4.3 collection と compilation を分離する

`collect` は Codex を起動せず、選択を解決して run-local snapshot と Evidence Bundle を作る。
Claude は compiler token を使う前に、coverage、除外、redaction、source role を確認できる。

小規模 task の摩擦を避けるため、`compile --objective=...` が collect も行う互換経路は残す。

### 4.4 Evidence Bundle を provenance の境界にする

各 source は ID、kind、role、trust、locator、revision、選定理由、snapshot hash を持つ。Brief の
decision、constraint、unresolved item は Bundle 内の source ID のみ引用できる。transcript turn
は選択範囲内でなければならず、file citation の turn は `null` にする。

validator は source ID、turn range、quote が snapshot/turn に実在することを検査する。これは
**citation referential integrity** であり、その引用が claim を意味的に裏付ける保証ではない。
semantic correctness は Claude の Brief review が所有する。compiler は現状確認のため repository を
read-only で参照できるため、未収集の情報を decision evidence にしないこと自体は prompt 上の規律で
あり、filesystem isolation ではない。

compile 時に引用語句が指定 turn にはなく、同じ transcript snapshot 内のただ一つの turn にだけ
実在する場合は、その turn を canonical Brief へ自動補正する。生の model output は attempt 配下に
保持し、補正前後は `citation-turn-corrections.json` と run metric に記録する。同一引用が複数 turn に
ある場合は意味上の帰属を推測せず、候補 turn を示して reject する。全文に存在しない引用も従来どおり
reject する。非 verbatim 引用の診断時は最長連続一致率が 50% 以上の turn を最大 3 件表示するが、
これは修正箇所を探すための情報に限定し、validation の合格や自動補正には使わない。approve 時には
自動補正を行わず canonical Brief を厳密に再検証するため、レビュー後の
誤編集を黙って修復することはない。

通常の text turn 番号は安定させたまま、構造的に対応を確認できる `AskUserQuestion` と user answer
だけを decision event として transcript snapshot に追記する。他の tool call/result は収集しない。
decision event の citation は transcript source ID と `turn: null` を使う。quote 照合は通常の空白
正規化を優先し、それで一致しない場合だけ Markdown 装飾や CJK 改行など presentation 差を無視する。
case や実際の語句差は引き続き不一致とする。

### 4.5 source content は instruction ではなく untrusted evidence

transcript、文書、実装ファイル内の命令文を compiler 自身への指示として実行しない。source role
は解釈を助ける metadata であり、prompt や Brief の authority order を上書きしない。

### 4.6 Brief は Claude が承認する task contract

Codex compiler の出力を直接実装へ渡さない。Claude が `brief.json` と rendered `brief.md` を確認し、
unresolved item を処理してから承認する。すべての MUST は rationale、failure mode、evidence を持つ。

引用の実在性と requirement の網羅性は別の検査である。text run についての引用だけから emote run を
含む全 payload の封印保証を導出することも、逆に全 payload への一般要件を text だけへ狭めることも
できない。security、privacy、authorization、validation、transformation、persistence のような横断的
invariant では、sum type、payload kind、state branch、entry point の適用領域を列挙する。repository
調査で未被覆 variant が見つかり、収集 evidence が振る舞いを決めていなければ、compiler は保証を
推測せず coverage gap を unresolved にする。Claude は evidence の再収集、追加決定、または明示的な
scope 制限のいずれかで解消してから承認する。

### 4.7 承認後は artifact 全体を hash で固定する

approval v3 は canonical/rendered Brief、Evidence Bundle、combined evidence、canonical repository root、
base commit、dirty-worktree fingerprint を固定し、Context Request と個別 snapshot も再検証する。
これは accidental drift と意図しない差し替えを防ぐ local integrity boundary であり、OS 上の悪意ある
writer に対する署名機構ではない。v1 approval は実行不可、v2 は再approval が必要である。

### 4.8 sandbox と外部操作の所有権を分ける

- compiler: `read-only`
- implementer/resume: `workspace-write`
- commit、push、PR、deploy、external mutation: Claude main agent

resume でも approval と HEAD を再検証し、sandbox を `workspace-write` に明示的に固定する。
raw transcript/Evidence は compiler の入力に限定し、implementer prompt には含めない。implementer は
承認済み Brief と repository の durable guidance を読み、不足を `needs-decision` に戻す。
repository policy がこれらの integration action を Codex に要求しても、compiler は MUST や
verification へ昇格させず unresolved conflict として返す。Brief validator も明示的な commit、push、
PR、merge、deploy 要求を approval 前に拒否する。

### 4.9 project profile は repository 固有のお作法を routing する

`agent-delegator.project.json` は default policy source と topic ごとの source set を定義する。
task-specific な選択は Context Request、長期的な project routing は profile と分離する。

### 4.10 repository-local だが、独立可能な配置にする

core CLI は application package から独立した専用 repository/package に置く。実利用と評価を先に
行い、interface が安定してから Claude plugin と standalone executable を追加する。
具体的な package 境界、release gate、Claude plugin、standalone executable の順序は
[`DISTRIBUTION.md`](./DISTRIBUTION.md) に固定する。

### 4.11 現在の runtime boundary

現在の standalone 性は「application package に依存しない repository-local tool」という意味である。
実行には Bun/TypeScript runtime、`Bun.Glob`、Git、`ps` を使う Claude process-tree layout、Codex CLI、
外部 prompt/schema assets が必要である。single binary や host-independent session discovery は未実装で、
独立 package 化の条件として別途扱う。

### 4.12 観測は run artifact と Claude 評価を結合する

trial の品質を判断するには、Codex の自己申告や test pass だけでは足りない。そのため、各 stage の
開始・完了・失敗、所要時間、attempt、model、Codex が返した token usage、失敗分類、参照 artifact を
versioned `run-events.jsonl` に残す。run 開始時の tool identity に加え、各 Codex attempt の起動前に
tool version、revision、dirty state、checkout worktree fingerprint を `attempt-metadata.json` へ固定し、
dirty checkout 上で validator や prompt を改修しながら再試行した場合も attempt と実装版を対応づける。
Git metadata を持たない package install では、実行中の source/bundle SHA-256 を識別子として残す。
compiler の生出力、Claude 承認後 Brief、承認時 worktree、各
implement/resume 後 worktree も別 artifact として保持する。

最終的な品質判断は Claude が `evaluate` で記録する。これは自動採点ではなく、受け入れ可否、Brief、
実装、communication、verification、issue category、自由記述を、Brief の編集量や Codex 後の追加変更と
結合する仕組みである。`report` は複数 run を task type、complexity、model、結果、失敗分類などで比較する。
usage を出さない Codex call も欠測率として残し、0 token と誤認しない。

この観測は品質との相関を調べる地盤であり、現時点で因果を証明する評価器ではない。少数 run の率を
一般化せず、評価 rubric の calibration と実 task corpus の蓄積を続ける。

## 5. 現在地: Stage 1

実装済み:

- process tree、session ID、明示 path による Claude transcript 解決
- 複数 transcript と inclusive turn range
- repository file/glob と project-profile topic
- source role、選定理由、optional exclusion
- credential-shaped value の redaction
- file count、source bytes、total bytes、binary、path/symlink escape の guard
- raw transcript input cap、static glob escape guard、runtime artifact の glob 除外
- run-local snapshot、Evidence Bundle、combined evidence
- source ID、transcript turn、exact quote の Brief citation validation
- turn番号を変えない構造化 AskUserQuestion decision event と限定的 presentation quote normalization
- Brief/result/state schema validation、approval v3、hash/HEAD/worktree verification
- delegated execution policy の compiler rule と禁止 integration action の approval guard
- read-only compile、workspace-write implement、同一 session resume
- private run artifacts、timeout、stderr persistence、attempt count、attempt 単位の tool fingerprint、明示 retry、stale-state recovery
- task metadata、append-only stage event、attempt ごとの raw output/prompt/checkpoint
- generated/approved Brief comparison、Claude acceptance evaluation、cross-run JSON/Markdown report
- token telemetry coverage、stage timing、failure taxonomy、task/model/outcome breakdown
- fake-Codex integration tests と real Claude/Codex acceptance E2E

Stage 1 の意図は「自動で最適な context を探すこと」ではなく、「Claude が選んだ context を安全かつ
監査可能に固定し、後続の自動化が依存できる protocol を確立すること」にある。

## 6. 理想形とのギャップ

| 領域 | 現在 | 理想形 |
| --- | --- | --- |
| Source selection | Claude が path/topic/turn を指定 | 候補を自動提示し、Claude が低コストで承認・修正 |
| Source types | Claude transcript、repository file/glob | issue、PR、review、external docs、複数 agent artifact、API source |
| Discovery | profile の静的 routing | metadata + semantic/hybrid search、task-aware ranking |
| Conflict handling | compiler が unresolved として表現 | provenance graph 上で stale/conflicting decision を事前検出 |
| Context budget | file/byte count の上限 | model/token budget に応じた selection、compression、priority allocation |
| Project knowledge | 単一 profile | profile composition、inheritance、versioning、organization policy |
| Evaluation | run ごとの Claude rubric、Brief/worktree 自動比較、cross-run 集計 | rubric calibration、corpus-based extraction accuracy、citation precision、長期 outcome metrics |
| Distribution | private versioned Bun package | standalone CLI、Claude plugin、adapter SDK、public release |
| Observability | stage timing、usage 欠測率、failure taxonomy、attempt/checkpoint、比較可能な report | pricing-aware cost、trace viewer、dashboard、longitudinal alerts、外部 telemetry export |
| Recovery | timeout、attempt、明示 retry、stale controller 検出 | resumable operation journal、host crash 後の安全な自動診断 |

## 7. ロードマップ

### Now — Stage 1 を trial 運用可能にする

- 実 task で Context Request の書きやすさと profile topic の粒度を評価する。
- collection/approval の integrity と失敗時の診断を実 task で評価する。
- Claude/Codex の version 差や sandbox 差を継続的に acceptance test する。
- extraction quality の fixture corpus を作り始める。
- 実 task の終了時に Claude evaluation を記録し、task type/complexity ごとの母数を蓄積する。
- token coverage と評価 rubric のばらつきを観測し、比較に使える条件を決める。
- 少なくとも2つの実 repository（うち1つは異なる言語/build system）で
  `CLAUDE_CROSS_REPOSITORY_VALIDATION_HANDOFF.md` を実行し、project-policy portability、
  Context Request authoring friction、cross-run比較の不足を記録する。

### Next — source adapter と選択支援

- transcript/session catalog を列挙し、Claude が候補を選べるようにする。
- Git diff、issue、PR/review、任意 command output 等を共通 source adapter にする。
- Context Request の authoring/validation helper を追加する。
- profile composition と task type ごとの route を導入する。
- source coverage、重複、conflict、staleness を compile 前に診断する。
- model と token budget に応じた deterministic trimming を導入する。

自動選択は、必ず「候補提示 -> Claude の確認 -> snapshot」の順にする。少なくとも評価指標が
整うまでは、自動 discovery が黙って decision evidence を追加しない。

### Later — discovery と独立 platform 化

- lexical + semantic/hybrid index による横断 discovery
- decision/provenance graph と supersession tracking
- task complexity に応じた compiler/implementer model routing
- adapter SDK、plugin interface、versioned schemas、migration tooling
- standalone executable と署名済み release distribution
- 実装結果を selection/compiler quality に戻す評価 loop

## 8. public release / plugin へ進む条件

core CLI の履歴付き独立 package 化は trial の再現性を優先して完了した。次を満たすまでは package を
private / prerelease に保ち、public registry release や互換性を約束する Claude plugin へ進まない。

- 複数の実 task で Context Request と Evidence Bundle の schema が安定している。
- 少なくとも2種類の project profile で routing が機能する。
- source adapter interface が transcript/file 固有の事情から分離されている。
- run-store の versioning と migration 方針が決まっている。
- authentication、sandbox、configuration の host 差を文書化できている。
- extraction と implementation outcome を再現可能に評価できる。

切り出す際も、project profile と Claude skill は利用 repository 側に残し、CLI/core、schema、adapter
interface、generic prompts を独立 package 側へ移す。

## 9. 明示的な非目標

- Claude を経由せず Codex が product design を確定すること。
- source を大量投入すれば品質が上がるという前提に立つこと。
- local hash を署名や hostile local writer への防御として扱うこと。
- approval を人間/Claude による内容確認の代替にすること。
- trial 前に汎用 agent framework や検索 platform を完成させること。

## 10. 未決定事項

- 最初に追加する repository 外 source adapter は issue/PR、別 session catalog、明示指定した外部文書の
  どれか（現在の repository file source と混同しない）。
- Context Request を Claude が直接 JSON 生成するか、対話的 CLI builder を用意するか。
- profile の inheritance と organization-wide policy をどこで解決するか。
- stale source の基準を Git revision、mtime、明示 version のどれに寄せるか。
- token budget と source priority を Context Request に含めるか、compiler policy に置くか。
- approval を将来外部署名する必要があるか、それとも local workflow のままにするか。
- standalone 化を npm package、single binary、Claude plugin のどれから始めるか。

## 11. 判断を更新するときのルール

- 既存判断を変更する場合は、元の背景、変更理由、影響する schema/behavior を残す。
- 実装済みの事実と将来案を混同せず、Stage と status を明記する。
- acceptance report の実証結果を設計上の意図へ書き換えない。
- 大きな architecture decision はこの文書へ反映し、CLI の詳細は README に残す。
