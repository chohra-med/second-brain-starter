# Command: `teach` — explain a system to a human

> Make one page a person can open in a browser and understand. Short first, deep after.
> `learning_human.html` at the root of an installed project is the worked example.

## The shape

1. **A quick guide the reader can finish in two minutes.** What they get, as things they can open,
   and the few steps to start. It must end in one tangible win.
2. **Then the longer version**, for the reader who wants to know why. One idea per section, a
   diagram where a picture teaches more than a paragraph, and every term defined once.

A reader who stops after the quick guide must still be able to start.

## The rules

- **One file.** Inline CSS, inline SVG, a small inline script. No network requests. It opens from
  `file://`.
- **True.** Never invent an excerpt, a path, a number or a result. Read the real file. Say what is
  weak or unknown next to what is strong.
- **For this reader.** Decide who reads it before writing. Tie new ideas to what they already know.
- **Use the project's brand** when it has one. Otherwise keep it plain: one accent colour, used
  sparingly.
- **Diagrams.** Use the `diagram-design` skill when it is installed. Without it: at most nine nodes,
  one or two accented, straight or right-angled connectors, a title and description on every `<svg>`.
- **Readable without clicking.** Interaction reveals detail; it never hides the only copy of a fact.
- **Never edit application source.**

## Steps

1. Read the project's instruction files and the source the topic touches.
2. Write the quick guide. Cut it until it fits two minutes.
3. Write the longer version underneath.
4. Check it: syntax-check the script, open it in a real browser at desktop and phone width and look,
   click every control, confirm it loads nothing from the network.
5. Save it where the user asked and open it for them.

## Output

The file path, who it was written for, what you checked and how, and anything on the page you could
not verify. A page that renders is not thereby correct.
