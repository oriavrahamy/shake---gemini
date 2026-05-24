# Shake & Gemini

Chrome Manifest V3 extension that opens Gemini from any page after a quick mouse shake, in a clean popup window placed next to the current tab.

## Features

- Activation by a sustained mouse shake or a long Space key press.
- Floating Gemini action button that stays open until Escape, click, or a fast-dismiss gesture.
- Page focus mode with text/image highlight actions for copying text or images before opening Gemini.
- Split-window layout using the screen work area: the current Chrome window is placed on the left and a clean Gemini popup is placed on the right.
- Options page for sensitivity, button behavior, and preferred window width.
- Keyboard shortcut command, default `Alt+G`.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder.

## Notes

The popup opens directly at `https://gemini.google.com/u/0/app`. If Chrome blocks content scripts on internal pages such as `chrome://extensions`, test the shake gesture on a regular website.
