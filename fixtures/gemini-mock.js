/*
 * Behavioural mock of Gemini's prompt box.
 *
 * It reproduces the parts of the real thing the extension interacts with:
 *   - a `rich-textarea` wrapper with a Quill-style `.ql-editor` contenteditable
 *   - one <p> per line, the way Quill stores text (so innerText round trips the
 *     way it does on the real page, blank lines and all)
 *   - a `.ql-blank` class while empty
 *   - Enter sends, Shift+Enter inserts a line break
 *   - the send button stays disabled until the box has text
 *   - paste is IGNORED when it is not trusted, exactly like the real editor —
 *     the extension's paste strategy therefore has to fall through to
 *     execCommand here too, which is what the live page does — and the ignored
 *     paste leaves the caret on the editor element itself, which is where a
 *     multi-line insert merged the first line with the second on the real page
 *   - a document-level key listener, so tests can prove that nothing typed in
 *     the extension's editor ever reaches the page
 *
 * Test hooks: window.__gciPageKeyEvents, window.__gciResetLeaks(),
 * window.__gciMockHandlePaste (pretend to be an editor that accepts synthetic
 * paste), window.__gciMockAsyncPaste (…and inserts a beat later, after the
 * extension has read the box back), window.__gciMockSwallowPaste (…and then
 * inserts nothing at all).
 */
(function () {
  'use strict';

  var editor = document.getElementById('prompt-editor');
  var send = document.querySelector('.send-button');
  var conversation = document.getElementById('conversation');

  function editorText() {
    return (editor.innerText || '').replace(/\u00a0/g, ' ');
  }

  function refresh() {
    var empty = editorText().trim().length === 0;
    send.disabled = empty;
    send.setAttribute('aria-disabled', empty ? 'true' : 'false');
    editor.classList.toggle('ql-blank', empty);
  }

  /** Appends one <p> per line, like Quill's line-based model. */
  function insertPlainText(text) {
    var append = function (node) {
      editor.appendChild(node);
    };

    text.split('\n').forEach(function (line) {
      var paragraph = document.createElement('p');
      if (line.length > 0) paragraph.textContent = line;
      else paragraph.appendChild(document.createElement('br'));
      append(paragraph);
    });

    var last = editor.lastElementChild;
    if (last) {
      var selection = window.getSelection();
      if (selection) {
        var caret = document.createRange();
        caret.selectNodeContents(last);
        caret.collapse(false);
        selection.removeAllRanges();
        selection.addRange(caret);
      }
    }
    refresh();
  }

  function sendMessage() {
    var value = editorText().trim();
    if (!value) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'user-query';
    var paragraph = document.createElement('p');
    paragraph.textContent = value;
    wrapper.appendChild(paragraph);
    conversation.appendChild(wrapper);

    editor.textContent = '';
    refresh();
    window.scrollTo(0, document.body.scrollHeight);
  }

  editor.addEventListener('input', refresh);

  editor.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  editor.addEventListener('paste', function (event) {
    // Real Gemini only reacts to trusted paste events; a synthetic one is
    // ignored, which is why the extension has an execCommand fallback.
    var trusted = event.isTrusted === true;
    if (!trusted && !window.__gciMockHandlePaste && !window.__gciMockAsyncPaste && !window.__gciMockSwallowPaste) {
      // …and the real editor also leaves the caret sitting on the editor element,
      // *before* the first paragraph. Inserting multi-line text from there merges
      // the first line with the next one, so the extension has to re-place the
      // caret before its next attempt. This is that situation, on purpose.
      var rootCaret = document.createRange();
      rootCaret.setStart(editor, 0);
      rootCaret.collapse(true);
      var rootSelection = window.getSelection();
      if (rootSelection) {
        rootSelection.removeAllRanges();
        rootSelection.addRange(rootCaret);
      }
      return;
    }
    var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
    if (!text) return;
    event.preventDefault();
    if (window.__gciMockSwallowPaste) return;
    if (window.__gciMockAsyncPaste) {
      // The editor re-renders after the event, so the text shows up in the DOM
      // later. This is what made the extension insert a second copy.
      setTimeout(function () {
        insertPlainText(text);
      }, 150);
      return;
    }
    insertPlainText(text);
  });

  send.addEventListener('click', sendMessage);

  // Hostile page: counts every key event that reaches the document.
  window.__gciPageKeyEvents = 0;
  window.__gciPageEnterEvents = 0;
  window.__gciResetLeaks = function () {
    window.__gciPageKeyEvents = 0;
    window.__gciPageEnterEvents = 0;
  };
  document.addEventListener('keydown', function (event) {
    window.__gciPageKeyEvents++;
    if (event.key === 'Enter') window.__gciPageEnterEvents++;
  });

  refresh();
})();
