# Attribution

PARA and CODE are methods created by Tiago Forte. This starter explains them in its own words and does not reproduce his course material.

James Croft's MIT-licensed second-brain template helped establish the idea that a readable Markdown template can be shared openly. This package contains original files, copies no code or template content from it, and does not imply endorsement by James Croft.

See [PARA-CODE.md](template/03-Resources/PARA-CODE.md) for the working definitions used here.

## Bundled third-party skill: icm-architect

The `icm-architect` skill in [template/shared-skills/icm-architect/](template/shared-skills/icm-architect/SKILL.md) was written by Jake Van Clief. Its upstream repository is https://github.com/RinDig/icm-architect and the files here were copied unmodified from commit `e16cafe6a664dcf6d787a726b452adba77d913f4`. It is MIT-licensed. The upstream [LICENSE](template/shared-skills/icm-architect/LICENSE) file ships inside the bundled folder and is installed with the skill.

The skill applies the Interpretable Context Methodology described in the ICM paper by Van Clief and McDermott (arXiv:2603.16021).

This starter's own differences from the method live in the separate `second-brain-icm` skill, so the bundled files stay identical to upstream. Bundling the skill does not imply endorsement of this starter by Jake Van Clief or the paper's authors.

## Bundled third-party system: Spec Harness

[Spec Harness](vendor/spec-harness/README.md) was written by Malik Chohra. Its upstream repository is https://github.com/chohra-med/spec-harness-oss and the files in `vendor/spec-harness/` were copied unmodified from commit `a663397c2aafa35071fb1fe899bd6a174cd423e6`, harness version 0.2.0. It is MIT-licensed, and the upstream [LICENSE](vendor/spec-harness/LICENSE) ships inside the vendored folder.

The copy is bundled only. Nothing in this starter reads it yet, it is not part of the workspace template, and the starter never runs its shell scripts. `vendor/SPEC-HARNESS-PIN.json` records the commit, tree and a SHA-256 for every vendored file, and `test/vendor.test.mjs` checks the folder against that record.
