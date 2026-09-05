# Contributing to Wulfram Forge

Editor contributions use GitHub's fork-and-pull-request workflow. The `main`
branch is the source for desktop releases. Contributor changes enter through
reviewed pull requests; a repository administrator may complete a release PR
without requiring another administrator's approval once validation passes.

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

Every pull request must pass validation and resolve all review conversations.
Contributor pull requests also require approval from a repository administrator;
new commits invalidate prior approvals, and the person who made the latest
change cannot provide that approval. The repository administrators `cyberbalsa`
and `0xLogic` have a review exception so either can complete their own release
PR. Required CI checks, administrator enforcement, and force-push/deletion
restrictions remain enabled.

## Releases

Only administrators create `v*` tags. One administrator can merge a validated
release PR and publish its tag; a second administrator is not required. The
release workflow accepts a tag only when its commit belongs to `main`, reruns verification,
builds the Windows desktop archive, and publishes checksums with the GitHub
Release. Contributors should not create release tags in the upstream repository.
