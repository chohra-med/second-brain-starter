---
name: graphify
description: Query a knowledge graph of your notes to find candidate links, then check each link in the current source files. Use only when the optional graphify tool is installed and you have a graph file. A graph result is a pointer to check, never the answer.
---

# Graphify: graph queries

Graphify is an optional outside tool. It builds a graph of the links between your Markdown notes. This starter does not bundle or install it. This skill says how to use a graph if you already have one. The tool is licensed under Apache 2.0. See ATTRIBUTION.md.

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

## Step 1: Check the tool

Run the tool's help command to confirm it is installed and to see its current flags. If the tool is missing, stop here. Use a plain text search instead.

## Step 2: Query the graph

```bash
graphify query "<topic or concept>" --budget 2000 --graph "<path to the graph JSON file>"
```

`--budget` limits the output by counting characters and formatting. It is not a token limit, and it does not limit how much of a file you read.

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

Check the tool's documentation to see whether a graph records when each source was read. Unless it says so, assume the graph cannot prove freshness. Rebuild it when the notes change, and treat it as a map that may be old.
