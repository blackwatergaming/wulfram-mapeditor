# Contributing to Wulfram Forge

Editor contributions use GitHub's fork-and-pull-request workflow. The `main`
branch is the source for desktop releases and accepts changes only through
reviewed pull requests.

## One-time setup

Install Git, GitHub CLI, and Node.js 22.13 or newer. Authenticate GitHub CLI,
then create and clone your fork:

```bash
gh auth login
gh repo fork blackwatergaming/wulfram-mapeditor --clone
cd wulfram-mapeditor
npm ci
```

The editor runs independently with its checked-in browser assets and portable
test fixtures. For live map-repository integration, clone the maps repository
beside the editor checkout:

```bash
cd ..
gh repo clone blackwatergaming/wulfram-maps
```

## Make and verify a change

Update your fork from upstream and create a descriptive branch:

```bash
cd wulfram-mapeditor
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c editor/example-change
```

Run the browser development server with `npm run dev`. Before committing, run
the same portable verification gate used by pull requests:

```bash
npm run lint
npm run typecheck
npm test
npm run verify:formats
npm run build
```

`npm test` uses shipped maps from `../wulfram-debug/data/maps` when available
and otherwise uses the checked-in Crossroads fixture. Windows desktop packaging
requirements and commands are documented in [BUILD.md](BUILD.md).

## Open the pull request

Push the branch to your fork, then create a pull request against upstream
`main`. Replace the example username and branch as needed:

```bash
git add --all
git commit -m "Describe the editor change"
git push -u origin HEAD
gh pr create --repo blackwatergaming/wulfram-mapeditor --base main --head YOUR_GITHUB_USERNAME:editor/example-change --fill
```

Every pull request must pass validation, resolve all review conversations, and
receive approval from a repository administrator. New commits invalidate prior
approvals, and the person who made the latest change cannot provide the final
approval.

## Releases

Only administrators create `v*` tags. The release workflow accepts a tag only
when its commit belongs to the reviewed `main` history, reruns verification,
builds the Windows desktop archive, and publishes checksums with the GitHub
Release. Contributors should not create release tags in the upstream repository.
