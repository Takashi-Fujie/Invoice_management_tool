# 公開・中断再開の手順

明示的に依頼されたリリースだけに使う。利用中リポジトリのリモートから公開先を確認する。以下の変数は合意した番号・確認した値を設定し、作業ディレクトリは対象のリリースworktreeとする。

- `release_version`：合意したバージョン番号。
- `release_branch`：`codex/release/<バージョン>`。
- `release_sha`：検証が完了した候補のコミットSHA。
- `release_repo`：確認したGitHubの`owner/repo`。
- `release_pr_title`：今回の変更目的を表すPRタイトル。
- `release_notes`・`release_tag_message`・`release_pr_body`：今回作成して内容を確認した一時ファイルの絶対パス。秘密情報や実データを含めず、Gitへステージしない。

## 1. 先に公開状態を読む

```sh
git status --short --branch
git ls-remote origin refs/heads/main "refs/heads/$release_branch" "refs/tags/$release_version" "refs/tags/$release_version^{}"
gh release view "$release_version" --repo "$release_repo" --json url,tagName,targetCommitish,isDraft,isPrerelease,publishedAt
gh pr view "$release_branch" --repo "$release_repo" --json number,url,state,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup
```

未作成のPR・Releaseの404と、認証・通信の失敗を区別する。コマンドがタイムアウトした場合は、失敗とも成功とも決めつけず実際の状態を読み直す。

- 正式なReleaseがあり、main・タグの参照先も候補と一致：重複作成せず公開後の確認へ進む。
- タグ・mainだけ公開済み：タグの参照先と名義を確認してRelease作成へ進む。
- 同名のタグがローカルだけにある：対象SHA・注釈・タグ作成者が正しければ再利用する。
- 同名のタグ・Releaseが別のSHAを指す、mainに未確認の変更がある：公開操作を止め、差分と影響を示す。削除・付け替え・force-pushで解消しない。

## 2. 候補ブランチとPRを揃える

push前に新規コミット全件の作者・コミッターを確認する。確認済み候補をリリースブランチへ通常pushし、GitHub上でも新規コミットの作者・コミッターが本人のアカウントへ紐付くことを確認する。

```sh
git push origin "${release_sha}:refs/heads/$release_branch"
gh api "repos/$release_repo/commits/$release_sha" --jq '{sha:.sha,author:.author.login,committer:.committer.login,author_email:.commit.author.email,committer_email:.commit.committer.email}'
```

PRがなければmainをbaseに作成する。本文は変更後の利用者の操作・データ互換性・実行した検証・未確認事項を記す。既存PRがあれば内容とhead SHAを確認する。GitHub連携が使える操作は優先し、未対応・権限不足なら本人認証済み`gh`へ切り替える。

```sh
gh pr create --repo "$release_repo" --base main --head "$release_branch" --title "$release_pr_title" --body-file "$release_pr_body"
```

PR本文・Release本文はファイルで渡し、改行を維持する。CIがある場合は結果を確認し、実行がない場合は手元の検証結果と区別する。

## 3. mainと注釈付きタグを公開する

公開直前に作業ツリーがクリーンであること、ローカルHEAD・リモートの候補ブランチが`release_sha`であることを確認する。リモートmainは直前の公開タグと一致し、候補がその子孫であることを確認する。不一致があれば理由を調べる。署名・保護ブランチ・必須チェック等の条件も確認し、設定を緩めない。

新規タグの作成前にローカル・リモート両方で同名タグの有無を確認する。作者・コミッターと同じ本人情報を確認し、注釈付きタグを作る。タグ本文には変更の要点と検証結果を記す。

```sh
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git tag -a "$release_version" "$release_sha" -F "$release_tag_message"
git for-each-ref "refs/tags/$release_version" --format='%(refname) %(objecttype) %(taggername) %(taggeremail)'
git rev-parse "$release_version^{commit}"
```

このリポジトリでは本人の実メールをコミッターにも記録する必要がある。検証済みコミットへmainをfast-forwardできる場合は、GitHub側のマージコミットを新たに作らず、同じSHAを公開する。mainとタグは可能ならatomic pushで一括更新する。

```sh
git push --atomic origin "${release_sha}:refs/heads/main" "refs/tags/$release_version"
```

通常pushのままとし、forceオプションを付けない。保護ルールや認証で拒否された場合は実際の参照先を再確認し、設定変更や履歴の上書きで回避しない。atomic非対応なら、mainの通常fast-forwardとタグ公開を順に行い、各結果を確認する。途中で中断してもこの資料の最初から状態を読み直す。

mainへの反映後、PRが同じSHAでマージ済みになったことを確認する。別worktreeのローカルmainをreset・checkoutして合わせる必要はない。

## 4. GitHub Releaseを作る

Releaseが未作成の場合に実行する。本文には今回の変更、互換性・移行の有無、検証結果と未確認事項、対象タグに固定した導入資料へのリンクを含める。実際の新規clone検証も記録する。今回は正式公開かプレリリースかを依頼に沿って判断し、既存の下書きがある場合は対象と内容を照合する。

通常の正式公開では、既存タグを検証して同じSHAを指定する。

```sh
gh release create "$release_version" --repo "$release_repo" --title "$release_version" --notes-file "$release_notes" --verify-tag --target "$release_sha" --latest
```

既存のReleaseや本文を無断で作り直さない。通信失敗後は公開済みか確認してから再試行する。リリース済みタグへ後から変更を追加しない。

## 5. 公開後に実体を確認する

```sh
git fetch origin --prune --tags
git rev-parse origin/main "origin/$release_branch" "$release_version^{commit}"
gh release view "$release_version" --repo "$release_repo" --json url,tagName,targetCommitish,isDraft,isPrerelease,publishedAt
gh api "repos/$release_repo/releases/latest" --jq '{url:.html_url,tag:.tag_name,draft:.draft,prerelease:.prerelease}'
gh pr view "$release_branch" --repo "$release_repo" --json state,mergedAt,mergeCommit,url
git status --short --branch
```

main・候補ブランチ・タグが検証済みの同じSHAであること、Releaseが意図した公開状態であること、GitHub上の名義と導入リンクが正しいことを照合する。古い正式バージョンの再確認やプレリリースでは、latestであることを要求しない。確認できた公開URL・SHA・検証結果を記録し、失敗・未確認は区別して報告する。
