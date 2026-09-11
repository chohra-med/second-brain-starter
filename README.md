# Second Brain Starter

A free, plain Markdown starter for one active project. Plain Markdown and manual local-file use are supported in a text editor or with a local-file-capable AI assistant that you explicitly point at these files. Current Obsidian desktop compatibility has not been verified, so test a copied workspace before relying on it. Nothing here installs itself, discovers files for you, or grants an assistant access.

**Release status:** `v1.0.0` is the published public release. `v1.0.1` is an unreleased source repair. The public source repository is `chohra-med/second-brain-starter`; this README does not announce a `v1.0.1` release.

## License and boundaries

This starter is licensed under the [MIT License](LICENSE). You may use, copy, modify, publish, distribute, sublicense, and sell copies under those terms. Keep the copyright and license notices with substantial copies.

This is the free Second Brain foundation. It contains PARA, CODE, the one-project workflow, and the manual procedures below. It does not include a private application, automatic installation, native file discovery, a mobile-only workflow, a cloud-only assistant without local file access, a support call, installation service, or an outcome guarantee.

Read [PRIVACY.md](PRIVACY.md), [ATTRIBUTION.md](ATTRIBUTION.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before sharing a copy.

## Get started

### 1. Get a copy

For a published release, choose one route:

- **Git:** clone the repository to a location you control. Git is optional for using the starter and useful only when you want to pull later updates.
- **ZIP:** download a release ZIP, extract it, and keep the extracted folder as your untouched base copy.

For the unreleased `v1.0.1` source repair, do not treat this folder as a release download. Keep its structure intact. Before entering your own facts, duplicate the folder and work in the duplicate. Your base copy is your recovery point.

### 2. Set up one project

1. Open [Home.md](Home.md).
2. Choose one active project. Do not turn this into a life archive on day one. That way lies tasteful digital archaeology.
3. Replace bracketed examples in [facts](01-Projects/Selected-Project/FACTS.md), [roadmap](01-Projects/Selected-Project/roadmap.md), [progress](01-Projects/Selected-Project/progress.md), and [project decisions](01-Projects/Selected-Project/Decisions.md).
4. A text editor is enough. You may test a copied folder as an Obsidian vault, but current Obsidian desktop compatibility is not verified.
5. For an AI session, paste the manual route from [00-Meta/AGENTS.md](00-Meta/AGENTS.md) and name the selected project folder. Use an assistant that can read local files only when you explicitly give it that access.

### 3. Run the free first loop

This loop uses only files in this starter:

1. **Capture:** add one real incoming task to the selected project's [roadmap](01-Projects/Selected-Project/roadmap.md) with an owner, `Open` status, evidence for done, and one next action. Follow [capture](03-Resources/Procedures/capture.md).
2. **Context:** read the project route and return the compact context note from [context](03-Resources/Procedures/context.md).
3. **Do and close:** complete the next action. Record what changed and its evidence in [progress](01-Projects/Selected-Project/progress.md), then use [close](03-Resources/Procedures/close.md). A task is not `Verified` until its stated evidence exists.
4. **Review:** before a handoff or weekly, use [review](03-Resources/Procedures/review.md). Repair any mismatch between a `Done` claim and its required evidence, then name one `Next` action.

PARA gives records a home and CODE gives work a direction. Read [PARA + CODE](03-Resources/PARA-CODE.md) when you need the definitions.

## Update safely

The current version is recorded in [VERSION](VERSION). Read [CHANGELOG.md](CHANGELOG.md) and [UPGRADING.md](UPGRADING.md) before replacing any files.

Never overwrite your personalized workspace with an update. Keep your project facts, roadmap, progress, decisions, and daily work in your working copy. Start each update from a fresh Git pull or ZIP extraction, compare it with your working copy, and manually bring over only the template or procedure changes you want. If an update changes a template, copy the new structure first and then move your existing information into it. Keep a dated copy of your working folder before any migration.

## Recovery and removal

If a change goes wrong, stop editing the affected copy. Restore your last copied workspace or return to the untouched base copy, then manually reapply only the verified information from your facts, roadmap, progress, and decisions. Your records are plain Markdown, so they remain readable without Obsidian.

To remove the starter, first keep any Markdown files you want to retain. Then delete your copied workspace and, if you used Git, your local clone. Removing a local copy cannot revoke rights granted by the MIT License for copies you already received.

## Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md). `v1.0.1` remains unreleased; use the public repository's current contribution route for proposed source changes.
