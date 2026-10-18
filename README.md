# Gemini Code Input

<p align="center">
  <img src="release/gemini-code-input-1.0.0-store-icon-300.png" width="96" height="96" alt="Gemini Code Input logo" />
</p>

<p align="center">
  A Manifest V3 browser extension that docks a <strong>real code editor</strong> into Gemini's web prompt box.
  <br />
  Syntax highlighting, proper language-aware indentation, line numbers, bracket matching, comment toggling, and smart fenced blocks.
</p>

<p align="center">
  <a href="https://github.com/deakR/code-inputin-aiwebapps/releases/latest"><img src="https://img.shields.io/badge/release-v1.0.0-blue.svg" alt="Latest Release: v1.0.0" /></a>
  <a href="https://github.com/deakR/code-inputin-aiwebapps/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/manifest-v3-blueviolet.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/tests-28%20passed-success.svg" alt="Playwright Tests" />
  <img src="https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Firefox%20%7C%20Brave%20%7C%20Arc-orange.svg" alt="Browser Support" />
</p>

---

## Overview

Writing code in a standard prompt textarea often strips indentation, mashes bracket pairs, and lacks readability. **Gemini Code Input** embeds CodeMirror 6 directly into [gemini.google.com](https://gemini.google.com)'s prompt card. 

The editor docks cleanly inside Gemini's input grid, styled natively with Google Sans and Google Sans Mono to blend seamlessly into Gemini's light and dark themes.

<p align="center">
  <img src="docs/images/gemini-code-editor-docked.png" alt="Gemini Code Input Docked Editor in Dark Mode" width="800" />
</p>

<p align="center">
  <img src="docs/images/gemini-code-editor-light.png" alt="Gemini Code Input Docked Editor in Light Mode" width="800" />
</p>

---

## Key Features

- **Docked In-Flow Experience**: Sits directly within Gemini's rounded input container. The code comes first and controls sit in a clean strip below, preserving Gemini's top-right expand/collapse button.
- **Native Gemini Typography**: UI elements use **Google Sans** and code uses **Google Sans Mono** / Roboto Mono, perfectly matching Gemini's interface.
- **Language-Aware Editing**: 21 supported languages with dedicated indentation units (4 spaces for Python/Java, 2 for JS/TS/HTML, real tabs for Go via `gofmt` standard).
- **Automatic Language Detection**: Pasting code into an empty editor automatically detects the syntax and switches the language mode.
- **Markdown Fenced Blocks**: Automatically formats submitted code with ` ```language ` block wrappers.
- **Duplicate Insertion Guard**: Prevents accidental re-insertion if the code is already sitting in the prompt box.
- **Ultra-Lean Footprint**: Loads on-demand. The initial content script is ~36 KiB; CodeMirror core and individual language packages load only when the editor opens.
- **100% Client-Side & Private**: Zero external network requests, zero telemetry, no third-party tracking. All operations happen inside the browser.

---

## Screenshots

### 1. Dedicated Floating Launcher Chip
A clean `<>` chip sits unobtrusively above the prompt box, following Gemini's dynamic layouts.

<p align="center">
  <img src="docs/images/gemini-launcher-chip.png" alt="Launcher Chip positioned above prompt box" width="760" />
</p>

### 2. Extension Options & Control Popup
Customize default language, fence wrappers, line wrapping, launcher button position, and editor scroll height.

<p align="center">
  <img src="docs/images/extension-popup.png" alt="Extension Settings Menu Popup" width="360" />
</p>

---

## Browser Compatibility

| Browser | Supported | Minimum Version | Engine | Extension Format |
|:---|:---:|:---:|:---:|:---:|
| **Google Chrome** | Yes | 114+ | Chromium | Manifest V3 |
| **Microsoft Edge** | Yes | 114+ | Chromium | Manifest V3 |
| **Mozilla Firefox** | Yes | 128+ | Gecko | Manifest V3 |
| **Brave Browser** | Yes | 1.50+ | Chromium | Manifest V3 |
| **Arc Browser** | Yes | Latest | Chromium | Manifest V3 |

---

## Installation

### 📦 Quick Install (Download & Unpack)

**No Node.js or build tools required.**

1. **Download the pre-packaged zip**:
   👉 **[Download gemini-code-input-1.0.0.zip](https://github.com/deakR/code-inputin-aiwebapps/releases/latest/download/gemini-code-input-1.0.0.zip)** (or get it from [Releases](https://github.com/deakR/code-inputin-aiwebapps/releases)).
2. **Unzip** `gemini-code-input-1.0.0.zip` into a folder on your computer.
3. **Load unpacked into your browser**:

#### Chromium (Chrome, Edge, Brave, Arc, Opera)
1. Navigate to your browser's extension page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
   - **Arc**: `arc://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the unzipped folder.

#### Mozilla Firefox
1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside the unzipped folder.

4. Open [gemini.google.com](https://gemini.google.com) and start coding!

---

### Building from Source (Developers)

If you wish to build or modify the extension from source:

```bash
# Clone the repository
git clone https://github.com/deakR/code-inputin-aiwebapps.git
cd code-inputin-aiwebapps

# Install dependencies
npm install

# Build extension into dist/
npm run build
```

Then load the `dist/` directory using the **Load unpacked** steps above.

---

## Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> (or <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd>) | Toggle the Code Editor |
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> (or <kbd>⌘</kbd> + <kbd>Enter</kbd>) | Insert code into prompt box |
| <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> | Indent / Dedent code selection |
| <kbd>Ctrl</kbd> + <kbd>/</kbd> | Toggle line comment |
| <kbd>Ctrl</kbd> + <kbd>F</kbd> | Open CodeMirror in-editor search |
| <kbd>Escape</kbd> | Dismiss autocomplete / Close editor |

---

## Supported Languages

| Category | Languages |
|:---|:---|
| **Scripting & Backend** | Python, JavaScript, TypeScript, Go, Rust, Java, Kotlin, Scala, C / C++, C#, PHP, Ruby, Dart, Shell (Bash/Zsh/PowerShell) |
| **Web & Markup** | HTML, CSS, XML, Markdown, JSON, YAML |
| **Data & Query** | SQL |

---

## Development & Verification

### Running the Test Suite
The extension includes full integration tests driven by [Playwright](https://playwright.dev/):

```bash
# Run 27 automated integration tests against Gemini mock fixtures
npm test
```

### Packaging for Release
To produce store-ready zips (source and production bundles):

```bash
npm run package
```
Generates zip bundles in the `release/` directory:
- `release/gemini-code-input-<version>.zip` (Store upload)
- `release/gemini-code-input-<version>-source.zip` (Source archive for reviewers)

---

## License

MIT License. See [LICENSE](LICENSE) for details.
