# Attribution

PARA and CODE are methods created by Tiago Forte. This starter explains them in its own words and does not reproduce his course material.

James Croft's MIT-licensed second-brain template helped establish the idea that a readable Markdown template can be shared openly. This package contains the starter's own files and the bundled third-party folders listed below. The starter's own files are original. They copy no code or template content from James Croft's template, and they do not imply endorsement by James Croft.

See [PARA-CODE.md](template/03-Resources/PARA-CODE.md) for the working definitions used here.

## Bundled third-party skill: icm-architect

The `icm-architect` skill in [template/shared-skills/icm-architect/](template/shared-skills/icm-architect/SKILL.md) was written by Jake Van Clief. Its upstream repository is https://github.com/RinDig/icm-architect and the files here were copied unmodified from commit `e16cafe6a664dcf6d787a726b452adba77d913f4`. It is MIT-licensed. The upstream [LICENSE](template/shared-skills/icm-architect/LICENSE) file ships inside the bundled folder and is installed with the skill.

The skill applies the Interpretable Context Methodology described in the ICM paper by Van Clief and McDermott (arXiv:2603.16021).

This starter's own differences from the method live in the separate `second-brain-icm` skill, so the bundled files stay identical to upstream. Bundling the skill does not imply endorsement of this starter by Jake Van Clief or the paper's authors.

## Bundled third-party skill: humanizer

The `humanizer` skill in [template/shared-skills/humanizer/](template/shared-skills/humanizer/SKILL.md) was written by Adam Boudjemaa. Its upstream repository is https://github.com/Aboudjem/humanizer-skill, subpath `skills/humanizer`, and the files here were copied unmodified from commit `a58df065367550b6ce40ff3f648335018d8e0589`. It is MIT-licensed. The upstream subfolder has no licence file of its own, so the repository's root [LICENSE](template/shared-skills/humanizer/LICENSE) was copied next to the skill unchanged. That file is installed with the skill.

## Original skills: grill-me, readme-generator, graphify, writing-skills, usage-dashboard and scroll-story-component

The skills `grill-me`, `readme-generator`, `graphify`, `writing-skills`, `usage-dashboard` and `scroll-story-component` in `template/shared-skills/` were written for this repository by its author. They are original to this repository and are licensed under the repository's own MIT licence, see [LICENSE](LICENSE). `writing-skills` points to an optional outside `skill-creator` folder and does not copy it. `scroll-story-component` points to the separate MIT package `chohra-med/scroll-story` by the same author and does not copy its code. For `graphify`, the outside tool it describes is separate software, as the note below explains.

## Optional companion: graphify

The `graphify` skill in [template/shared-skills/graphify/](template/shared-skills/graphify/SKILL.md) is written for this starter. It describes how to use an outside tool at https://github.com/Graphify-Labs/graphify. That tool is separate software. It is not bundled and not installed by this starter, and its licence is set by its own project. Check that licence before you install the tool. The skill works only if you install the tool yourself.

## Bundled third-party system: Spec Harness

[Spec Harness](vendor/spec-harness/README.md) was written by Malik Chohra. Its upstream repository is https://github.com/chohra-med/spec-harness-oss and the files in `vendor/spec-harness/` were copied unmodified from commit `49fad7c694feacc530d5e79ab905c7990090397e`, harness version 0.5.0. It is MIT-licensed, and the upstream [LICENSE](vendor/spec-harness/LICENSE) ships inside the vendored folder.

The copy is not part of the workspace template. The `connect` command reads the vendored install manifest and the files it names, and writes rendered copies of them into a repository you name. No code in `lib` or `bin` starts a process, so the vendored shell scripts are never executed; `bin/loop.sh` is copied as bytes only. `vendor/SPEC-HARNESS-PIN.json` records the commit, tree and a SHA-256 for every vendored file, and `test/vendor.test.mjs` checks the folder against that record.
