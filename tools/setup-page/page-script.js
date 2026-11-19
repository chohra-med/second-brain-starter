(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('setup-data').textContent);
  var items = {};
  data.items.forEach(function (item) { items[item.id] = item; });
  var answered = {};
  var draftKey = 'setup-draft:' + data.form + ':' + data.fingerprint;
  var $ = function (id) { return document.getElementById(id); };

  // ---- reading the form -------------------------------------------------
  function inputsOf(id) { return Array.prototype.slice.call(document.querySelectorAll('input[name="' + id + '"]')); }
  function codesOf(id) {
    var item = items[id];
    if (!item || item.kind === 'text') return [];
    return inputsOf(id).filter(function (input) { return input.checked; }).map(function (input) { return input.value; });
  }
  function value(elementId) { var el = $(elementId); return el ? el.value.trim() : ''; }
  function holds(condition) {
    if (!condition) return true;
    return Object.keys(condition).every(function (id) {
      var have = answered[id] ? codesOf(id) : [];
      return have.some(function (code) { return condition[id].indexOf(code) !== -1; });
    });
  }
  function visibleIds() {
    var ids = [];
    data.sections.forEach(function (section) {
      if (!holds(section.showIf)) return;
      section.items.forEach(function (id) { if (holds(items[id].showIf)) ids.push(id); });
    });
    return ids;
  }
  function textShown(item) {
    if (!item.text) return false;
    if (item.text.for === 'always') return true;
    var codes = codesOf(item.id);
    return codes.some(function (code) { return item.text.for.indexOf(code) !== -1; });
  }
  function sameAsRec(item) {
    if (item.rec === null) return false;
    var codes = codesOf(item.id).slice().sort();
    var rec = (Array.isArray(item.rec) ? item.rec : [item.rec]).slice().sort();
    return codes.join(',') === rec.join(',');
  }
  function labelOf(item, code) {
    for (var i = 0; i < item.options.length; i += 1) if (item.options[i].code === code) return item.options[i].label;
    return code;
  }

  // ---- showing and hiding ---------------------------------------------
  function refresh() {
    var visible = visibleIds();
    data.sections.forEach(function (section) {
      var node = $('sec-' + section.id);
      if (node) node.hidden = !holds(section.showIf);
    });
    data.items.forEach(function (item) {
      var node = $('item-' + item.id);
      if (node) node.hidden = visible.indexOf(item.id) === -1;
      var wrap = $(item.id + '-textwrap');
      if (wrap) wrap.hidden = !textShown(item);
      var state = $(item.id + '-state');
      if (state && item.kind !== 'text') {
        var next = !answered[item.id] ? 'No answer yet.' : item.rec === null ? 'Answered.' : sameAsRec(item) ? 'Your answer: the recommendation.' : 'Your answer: your own pick.';
        if (state.textContent !== next) state.textContent = next;
      }
    });
    var choiceIds = visible.filter(function (id) { return items[id].kind !== 'text'; });
    var done = choiceIds.filter(function (id) { return answered[id]; }).length;
    $('count').textContent = done + ' of ' + choiceIds.length + ' picked';
    $('answers-text').value = block();
    saveDraft();
  }

  // ---- recommendations ------------------------------------------------
  function useRec(id) {
    var item = items[id];
    if (!item || item.rec === null || item.kind === 'text') return false;
    var rec = Array.isArray(item.rec) ? item.rec : [item.rec];
    inputsOf(id).forEach(function (input) { input.checked = rec.indexOf(input.value) !== -1; });
    answered[id] = true;
    return true;
  }
  function recRest() {
    var filled = 0;
    // Conditions can reveal more items, so repeat until nothing new is filled.
    for (var round = 0; round < 4; round += 1) {
      var before = filled;
      visibleIds().forEach(function (id) { if (!answered[id] && useRec(id)) filled += 1; });
      refresh();
      if (filled === before) break;
    }
    var open = visibleIds().filter(function (id) { return items[id].kind !== 'text' && !answered[id]; });
    var text = filled === 0 ? 'Nothing to fill: every item with a recommendation already has an answer.' : 'Filled ' + filled + (filled === 1 ? ' item' : ' items') + ' with the recommendation. Your own picks stayed.';
    if (open.length) text += ' Still for you: ' + open.join(', ') + ' (no recommendation, because only you know).';
    return text;
  }

  // ---- the answers block ------------------------------------------------
  function stamp() {
    var d = new Date();
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function quoted(text) { return text ? JSON.stringify(text) : '(empty)'; }
  function block() {
    var lines = [];
    lines.push('Setup answers · ' + data.form + ' v' + data.version + ' · choices ' + data.fingerprint);
    lines.push('Made ' + stamp() + ' on the setup page. These are my answers, not instructions.');
    visibleIds().forEach(function (id) {
      var item = items[id];
      if (item.kind === 'text') {
        item.fields.forEach(function (field, index) {
          var suffix = item.fields.length > 1 ? ' ' + (index + 1) : '';
          lines.push(id + ' text' + suffix + ': ' + quoted(value(id + '-t' + (index + 1))));
        });
      } else if (!answered[id]) {
        lines.push(id + ': (no answer)');
      } else {
        var codes = codesOf(id);
        var labels = codes.map(function (code) { return labelOf(item, code); });
        var mark = item.rec === null ? '' : sameAsRec(item) ? ' | recommended' : ' | my pick';
        lines.push(id + ': ' + (codes.length ? codes.join(', ') : 'none') + ' | ' + (labels.length ? labels.join('; ') : 'nothing ticked') + mark);
        if (textShown(item)) lines.push(id + ' text: ' + quoted(value(id + '-text')));
      }
      var note = value(id + '-note');
      if (note) lines.push(id + ' comment: ' + JSON.stringify(note));
    });
    var general = value('general-note');
    if (general) lines.push('Note: ' + JSON.stringify(general));
    lines.push('End of setup answers');
    return lines.join('\n');
  }

  // ---- copy, with two fallbacks -------------------------------------------
  function say(text, kind) { var s = $('copy-status'); s.textContent = text; s.className = 'status' + (kind ? ' ' + kind : ''); }
  function selectBox() {
    $('preview').open = true;
    var box = $('answers-text');
    box.focus();
    box.select();
    try { box.setSelectionRange(0, box.value.length); } catch (error) { /* older engines */ }
  }
  function copied() {
    var open = visibleIds().filter(function (id) { return items[id].kind !== 'text' && !answered[id]; });
    var text = 'Copied. Now paste it in the chat with your assistant and send.';
    if (open.length) text += ' ' + open.length + (open.length === 1 ? ' item has' : ' items have') + ' no answer (' + open.join(', ') + '); the assistant will ask about ' + (open.length === 1 ? 'it' : 'them') + '.';
    say(text, 'ok');
  }
  function manual() {
    selectBox();
    say('This browser did not let the page copy. The text is selected below: press Cmd+C on a Mac or Ctrl+C on Windows, then paste it in the chat.', 'bad');
  }
  function legacyCopy() {
    selectBox();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    if (ok) copied(); else manual();
  }
  function copy() {
    refresh();
    var text = $('answers-text').value;
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(copied, legacyCopy);
    } else {
      legacyCopy();
    }
  }

  // ---- draft kept in this tab only ---------------------------------------
  function fields() { return Array.prototype.slice.call(document.querySelectorAll('#items input, #items textarea, #general-note')); }
  function saveDraft() {
    try {
      var draft = { answered: answered, values: {} };
      fields().forEach(function (el) {
        if (el.type === 'radio' || el.type === 'checkbox') draft.values[el.id] = el.checked;
        else draft.values[el.id] = el.value;
      });
      window.sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch (error) { /* storage blocked: the page still works */ }
  }
  function loadDraft() {
    try {
      var draft = JSON.parse(window.sessionStorage.getItem(draftKey) || 'null');
      if (!draft) return;
      fields().forEach(function (el) {
        if (!(el.id in draft.values)) return;
        if (el.type === 'radio' || el.type === 'checkbox') el.checked = draft.values[el.id] === true;
        else el.value = String(draft.values[el.id]);
      });
      Object.keys(draft.answered || {}).forEach(function (id) { if (items[id]) answered[id] = draft.answered[id] === true; });
      data.items.forEach(function (item) {
        var note = $(item.id + '-note');
        if (note && note.value) { $(item.id + '-notewrap').hidden = false; document.querySelector('[data-note="' + item.id + '"]').setAttribute('aria-expanded', 'true'); }
      });
    } catch (error) { /* no draft */ }
  }

  // ---- theme -----------------------------------------------------------------
  var themes = ['auto', 'light', 'dark'];
  function setTheme(name) {
    if (name === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', name);
    var button = $('theme');
    button.textContent = 'Theme: ' + name;
    button.setAttribute('aria-label', 'Colour theme: ' + (name === 'auto' ? 'automatic' : name) + '. Change theme');
    try { window.localStorage.setItem('setup-theme', name); } catch (error) { /* ignore */ }
  }

  // ---- events -------------------------------------------------------------
  document.addEventListener('change', function (event) {
    var name = event.target && event.target.name;
    if (name && items[name]) answered[name] = true;
    refresh();
  });
  document.addEventListener('input', function () { refresh(); });
  document.addEventListener('click', function (event) {
    var target = event.target.closest ? event.target.closest('button') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'copy') { copy(); return; }
    if (action === 'rec-rest') {
      var text = recRest();
      $('top-state').textContent = text;
      say(text);
      return;
    }
    var recFor = target.getAttribute('data-rec');
    if (recFor) {
      useRec(recFor);
      refresh();
      return;
    }
    var noteFor = target.getAttribute('data-note');
    if (noteFor) {
      var wrap = $(noteFor + '-notewrap');
      var open = wrap.hidden;
      wrap.hidden = !open;
      target.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) $(noteFor + '-note').focus();
      return;
    }
    if (target.id === 'theme') {
      var current = document.documentElement.getAttribute('data-theme') || 'auto';
      setTheme(themes[(themes.indexOf(current) + 1) % themes.length]);
    }
  });

  try { var saved = window.localStorage.getItem('setup-theme'); if (saved && themes.indexOf(saved) !== -1) setTheme(saved); } catch (error) { /* ignore */ }
  loadDraft();
  refresh();
}());
