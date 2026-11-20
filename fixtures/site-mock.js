/*
 * Behavioural mock shared by the non-Gemini fixtures.
 *
 * It is deliberately generic: a contenteditable or textarea prompt box, an
 * action row with an attach and a send button, and an input handler that
 * enables Send. Synthetic paste events are ignored, matching the real
 * ProseMirror editors, so the extension has to use its execCommand/DOM ladder.
 */
(function () {
  'use strict';

  var shadowHost = document.getElementById('shadow-app');
  var root = shadowHost && shadowHost.shadowRoot ? shadowHost.shadowRoot : document;
  var editor = root.querySelector('#prompt-input');
  var send = root.querySelector('#send-button');
  var conversation = document.getElementById('conversation');
  if (!editor || !send) return;

  function isTextarea() {
    return editor.tagName === 'TEXTAREA';
  }

  function editorText() {
    if (isTextarea()) return editor.value || '';
    return (editor.innerText || '').replace(/\u00a0/g, ' ');
  }

  function refresh() {
    var empty = editorText().trim().length === 0;
    send.disabled = empty;
    send.setAttribute('aria-disabled', empty ? 'true' : 'false');
    if (!isTextarea()) editor.setAttribute('data-empty', empty ? 'true' : 'false');
  }

  function setText(text) {
    if (isTextarea()) {
      editor.value = text;
    } else {
      editor.textContent = '';
      text.split('\n').forEach(function (line) {
        var paragraph = document.createElement('p');
        if (line.length > 0) paragraph.textContent = line;
        else paragraph.appendChild(document.createElement('br'));
        editor.appendChild(paragraph);
      });
    }
    refresh();
  }

  function sendMessage() {
    var value = editorText().trim();
    if (!value) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'user-query';
    wrapper.textContent = value;
    conversation.appendChild(wrapper);
    setText('');
  }

  editor.addEventListener('input', refresh);
  editor.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  editor.addEventListener('paste', function (event) {
    // The real editors only accept trusted paste events; a synthetic one is
    // ignored. Tests exercise the extension's fallback ladder because of this.
    event.preventDefault();
  });
  send.addEventListener('click', sendMessage);

  refresh();
})();
