# Privacy boundary

Second Brain Starter is a local source package. Its initializer reads only the package manifest and the managed files it names. It does not recursively read a parent folder, inspect unrelated project files, read `.env` files or credentials, or send project content anywhere.

The installer rejects unsafe targets, target escape, symlinked destination ancestors, unmanaged root loaders, and ordinary differing managed files. These are filesystem checks performed by the initializer. Markdown instructions for an AI client are different: they guide a client that has already been given local-file access. They do not grant access, sandbox a client, enforce compliance, or support every future client version.

The installed target stores state, backups, and transaction-scoped rollback receipts under `.second-brain/`. Those local records include managed relative paths, hashes, and receipt identifiers. They are not a shipped template payload and should not contain home paths, credentials, or client data.

This package has no telemetry, analytics, network service, global install, background process, or permission change. Node.js runs the initializer from the source copy you choose. Before sharing a modified copy, run the package scanner and review the complete reported path list; the scanner reports rules and relative paths only, never matched secret text.

Keep local projects private when they contain private information. A plain Markdown workspace can be copied as easily as any other local files.
