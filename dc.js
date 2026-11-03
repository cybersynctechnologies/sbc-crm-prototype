/* Renders an SBC CRM prototype screen: a template with {{holes}}, <sc-for>, <sc-if>
   and event bindings, driven by the screen's Component class. */
(function () {
  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var handlers = [];

  function parseAttrs(s) {
    var out = [], re = /([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, m;
    while ((m = re.exec(s))) {
      out.push({ name: m[1], value: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null });
    }
    return out;
  }

  function parse(src) {
    var root = { tag: '#root', children: [] }, stack = [root], last = 0, m;
    var re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    while ((m = re.exec(src))) {
      if (m.index > last) stack[stack.length - 1].children.push({ text: src.slice(last, m.index) });
      last = re.lastIndex;
      if (m[0].slice(0, 4) === '<!--') continue;
      if (m[1]) {
        var t = m[1].toLowerCase();
        for (var i = stack.length - 1; i > 0; i--) { if (stack[i].tag === t) { stack.length = i; break; } }
        continue;
      }
      var tag = m[2].toLowerCase();
      var node = { tag: tag, raw: m[2], attrs: parseAttrs(m[3] || ''), children: [] };
      stack[stack.length - 1].children.push(node);
      if (!VOID[tag] && m[4] !== '/') stack.push(node);
    }
    if (last < src.length) stack[stack.length - 1].children.push({ text: src.slice(last) });
    return root;
  }

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v, found = false;
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] && Object.prototype.hasOwnProperty.call(scopes[i], parts[0])) { v = scopes[i][parts[0]]; found = true; break; }
    }
    if (!found) return undefined;
    for (var j = 1; j < parts.length; j++) { if (v == null) return undefined; v = v[parts[j]]; }
    return v;
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function interp(str, scopes) { return str.replace(HOLE, function (_, p) { var v = lookup(p, scopes); return v == null ? '' : esc(v); }); }
  function attr(node, name) { for (var i = 0; i < node.attrs.length; i++) if (node.attrs[i].name === name) return node.attrs[i].value; return null; }
  function whole(value, scopes) { var w = value && value.match(WHOLE); return w ? lookup(w[1], scopes) : value; }
  function kids(node, scopes) { var s = ''; for (var i = 0; i < node.children.length; i++) s += render(node.children[i], scopes); return s; }

  function render(node, scopes) {
    if (node.text !== undefined) return interp(node.text, scopes);
    var t = node.tag;
    if (t === '#root') return kids(node, scopes);
    if (t === 'helmet') return '';
    if (t === 'sc-for') {
      var list = whole(attr(node, 'list'), scopes) || [], as = attr(node, 'as') || 'item', out = '';
      for (var i = 0; i < list.length; i++) { var sc = { $index: i }; sc[as] = list[i]; out += kids(node, scopes.concat([sc])); }
      return out;
    }
    if (t === 'sc-if') return whole(attr(node, 'value'), scopes) ? kids(node, scopes) : '';
    var html = '<' + node.raw;
    for (var k = 0; k < node.attrs.length; k++) {
      var a = node.attrs[k], n = a.name;
      if (n.indexOf('hint-') === 0) continue;
      if (a.value === null) { html += ' ' + n; continue; }
      var w = a.value.match(WHOLE);
      if (/^on[A-Z]/.test(n)) {
        var fn = w ? lookup(w[1], scopes) : null;
        if (typeof fn === 'function') { handlers.push(fn); html += ' data-dc-' + n.slice(2).toLowerCase() + '="' + (handlers.length - 1) + '"'; }
        continue;
      }
      if (w) {
        var v = lookup(w[1], scopes);
        if (v === false || v == null) continue;
        html += v === true ? ' ' + n : ' ' + n + '="' + esc(v) + '"';
        continue;
      }
      html += ' ' + n + '="' + interp(a.value, scopes) + '"';
    }
    html += '>';
    if (VOID[t]) return html;
    return html + kids(node, scopes) + '</' + node.raw + '>';
  }

  function findHelmet(node) {
    if (node.tag === 'helmet') return node;
    for (var i = 0; node.children && i < node.children.length; i++) { var f = findHelmet(node.children[i]); if (f) return f; }
    return null;
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p) {
    var next = typeof p === 'function' ? p(this.state) : p;
    this.state = Object.assign({}, this.state, next);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };

  var inst, tree, app, queued = false;
  function draw() {
    handlers = [];
    app.innerHTML = render(tree, [inst.renderVals()]);
  }
  function schedule() { if (queued) return; queued = true; Promise.resolve().then(function () { queued = false; draw(); }); }

  document.addEventListener('DOMContentLoaded', function () {
    app = document.getElementById('app');
    tree = parse(document.getElementById('dc-template').textContent);
    var helmet = findHelmet(tree);
    if (helmet) document.head.insertAdjacentHTML('beforeend', kids(helmet, [{}]));
    var Component = new Function('DCLogic', document.getElementById('dc-logic').textContent + '\n;return Component;')(DCLogic);
    inst = new Component({});
    if (!inst.state) inst.state = {};
    draw();
    if (typeof inst.componentDidMount === 'function') inst.componentDidMount();
  });

  ['click', 'change', 'input'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var el = e.target.closest && e.target.closest('[data-dc-' + ev + ']');
      if (!el) return;
      var fn = handlers[Number(el.getAttribute('data-dc-' + ev))];
      if (fn) fn(e);
    });
  });
})();
