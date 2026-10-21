/* =========================================================
   reveriel feedback widget — 匿名1タップの利用フィードバック
   - ENDPOINT が空のあいだは一切動作しません（安全に同梱できる）
   - 送信先: Google Apps Script（site-ops/feedback/Code.gs）+ Google Sheet
   - 収集するのは「どのサイト・使えたか・任意コメント・言語・時刻」だけ。
     Cookie も個人情報も送りません。
   ========================================================= */
(function () {
  'use strict';

  // ▼ デプロイ後にここへ GAS のウェブアプリ URL を貼る（例は README 参照）
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbyCMSnp3I7g-JPjRKi_dHPaBqPw5tUmVX5faf9L62p5SUoiO6M0Y1dJK1fKH-GIOis6/exec';

  if (!ENDPOINT) return;
  if (window.__rvFeedbackLoaded) return;
  window.__rvFeedbackLoaded = true;

  var ANSWER_KEY = 'rvfb_answer_';
  var DISMISS_KEY = 'rvfb_dismiss_';
  var ANSWER_TTL = 90 * 24 * 3600 * 1000;   // 回答後90日は再表示しない
  var DISMISS_TTL = 14 * 24 * 3600 * 1000;  // 閉じた場合は14日
  var SITE = (location.pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '') || '/');
  var LANG = /^zh/i.test(document.documentElement.lang || '') ? 'zh' : 'ja';

  var TEXT = {
    ja: {
      q: 'この書類は実際に使えましたか？',
      yes: '使えた',
      no: '使えなかった',
      notyet: 'まだ使っていない',
      comment: '理由をひとこと（任意）',
      send: 'コメントを送る',
      thanks: 'ありがとうございます。今後の改善に役立てます。',
      note: '匿名で送信されます。氏名・住所などの個人情報は入力しないでください。',
      close: '閉じる'
    },
    zh: {
      q: '这份文件实际用上了吗？',
      yes: '用上了',
      no: '没用上',
      notyet: '还没用',
      comment: '简单说下原因（选填）',
      send: '发送',
      thanks: '谢谢，会用于改进。',
      note: '匿名发送。请勿填写姓名、地址等个人信息。',
      close: '关闭'
    }
  }[LANG];

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function now() { return Date.now(); }

  function recentlyAnswered() {
    var t = Number(lsGet(ANSWER_KEY + SITE) || 0);
    return !!t && now() - t < ANSWER_TTL;
  }
  function recentlyDismissed() {
    var t = Number(lsGet(DISMISS_KEY + SITE) || 0);
    return !!t && now() - t < DISMISS_TTL;
  }

  var box = null;
  var visible = false;
  var sending = false;

  function injectStyle() {
    if (document.getElementById('rvfb-style')) return;
    var css = ''
      + '.rvfb{position:fixed;left:18px;bottom:18px;z-index:9999;width:min(330px,calc(100vw - 36px));'
      + 'box-sizing:border-box;padding:16px 16px 13px;background:#fff;color:#1b2430;'
      + 'border:1px solid #dbe2ec;border-radius:12px;box-shadow:0 12px 32px rgba(16,24,40,.18);'
      + 'font-family:"Noto Sans JP",-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;'
      + 'font-size:13px;line-height:1.55;text-align:left;'
      + 'transform:translateY(10px);opacity:0;transition:transform .2s ease,opacity .2s ease}'
      + '.rvfb.rvfb-in{transform:none;opacity:1}'
      + '.rvfb[hidden]{display:none}'
      + '.rvfb-q{margin:0 26px 10px 0;font-weight:700;font-size:13.5px}'
      + '.rvfb-actions{display:flex;flex-wrap:wrap;gap:6px}'
      + '.rvfb-btn{flex:1 1 auto;padding:8px 6px;font:inherit;font-size:12.5px;font-weight:600;'
      + 'color:#334155;background:#f5f7fb;border:1px solid #dbe2ec;border-radius:8px;cursor:pointer;'
      + 'transition:background-color .15s,border-color .15s,color .15s;white-space:nowrap}'
      + '.rvfb-btn:hover{border-color:#9fb0c7;color:#111827}'
      + '.rvfb-btn:focus-visible{outline:2px solid #2f6fbd;outline-offset:2px}'
      + '.rvfb-comment{margin:10px 0 0;display:flex;flex-direction:column;gap:6px}'
      + '.rvfb-comment textarea{width:100%;box-sizing:border-box;min-height:52px;padding:7px 8px;'
      + 'font:inherit;font-size:12.5px;color:#1b2430;background:#f8fafc;border:1px solid #dbe2ec;border-radius:8px;resize:vertical}'
      + '.rvfb-send{align-self:flex-end;padding:6px 12px;font:inherit;font-size:12px;font-weight:600;'
      + 'color:#fff;background:#1d4e89;border:0;border-radius:7px;cursor:pointer}'
      + '.rvfb-send:hover{background:#163c6a}'
      + '.rvfb-note{margin:10px 0 0;font-size:10.5px;line-height:1.45;color:#8592a8}'
      + '.rvfb-close{position:absolute;top:8px;right:8px;width:24px;height:24px;padding:0;'
      + 'font:inherit;font-size:16px;line-height:1;color:#8592a8;background:transparent;border:0;'
      + 'border-radius:6px;cursor:pointer}'
      + '.rvfb-close:hover{background:#f1f5f9;color:#334155}'
      + '.rvfb-thanks{margin:4px 0 2px;font-weight:600;color:#067647}'
      + '@media (max-width:520px){.rvfb{left:12px;right:12px;bottom:12px;width:auto}}'
      + '@media (prefers-reduced-motion:reduce){.rvfb{transition:none}}';
    var style = document.createElement('style');
    style.id = 'rvfb-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function build() {
    injectStyle();
    box = document.createElement('div');
    box.className = 'rvfb';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', TEXT.q);
    box.innerHTML = ''
      + '<button type="button" class="rvfb-close" aria-label="' + TEXT.close + '">×</button>'
      + '<p class="rvfb-q"></p>'
      + '<div class="rvfb-actions">'
      + '  <button type="button" class="rvfb-btn" data-answer="yes"></button>'
      + '  <button type="button" class="rvfb-btn" data-answer="no"></button>'
      + '  <button type="button" class="rvfb-btn" data-answer="notyet"></button>'
      + '</div>'
      + '<div class="rvfb-comment">'
      + '  <textarea maxlength="300"></textarea>'
      + '  <button type="button" class="rvfb-send"></button>'
      + '</div>'
      + '<p class="rvfb-note"></p>';
    document.body.appendChild(box);

    box.querySelector('.rvfb-q').textContent = TEXT.q;
    box.querySelector('[data-answer="yes"]').textContent = TEXT.yes;
    box.querySelector('[data-answer="no"]').textContent = TEXT.no;
    box.querySelector('[data-answer="notyet"]').textContent = TEXT.notyet;
    box.querySelector('.rvfb-comment textarea').placeholder = TEXT.comment;
    box.querySelector('.rvfb-send').textContent = TEXT.send;
    box.querySelector('.rvfb-note').textContent = TEXT.note;

    box.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('.rvfb-close')) { dismiss(); return; }
      var ans = t.closest('[data-answer]');
      if (ans) { send(ans.getAttribute('data-answer'), ''); return; }
      if (t.closest('.rvfb-send')) {
        var comment = box.querySelector('textarea').value.trim().slice(0, 300);
        send('', comment);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && visible) dismiss();
    });
  }

  function showBox() {
    if (!box) build();
    if (visible || recentlyAnswered() || recentlyDismissed()) return;
    visible = true;
    box.hidden = false;
    requestAnimationFrame(function () { box.classList.add('rvfb-in'); });
  }

  function hideBox() {
    visible = false;
    if (!box) return;
    box.classList.remove('rvfb-in');
    setTimeout(function () { if (!visible) box.hidden = true; }, 220);
  }

  function dismiss() {
    lsSet(DISMISS_KEY + SITE, String(now()));
    hideBox();
  }

  function showThanks() {
    if (!box) return;
    box.innerHTML = '<p class="rvfb-thanks"></p>';
    box.querySelector('.rvfb-thanks').textContent = TEXT.thanks;
    setTimeout(hideBox, 2600);
  }

  function send(answer, comment) {
    if (sending) return;
    sending = true;
    var body = new URLSearchParams();
    body.set('site', SITE);
    body.set('answer', answer || '');
    body.set('comment', comment || '');
    body.set('lang', LANG);
    body.set('ref', document.referrer ? (document.referrer.split('/')[2] || '') : '');
    body.set('ts', new Date().toISOString());
    try {
      // no-cors + form-urlencoded: GAS 側で e.parameter として受け取れる
      fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', body: body, keepalive: true });
    } catch (e) { /* 送信失敗でもUIは閉じる */ }
    lsSet(ANSWER_KEY + SITE, String(now()));
    showThanks();
  }

  function onPrint() {
    setTimeout(showBox, 1600);
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[id="printBtn"],[id="printBtn2"],[id="topPrintBtn"],.print-btn,[data-print]') : null;
    if (t) onPrint();
  }, true);
  window.addEventListener('afterprint', function () { setTimeout(showBox, 500); });

  // 動作確認用（本番でも無害）
  window.__rvFeedback = { show: showBox, hide: hideBox };
})();
