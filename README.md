# Typst Book Preview

Typst Book Preview is an Obsidian desktop plugin for writers and typesetters who keep Typst projects inside a vault. It compiles a configured `.typ` or `.typ.md` entry file with the local Typst CLI, previews the generated PDF in Obsidian, and adds a compact Typst toolbar above source-mode Typst notes.

## Features

- Compile a configured Typst entry file to PDF from inside Obsidian.
- Preview the generated PDF in a dedicated Obsidian pane.
- Recompile automatically when the main Typst file, another Typst file in the same project folder, or a referenced image asset changes.
- Search for the main Typst file from the plugin settings.
- Use the active `.typ` or `.typ.md` note as the main file.
- Show Typst compiler output and diagnostics in Obsidian.
- Use a source-mode Typst toolbar for emphasis, strong text, math, highlight, headings, lists, notes, references, layout snippets, figures, tables, bibliography calls, and starter templates.
- Insert starter templates for a numbered paperback book or a basic article/report.

## Requirements

- Obsidian desktop.
- A local Typst CLI installation.
- A file-system vault. Mobile is not supported because the plugin runs the local Typst command.

The default Typst command is `typst`. On macOS, the plugin also checks common Homebrew paths such as `/opt/homebrew/bin/typst` and `/usr/local/bin/typst`.

## Install Manually

After downloading a release, create this folder in your vault if it does not exist:

```text
.obsidian/plugins/typst-book-preview/
```

Copy these files from the release into that folder:

```text
manifest.json
main.js
styles.css
```

Then open `Settings > Community plugins`, disable restricted mode if needed, and enable `Typst Book Preview`.

## Use

1. Open `Settings > Typst Book Preview`.
2. Set `Main Typst file` to the vault-relative path of your entry file.
3. Use `Choose file` to search existing `.typ` and `.typ.md` files.
4. Run `Open preview` from the command palette or the ribbon icon.
5. Press `Compile`, or run `Compile`.

With a vault like this:

```text
My Book/
  book.typ
  book.pdf
  chapters/
    01-introduction.typ
  media/
    cover.png
```

Set `Main Typst file` to `My Book/book.typ`. The output PDF is written next to it as `My Book/book.pdf`.

If Obsidian created the source as `book.typ.md`, the plugin treats it as Typst source and writes `book.pdf`. If your tab title says `book.typ` but the plugin cannot find it, use `Choose file` or run `Use active file as main file`.

## Typst Toolbar

The toolbar appears only above source-mode `.typ` and `.typ.md` notes. It wraps selected text when possible, and inserts snippets at the cursor when there is no selection.

Toolbar groups can be enabled or disabled in settings:

- Basic text: emphasis, strong, raw text, math, highlight, underline, strike, subscript, superscript, and links.
- Text refinements: small capitals, overline, uppercase, and lowercase.
- Notes and references: footnotes, quotes, labels, references, and citations.
- Headings: H1 through H6.
- Lists and comments: bullet, numbered, term-list, and line-comment prefixes.
- Layout: outline, page break, and columns.
- Objects: figure, table, and bibliography snippets.
- Templates: paperback book and article/report starters.

## Images

Use Typst-native image syntax for vault files:

```typst
#image("media/cover.png", width: 100%)
#image("/My Book/media/cover.png", width: 100%)
```

Relative paths are resolved from the main Typst file. Paths that start with `/` are resolved from the vault root because the plugin compiles with `--root` set to the vault folder.

## Troubleshooting

- If compiling fails with `ENOENT`, set `Typst CLI command` to the absolute path of the Typst executable.
- If the main file is not found, use `Choose file` in settings or run `Use Active File as Main Typst Book`.
- If Typst syntax fails inside a `.typ.md` file, remember that the plugin sends the file directly to Typst. The file contents need to be valid Typst.
- If the PDF does not refresh, run `Compile Typst Book` manually and check the diagnostics shown in the preview pane.

## Development

Install dependencies and rebuild the runtime bundle:

```sh
npm install
npm run build
```

For a release, build the plugin and attach these files to a GitHub release whose tag matches `manifest.json`:

```text
main.js
manifest.json
styles.css
```
