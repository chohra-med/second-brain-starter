---
name: graphify
description: Query a knowledge graph of your notes to find candidate links, then check each link in the current source files. Use only when the optional graphify tool is installed and you have a graph file. A graph result is a pointer to check, never the answer.
---

# Graphify: graph queries

Graphify is an optional outside tool. It builds a graph of the links between your Markdown notes. This starter does not bundle or install it. This skill says how to use a graph if you already have one. The tool is separate software, at https://github.com/Graphify-Labs/graphify. Check its own licence before you install it. See ATTRIBUTION.md.

## Do not use this when

- The graphify tool is not installed on your machine.
- You have no graph file. Search the files directly instead.
- The question concerns a fact that changes often, such as a price or a version. Read the owning file.

## The rule

A graph result is a pointer. It is not the source of truth.

- The graph can be stale. It was built from the files as they were at build time.
- The graph can be incomplete. A build can leave out files, or it can cap the number of nodes it keeps. Check the tool's documentation for its limits.
- A hit does not prove a file is current.
- A miss does not prove a fact is absent.

Before you rely on a result, open the file the result names and read the text there.

## Step 0: Search by keyword first

Search the folders the person named for the exact words first, with a plain text search. If no folder is named, ask which. Use the graph only to find related pages the words did not reach.

## Step 1: Check the tool

Run `graphify --help` to confirm the tool is installed and to see its current flags. If the tool is missing, stop here. Use a plain text search instead.

## Step 2: Query the graph

Check the stamp first. Use the BUILT-FROM.txt that sits next to the graph file you are querying and whose `graph` line names that file. If it is missing, names another graph, lacks a `built`, `graph` or `value` line or any `folder` line, or its `value` is not 64 lowercase hex characters, call the graph UNKNOWN in your answer and prefer the keyword search. Otherwise run the command from Step 4 (saved as `stamp.sh`, run as `bash stamp.sh "<folder>" ...`), from the notes folder, with each `folder` line as one quoted argument. If the command fails or prints nothing, call the graph UNKNOWN. If its result differs from the `value` line, call the graph STALE and prefer the keyword search. If it is equal, say "stamp matches". A matching stamp does not replace Step 3: open each file the result names.

```bash
graphify query "<topic or concept>" --budget 2000 --graph "<path to the graph JSON file>"
```

`--budget N` caps the output at N tokens. The default is 2000. `--graph` names the graph file; if you leave it out, the tool reads `graphify-out/graph.json`. Checked against graphify 0.8.25 (`graphify --help`).

## Step 3: Check each result

1. Note each candidate link and the source file it names.
2. Open that source file.
3. Read the text that supports the link.
4. If the file has changed, is missing, or does not contain the text, drop the result. Say so in your notes.
5. If the query returned nothing useful, search the files directly.

## Step 4: Build a graph (optional)

Follow the tool's own build instructions. Keep these limits:

- Give the builder only folders you are allowed to read. Do not point it at a whole home folder.
- Write the output to a new file. Do not overwrite a graph that someone else uses.
- Keep the graph out of version control unless you mean to share it. A graph file can name private paths.
- Delete any BUILT-FROM.txt that is already there before the build, so a failed or skipped stamp never leaves an old one behind.
- After a build, write BUILT-FROM.txt next to the graph file, one `key: value` per line: `built` (the date), `graph` (the graph file name), one `folder` line for each folder given to the builder (relative to the notes folder, the folder you run from; spaces in the name are fine) and `value` (the 64 hex characters the command below prints, nothing else). Write no stamp if the command fails or prints nothing, if the command's value is not the same before and after the build, or if the builder also read files that are not Markdown.

  ```bash
  set -o pipefail
  [ "$#" -gt 0 ] || exit 1
  files=$(find -L "$@" -type f \( -iname '*.md' -o -iname '*.markdown' \) -print0 | LC_ALL=C sort -z | xargs -0 -r shasum -a 256) || exit 1
  [ -n "$files" ] || exit 1
  printf '%s\n' "$files" | shasum -a 256 | cut -d' ' -f1
  ```

  Save the block as a file outside the notes folder, for example `stamp.sh`, and run `bash stamp.sh "<folder>" "<folder>"` from the notes folder, one quoted argument for each folder. Run it before the build and again after it. Where `shasum` is missing, use `sha256sum` in both places, and use the same tool every time: the two can differ for file names with a backslash or a newline. The hash covers the path and content of every `.md` and `.markdown` file (any letter case) in those folders, following links. An edit that keeps the size, or one that is not committed yet, changes it. It does not see other file types, which is why no stamp is written when the builder read them.

Check the tool's documentation to see whether a graph records when each source was read. Unless it says so, assume the graph cannot prove freshness. The stamp is the only freshness check there is, and it covers only the Markdown files in the listed folders. Rebuild the graph when the stamp differs or the notes change, and treat it as a map that may be old.
